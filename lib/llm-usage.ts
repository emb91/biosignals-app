import { createAdminClient } from '@/lib/supabase-admin';

type AnthropicUsageShape = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type LlmUsageEventInput = {
  userId?: string | null;
  userEmail?: string | null;
  provider: 'anthropic';
  feature: string;
  route: string;
  model: string;
  usage?: AnthropicUsageShape | null;
  metadata?: Record<string, unknown> | null;
};

const ANTHROPIC_PRICING_USD_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheWrite?: number; cacheRead?: number }
> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function estimateAnthropicUsageCostUsd(model: string, usage?: AnthropicUsageShape | null): number | null {
  if (!usage) return null;
  const pricing = ANTHROPIC_PRICING_USD_PER_MTOK[model];
  if (!pricing) return null;

  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheWriteTokens = num(usage.cache_creation_input_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * (pricing.cacheWrite ?? 0);
  const cacheReadCost = (cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? 0);

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

