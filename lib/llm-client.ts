/**
 * Provider-routing LLM client.
 *
 * Routes classification-style features (press releases, SEC filings, etc.) to
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
  | 'press_release_classifier'
  | 'sec_filing_classifier'
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
  | 'recommend_signals'
  | 'recommend_persona_signals'
  | 'generate_icp_name';

/**
 * Default models per (feature, route). Override via the `model` arg.
 * - OpenRouter model identifiers use the `<vendor>/<model>` convention.
 * - Anthropic direct uses bare model IDs.
 *
 * Default is Claude Haiku 4.5 on both routes — preserves quality vs current
 * implementations; cost difference is negligible. Switch to a cheaper
 * OpenRouter model (e.g. `google/gemini-2.0-flash-001`) per feature once we
 * validate output quality holds.
 */
const FEATURE_MODELS: Record<LlmFeature, { openrouter: string; anthropic: string }> = {
  press_release_classifier: {
    openrouter: 'anthropic/claude-haiku-4-5',
    anthropic: 'claude-haiku-4-5',
  },
  sec_filing_classifier: {
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
    openrouter: 'google/gemini-2.0-flash-001',
    anthropic: 'claude-haiku-4-5',
  },
  suggest_roles: {
    openrouter: 'google/gemini-2.0-flash-001',
    anthropic: 'claude-haiku-4-5',
  },
  suggest_seniority: {
    openrouter: 'google/gemini-2.0-flash-001',
    anthropic: 'claude-haiku-4-5',
  },
  generate_contact_name: {
    openrouter: 'google/gemini-2.0-flash-001',
    anthropic: 'claude-haiku-4-5',
  },
  recommend_signals: {
    openrouter: 'google/gemini-2.0-flash-001',
    anthropic: 'claude-haiku-4-5',
  },
  recommend_persona_signals: {
    openrouter: 'google/gemini-2.0-flash-001',
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
};

// Features that should bypass OpenRouter and go straight to Anthropic.
// Use this when (a) the underlying model is Anthropic anyway and (b) call
// volume is low enough that the ~5% OpenRouter markup isn't worth a second
// observability surface or routing branch. Currently just generate_icp_name —
// fires once per ICP creation, needs Haiku quality, no reason to pay the markup.
const ANTHROPIC_DIRECT_FEATURES: ReadonlySet<LlmFeature> = new Set([
  'generate_icp_name',
]);

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
 * Pick a provider for a feature, honouring overrides and env availability.
 */
function pickProvider(opts: LlmCompletionInput): 'openrouter' | 'anthropic' {
  if (opts.provider) return opts.provider;
  if (ANTHROPIC_DIRECT_FEATURES.has(opts.feature)) return 'anthropic';
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && openrouterKey.length > 0) return 'openrouter';
  return 'anthropic';
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
    // Auto-fallback: when OpenRouter errors (rate limit, transient 5xx,
    // model-unavailable), fall back to direct Anthropic using the
    // Anthropic-equivalent model so user-facing features don't go dark.
    // Skip when the caller forced a provider, disabled fallback, or
    // ANTHROPIC_API_KEY isn't set.
    const shouldFallback =
      provider === 'openrouter' &&
      !opts.provider &&
      !opts.disableFallback &&
      Boolean(process.env.ANTHROPIC_API_KEY);
    if (!shouldFallback) throw error;
    const errMsg = error instanceof Error ? error.message : String(error);
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
