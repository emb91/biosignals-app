import { createAdminClient } from '@/lib/supabase-admin';

type AnthropicUsageShape = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

type LlmUsageEventInput = {
  userId?: string | null;
  userEmail?: string | null;
  // 'openrouter' indicates the call was routed through OpenRouter's
  // OpenAI-compatible endpoint. The underlying model may still be Anthropic
  // (e.g. 'anthropic/claude-haiku-4-5') so cost estimation can strip the
  // vendor prefix and reuse the Anthropic pricing table.
  provider: 'anthropic' | 'openrouter';
  feature: string;
  route: string;
  model: string;
  usage?: AnthropicUsageShape | null;
  metadata?: Record<string, unknown> | null;
};

type AnthropicPricingTier = {
  promptThresholdTokens?: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

// Single pricing table covering both direct-Anthropic and OpenRouter-routed
// model identifiers. Function name keeps the historical `Anthropic` prefix for
// backwards compat with callers — but the table itself handles any supported
// model. Cache fields default to 0 for non-Anthropic models (Gemini, GPT) since
// they don't expose Anthropic-style prompt caching.
const ANTHROPIC_PRICING_USD_PER_MTOK: Record<string, AnthropicPricingTier[]> = {
  'claude-sonnet-4-6': [
    { promptThresholdTokens: 200_000, input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    { input: 6, output: 22.5, cacheWrite: 7.5, cacheRead: 0.6 },
  ],
  'claude-sonnet-4-5': [
    { promptThresholdTokens: 200_000, input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    { input: 6, output: 22.5, cacheWrite: 7.5, cacheRead: 0.6 },
  ],
  'claude-haiku-4-5': [
    { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  ],
  'claude-haiku-4-5-20251001': [
    { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  ],
  // OpenRouter — non-Anthropic models. Full identifier (no prefix stripping).
  // Pricing pulled from openrouter.ai/models as of 2026-05-25.
  'google/gemini-2.0-flash-001': [
    { input: 0.10, output: 0.40, cacheWrite: 0, cacheRead: 0 },
  ],
  'openai/gpt-4o-mini': [
    { input: 0.15, output: 0.60, cacheWrite: 0, cacheRead: 0 },
  ],
};

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function estimateAnthropicUsageCostUsd(model: string, usage?: AnthropicUsageShape | null): number | null {
  if (!usage) return null;
  // OpenRouter prefixes Anthropic model identifiers with "anthropic/"
  // (e.g. "anthropic/claude-haiku-4-5"). Strip that so the same pricing
  // table works for both direct Anthropic and OpenRouter-routed calls.
  const lookupKey = model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model;
  const pricingTiers = ANTHROPIC_PRICING_USD_PER_MTOK[lookupKey];
  if (!pricingTiers?.length) return null;

  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheWriteTokens = num(usage.cache_creation_input_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);
  const promptTokens = inputTokens + cacheWriteTokens + cacheReadTokens;
  const pricing =
    pricingTiers.find((tier) => tier.promptThresholdTokens && promptTokens <= tier.promptThresholdTokens) ??
    pricingTiers[pricingTiers.length - 1];

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWrite;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheRead;

  return Math.round((inputCost + outputCost + cacheWriteCost + cacheReadCost) * 1_000_000) / 1_000_000;
}

export async function recordLlmUsageEvent(input: LlmUsageEventInput): Promise<void> {
  try {
    const supabase = createAdminClient();
    const estimatedCostUsd = estimateAnthropicUsageCostUsd(input.model, input.usage);

    const { error } = await supabase.from('llm_usage_events').insert({
      user_id: input.userId ?? null,
      user_email: input.userEmail ?? null,
      provider: input.provider,
      feature: input.feature,
      route: input.route,
      model: input.model,
      input_tokens: num(input.usage?.input_tokens),
      output_tokens: num(input.usage?.output_tokens),
      cache_creation_input_tokens: num(input.usage?.cache_creation_input_tokens),
      cache_read_input_tokens: num(input.usage?.cache_read_input_tokens),
      estimated_cost_usd: estimatedCostUsd,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error('[llm-usage] failed to record usage event:', error);
    }
  } catch (error) {
    console.error('[llm-usage] failed to initialize usage recording:', error);
  }
}
