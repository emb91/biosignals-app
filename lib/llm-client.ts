/**
 * Provider-routing LLM client.
 *
 * Routes classification-style features (SEC filings, etc.) to
 * OpenRouter when `OPENROUTER_API_KEY` is set; falls back to direct Anthropic
 * if either OpenRouter is unavailable or the feature is in the "always-direct"
 * set (currently any feature using Anthropic-specific server-side tools like
 * `web_search_20250305`, prompt caching, computer use — those don't pass
 * through OpenRouter reliably and stay on direct Anthropic).
 *
 * Provider choice is made per-feature, not per-call, so behaviour is
 * predictable and observable from the feature name in the LLM usage event log.
 *
 * Input / output shape: this wrapper always returns `{ text, usage }`. The
 * caller is responsible for parsing `text` and recording `usage` via
 * recordLlmUsageEvent(). That keeps the call-site simple and means we don't
 * have to mirror the full Anthropic SDK surface.
 *
 * Why no `openai` npm dep: OpenRouter's REST endpoint is OpenAI-compatible
 * (POST /v1/chat/completions with { model, messages, max_tokens }). A 30-line
 * fetch wrapper is all we need; adding the openai SDK would bring in a large
 * surface for no benefit.
 */
import Anthropic from '@anthropic-ai/sdk';

// ── Feature taxonomy ──────────────────────────────────────────────────────
// Add new features as they get OpenRouter-ised. Anything not listed here
// stays on direct Anthropic.
export type LlmFeature =
  | 'sec_filing_classifier'
  | 'sec_form_d_screener'
  | 'company_aliases'
  | 'contact_classification'
  | 'intent_scoring'
  | 'icp_audit'
  // Tier-4 simple-task features — default to Gemini Flash 2.0 on OpenRouter
  // (~40× cheaper than Sonnet, similar latency). Auto-falls back to Haiku
  // via direct Anthropic if OpenRouter errors.
  | 'suggest_buyer_functions'
  | 'suggest_roles'
  | 'suggest_seniority'
  | 'generate_contact_name'
  | 'generate_icp_name'
  | 'cik_disambiguation'
  | 'press_release_classifier'
  | 'company_resolution'
  // Outreach sequence — uses Sonnet for the 7-message generation. The hooks
  // picker is signal-derived (no LLM) so doesn't need a feature flag.
  | 'outreach_sequence'
  // Outreach hook curation — Haiku scores a small candidate list (≤12 hooks)
  // against the seller's value prop and picks the top 3 with one-line
  // reasoning. Cheap ($0.002/call), fires once per Outreach-tab open.
  | 'outreach_curate_hooks'
  // ICP buying-team generation — infers the distinct buying teams (personas)
  // for an ICP. Sonnet: the multi-team split + prune-to-what-we-sell reasoning
  // is quality-sensitive, and it fires only once per ICP at (re-)enrichment.
  | 'icp_buying_team'
  // Enrichment bios — short factual sentence from Apify/Apollo data.
  // Plain text completion (no Anthropic-specific tools), so OpenRouter
  // fallback works when ANTHROPIC_API_KEY runs out of credit.
  | 'company_bio_summarization'
  | 'contact_bio_generation'
  // The user's OWN profile bio (a few sentences, third-person summary). Fires
  // once per user at (re-)enrichment, so Sonnet is affordable here and the prose
  // quality matters — it's the person reading about themselves.
  | 'self_bio_generation'
  // Web-search-backed enrichment. These call Anthropic's server-side
  // web_search tool when on Anthropic; on fallback they use OpenRouter's
  // `web` plugin so they keep working when Anthropic credits are dry.
  | 'company_monitor_funding'
  | 'company_monitor_taxonomy'
  | 'my_company_enrichment_analysis'
  | 'my_company_enrichment_bullet_condense'
  // ICP setup / onboarding features — plain text or JSON completions that
  // previously called the Anthropic SDK directly with no fallback.
  | 'suggest_icp_companies'
  | 'onboarding_chat'
  | 'leads_query'
  | 'accounts_query'
  | 'generate_icp_summary'
  | 'company_fit_summary'
  | 'company_fit_scoring'
  // Web-search-backed company discovery for data acquisition.
  | 'web_company_discovery';

/**
 * Default models per (feature, route). Override via the `model` arg.
 * - OpenRouter model identifiers use the `<vendor>/<model>` convention.
 * - Anthropic direct uses bare model IDs.
 *
 * Default is Claude Haiku 4.5 on both routes — preserves quality vs current
 * implementations; cost difference is negligible. Switch to a cheaper
 * OpenRouter model (e.g. `google/gemini-2.5-flash`) per feature once we
 * validate output quality holds.
 */
const FEATURE_MODELS: Record<LlmFeature, { openrouter: string; anthropic: string }> = {
  sec_filing_classifier: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  sec_form_d_screener: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  company_aliases: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  contact_classification: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5-20251001',
  },
  intent_scoring: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5-20251001',
  },
  icp_audit: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // Tier-4: Gemini Flash on the primary route. If OpenRouter fails, the
  // wrapper auto-falls back to Anthropic direct using the Haiku model below.
  suggest_buyer_functions: {
    openrouter: 'google/gemini-2.5-flash',
    anthropic: 'claude-haiku-4-5',
  },
  suggest_roles: {
    openrouter: 'google/gemini-2.5-flash',
    anthropic: 'claude-haiku-4-5',
  },
  suggest_seniority: {
    openrouter: 'google/gemini-2.5-flash',
    anthropic: 'claude-haiku-4-5',
  },
  generate_contact_name: {
    openrouter: 'google/gemini-2.5-flash',
    anthropic: 'claude-haiku-4-5',
  },
  generate_icp_name: {
    // Reverted from gemini-2.0-flash: Flash ignored the explicit "3–10 words"
    // floor and the "weave in distinguishing modality" hint, producing
    // 2-word names like "Preclinical CRO" instead of "Preclinical Cell
    // Therapy and Gene Therapy CRO". Haiku follows the prompt faithfully and
    // call volume is tiny (one call per ICP creation), so cost diff is noise.
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  cik_disambiguation: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  press_release_classifier: {
    openrouter: 'google/gemini-2.5-flash',
    anthropic: 'claude-haiku-4-5',
  },
  // Resolver disambiguation — only called on ambiguous trigram candidates
  // (mostly cached after first call). Haiku is sufficient and worth the
  // accuracy over Gemini Flash for entity-resolution edge cases.
  company_resolution: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // Outreach sequence: writes 7 messages (initial + 6 follow-ups) anchored
  // to a chosen signal. Sonnet — the cadence and tone variation across
  // 7 messages is the main quality lever, and Arcova-fit context needs to
  // be woven in naturally per message.
  outreach_sequence: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Hook curation: scores a candidate list against the seller's value prop,
  // returns top 3 with reasoning. Tiny input (≤2k tokens) + tiny structured
  // output. Haiku is plenty.
  outreach_curate_hooks: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  icp_buying_team: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Enrichment bios — Haiku is plenty (one short factual sentence from
  // structured input). See memory/llm_cost_concerns.md.
  company_bio_summarization: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  contact_bio_generation: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // Self-profile bio — Sonnet for natural, well-formed prose (fires once per user).
  self_bio_generation: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Web-search enrichment — Sonnet for quality reasoning over live results.
  // OpenRouter route runs the same model + the `web` plugin (see
  // completeWithWebSearch), so funding/taxonomy/narrative survive an
  // Anthropic credit outage instead of returning empty.
  company_monitor_funding: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  company_monitor_taxonomy: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  my_company_enrichment_analysis: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Plain condense pass (no web search) — Haiku is plenty.
  my_company_enrichment_bullet_condense: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // ICP model-account suggestions during setup — Sonnet (same model the route
  // used when calling the SDK directly).
  suggest_icp_companies: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Onboarding chat narration / phase help — short conversational copy.
  onboarding_chat: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // Natural-language → structured query filters (contacts table).
  leads_query: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Natural-language → structured query filters (accounts table).
  accounts_query: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // One-sentence ICP card summary — Haiku is plenty.
  generate_icp_summary: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // One-sentence company-vs-ICP fit explanation — Haiku is plenty.
  company_fit_summary: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  // Company-vs-ICP fit scoring. This is a buying/priority decision, so use
  // Sonnet rather than a brittle rules engine or a small summarizer model.
  company_fit_scoring: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
  // Web-search company discovery — Sonnet for reasoning over live results.
  web_company_discovery: {
    openrouter: 'anthropic/claude-sonnet-4-6',
    anthropic: 'claude-sonnet-4-6',
  },
};


const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// ── Public API ─────────────────────────────────────────────────────────────

export type LlmCompletionInput = {
  feature: LlmFeature;
  prompt: string;
  /** Optional system prompt — steers behaviour without taking from the user-turn budget. */
  system?: string;
  maxTokens?: number;
  /** Sampling temperature 0..1. Omit for default. */
  temperature?: number;
  /** Override the default model for this feature. */
  model?: string;
  /** Force a specific provider regardless of env. Useful for tests. */
  provider?: 'openrouter' | 'anthropic';
  /**
   * Disable auto-fallback to direct Anthropic when OpenRouter fails. Default
   * is to fall back so a flaky OpenRouter doesn't take down user-facing
   * features. Set to true for cron jobs where you'd rather see the failure.
   */
  disableFallback?: boolean;
};

export type LlmCompletionResult = {
  text: string;
  provider: 'openrouter' | 'anthropic';
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export class LlmCompletionError extends Error {
  status: number | null;
  provider: 'openrouter' | 'anthropic';
  constructor(provider: 'openrouter' | 'anthropic', status: number | null, message: string) {
    super(message);
    this.name = 'LlmCompletionError';
    this.status = status;
    this.provider = provider;
  }
}

/**
 * Pick a provider for a feature.
 *
 * Routing preference: Claude / Anthropic models call Anthropic DIRECTLY;
 * non-Anthropic models (e.g. Gemini Flash) go via OpenRouter. A feature's model
 * vendor is read from its OpenRouter identifier (`<vendor>/<model>`). When the
 * preferred provider's key is missing/empty we route to the other so the call
 * still goes out — e.g. while ANTHROPIC_API_KEY is unset/empty (or the balance
 * is dry and the key is removed), Claude features fall to OpenRouter. completeLlm
 * additionally auto-falls-back across providers on a runtime error (so a dry
 * Anthropic balance with a still-present key recovers via OpenRouter too).
 */
function pickProvider(opts: LlmCompletionInput): 'openrouter' | 'anthropic' {
  if (opts.provider) return opts.provider;

  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

  const isAnthropicModel = FEATURE_MODELS[opts.feature].openrouter.startsWith('anthropic/');
  if (isAnthropicModel) {
    if (hasAnthropic) return 'anthropic';
    return hasOpenRouter ? 'openrouter' : 'anthropic';
  }
  // Non-Anthropic model → OpenRouter (fall back to Anthropic only if no OR key).
  return hasOpenRouter ? 'openrouter' : 'anthropic';
}

export async function completeLlm(opts: LlmCompletionInput): Promise<LlmCompletionResult> {
  const provider = pickProvider(opts);
  const model = opts.model ?? FEATURE_MODELS[opts.feature][provider];
  const maxTokens = opts.maxTokens ?? 1024;

  try {
    if (provider === 'openrouter') {
      return await completeWithOpenRouter({
        model,
        prompt: opts.prompt,
        system: opts.system,
        maxTokens,
        temperature: opts.temperature,
      });
    }
    return await completeWithAnthropic({
      model,
      prompt: opts.prompt,
      system: opts.system,
      maxTokens,
      temperature: opts.temperature,
    });
  } catch (error) {
    // Auto-fallback in both directions so a dead provider doesn't take down
    // user-facing features:
    //   - OpenRouter → Anthropic (rate limit, transient 5xx, model unavail)
    //   - Anthropic → OpenRouter (credits exhausted, 401, transient 5xx)
    // Skipped when the caller forced a provider or disabled fallback.
    const errMsg = error instanceof Error ? error.message : String(error);
    if (opts.provider || opts.disableFallback) throw error;

    if (provider === 'openrouter' && process.env.ANTHROPIC_API_KEY) {
      console.warn(
        `[llm-client] OpenRouter failed for feature=${opts.feature}, falling back to Anthropic: ${errMsg.slice(0, 200)}`,
      );
      const fallbackModel = FEATURE_MODELS[opts.feature].anthropic;
      return completeWithAnthropic({
        model: fallbackModel,
        prompt: opts.prompt,
        system: opts.system,
        maxTokens,
        temperature: opts.temperature,
      });
    }
    if (provider === 'anthropic' && process.env.OPENROUTER_API_KEY) {
      console.warn(
        `[llm-client] Anthropic failed for feature=${opts.feature}, falling back to OpenRouter: ${errMsg.slice(0, 200)}`,
      );
      const fallbackModel = FEATURE_MODELS[opts.feature].openrouter;
      return completeWithOpenRouter({
        model: fallbackModel,
        prompt: opts.prompt,
        system: opts.system,
        maxTokens,
        temperature: opts.temperature,
      });
    }
    throw error;
  }
}

export type LlmWebSearchInput = {
  feature: LlmFeature;
  prompt: string;
  system?: string;
  maxTokens?: number;
  /** Max web searches the model may run (Anthropic max_uses / OpenRouter web max_results). */
  maxSearches?: number;
  model?: string;
  provider?: 'openrouter' | 'anthropic';
  disableFallback?: boolean;
};

/**
 * Like completeLlm, but the model can search the web.
 *
 * - Anthropic route: uses the server-side `web_search_20250305` tool.
 * - OpenRouter route: uses the `web` plugin (Exa-backed) on the same model.
 *
 * Same preference + auto-fallback as completeLlm: direct Anthropic first
 * (cheaper), OpenRouter on failure — so funding/taxonomy/narrative keep
 * working through an Anthropic credit outage rather than returning empty.
 * Returns { text, provider, model, usage }; the caller parses `text`.
 */
export async function completeWithWebSearch(opts: LlmWebSearchInput): Promise<LlmCompletionResult> {
  const provider = pickProvider(opts);
  const model = opts.model ?? FEATURE_MODELS[opts.feature][provider];
  const maxTokens = opts.maxTokens ?? 2048;
  const maxSearches = opts.maxSearches ?? 3;

  try {
    if (provider === 'openrouter') {
      return await searchWithOpenRouter({ model, prompt: opts.prompt, system: opts.system, maxTokens, maxSearches });
    }
    return await searchWithAnthropic({ model, prompt: opts.prompt, system: opts.system, maxTokens, maxSearches });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (opts.provider || opts.disableFallback) throw error;

    if (provider === 'anthropic' && process.env.OPENROUTER_API_KEY) {
      console.warn(
        `[llm-client] Anthropic web-search failed for feature=${opts.feature}, falling back to OpenRouter web plugin: ${errMsg.slice(0, 200)}`,
      );
      return searchWithOpenRouter({
        model: FEATURE_MODELS[opts.feature].openrouter,
        prompt: opts.prompt,
        system: opts.system,
        maxTokens,
        maxSearches,
      });
    }
    if (provider === 'openrouter' && process.env.ANTHROPIC_API_KEY) {
      console.warn(
        `[llm-client] OpenRouter web-search failed for feature=${opts.feature}, falling back to Anthropic: ${errMsg.slice(0, 200)}`,
      );
      return searchWithAnthropic({
        model: FEATURE_MODELS[opts.feature].anthropic,
        prompt: opts.prompt,
        system: opts.system,
        maxTokens,
        maxSearches,
      });
    }
    throw error;
  }
}

async function searchWithAnthropic(opts: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  maxSearches: number;
}): Promise<LlmCompletionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmCompletionError('anthropic', null, 'ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });
  let message;
  try {
    message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: opts.maxSearches,
        } as Parameters<typeof client.messages.create>[0]['tools'] extends Array<infer T> ? T : never,
      ],
    });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? null;
    throw new LlmCompletionError('anthropic', status, error instanceof Error ? error.message : String(error));
  }
  const blocks = Array.isArray(message.content) ? (message.content as unknown[]) : [];
  const text = blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const block = b as { type?: unknown; text?: unknown };
      return block.type === 'text' && typeof block.text === 'string' ? block.text : null;
    })
    .filter((t): t is string => typeof t === 'string')
    .join('')
    .trim();
  const usage = (message.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  return { text, provider: 'anthropic', model: opts.model, usage };
}

async function searchWithOpenRouter(opts: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  maxSearches: number;
}): Promise<LlmCompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new LlmCompletionError('openrouter', null, 'OPENROUTER_API_KEY not set');
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.prompt });
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arcova.bio',
      'X-Title': 'Arcova GTM',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      // OpenRouter web plugin (Exa-backed) — the credit-resilient equivalent
      // of Anthropic's web_search tool.
      plugins: [{ id: 'web', max_results: opts.maxSearches }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new LlmCompletionError('openrouter', response.status, `OpenRouter ${response.status}: ${errText.slice(0, 500)}`);
  }
  type OpenRouterResponse = {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const json = (await response.json()) as OpenRouterResponse;
  const text = (json.choices?.[0]?.message?.content ?? '').trim();
  return {
    text,
    provider: 'openrouter',
    model: opts.model,
    usage: { input_tokens: json.usage?.prompt_tokens, output_tokens: json.usage?.completion_tokens },
  };
}

// ── OpenRouter ────────────────────────────────────────────────────────────

async function completeWithOpenRouter(opts: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  temperature?: number;
}): Promise<LlmCompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new LlmCompletionError('openrouter', null, 'OPENROUTER_API_KEY not set');
  }
  // OpenAI-compatible chat format: system as the first message, then user.
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.prompt });
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // OpenRouter recommends these headers for analytics + rate-limit shaping.
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL ?? 'https://arcova.bio',
      'X-Title': 'Arcova GTM',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new LlmCompletionError(
      'openrouter',
      response.status,
      `OpenRouter ${response.status}: ${errText.slice(0, 500)}`,
    );
  }
  type OpenRouterResponse = {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const json = (await response.json()) as OpenRouterResponse;
  const text = json.choices?.[0]?.message?.content ?? '';
  return {
    text,
    provider: 'openrouter',
    model: opts.model,
    usage: {
      input_tokens: json.usage?.prompt_tokens,
      output_tokens: json.usage?.completion_tokens,
    },
  };
}

// ── Anthropic direct ──────────────────────────────────────────────────────

async function completeWithAnthropic(opts: {
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  temperature?: number;
}): Promise<LlmCompletionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmCompletionError('anthropic', null, 'ANTHROPIC_API_KEY not set');
  }
  const client = new Anthropic({ apiKey });
  let message;
  try {
    message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      // Anthropic takes `system` as a top-level param rather than a message.
      ...(opts.system ? { system: opts.system } : {}),
      ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    });
  } catch (error) {
    const status = (error as { status?: number })?.status ?? null;
    const msg = error instanceof Error ? error.message : String(error);
    throw new LlmCompletionError('anthropic', status, msg);
  }
  const blocks = Array.isArray(message.content) ? (message.content as unknown[]) : [];
  const text = blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const block = b as { type?: unknown; text?: unknown };
      if (block.type !== 'text' || typeof block.text !== 'string') return null;
      return block.text;
    })
    .filter((t): t is string => typeof t === 'string')
    .join('\n')
    .trim();
  const usage = (message.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
  };
  return {
    text,
    provider: 'anthropic',
    model: opts.model,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
  };
}
