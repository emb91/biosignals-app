/**
 * Fair-use gate for the in-app assistant (the /api/agent/chat route — both
 * the side-panel agent and the central briefing agent run through it).
 *
 * The assistant is "free to use as much as you want" by design. This gate is
 * NOT a metered paywall — it's a backstop against abuse: a botted account or
 * a runaway client loop hammering the endpoint and quietly running up a large
 * model bill. Without it, there's no ceiling on what a single account can
 * spend.
 *
 * We measure against accumulated *estimated cost* (already computed per call
 * in llm_usage_events) rather than raw token counts, because the assistant
 * leans on prompt caching — a cheap cached-read token and an expensive output
 * token are wildly different in $ but identical in a raw token count. Cost is
 * the honest measure of "are we about to run up a big bill."
 *
 * Two windows, whichever trips first:
 *   - daily   → catches a fast runaway/bot within a day
 *   - 30-day  → hard monthly ceiling on what one (free) account can cost us
 *
 * Both are env-tunable; set a cap to 0 to disable that window. Real usage is
 * a tiny fraction of these defaults, so a genuine power user will never see
 * the gate — it only bites pathological volume.
 */
import { createAdminClient } from '@/lib/supabase-admin';

const AGENT_ROUTE = '/api/agent/chat';

function envUsd(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Max assistant spend (USD) per user in a rolling 24h. 0 disables.
 * $10/day leaves genuine heavy testing comfortable headroom (a full day of
 * hands-on exploration runs a few dollars) while capping a botted account fast.
 */
export const AGENT_FAIR_USE_DAILY_USD = envUsd('AGENT_FAIR_USE_DAILY_USD', 10);

/**
 * Max assistant spend (USD) per user in a rolling 30 days. 0 disables.
 * Hard monthly ceiling on what one free account can ever cost us.
 */
export const AGENT_FAIR_USE_MONTHLY_USD = envUsd('AGENT_FAIR_USE_MONTHLY_USD', 40);

export type FairUseDecision = {
  allowed: boolean;
  /** Which window tripped, when blocked. */
  window?: 'daily' | 'monthly';
  /** Plain, customer-facing copy to show in the assistant bubble when blocked. */
  message?: string;
};

const ALLOW: FairUseDecision = { allowed: true };

async function sumAgentCostSince(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sinceIso: string,
): Promise<number> {
  const { data, error } = await admin
    .from('llm_usage_events')
    .select('estimated_cost_usd')
    .eq('user_id', userId)
    .eq('route', AGENT_ROUTE)
    .gte('created_at', sinceIso);
  if (error) {
    // Fail OPEN — a transient read error must never lock a user out of the
    // assistant. The gate is a backstop, not a hard quota.
    console.error('[agent-fair-use] usage read failed, allowing:', error.message);
    return Number.NaN;
  }
  let total = 0;
  for (const row of (data ?? []) as Array<{ estimated_cost_usd?: number | null }>) {
    const v = row.estimated_cost_usd;
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

/**
 * Decide whether to run another assistant turn for this user. Checks the
 * daily window first (cheaper to trip on a bot), then the 30-day window.
 */
export async function checkAgentFairUse(userId: string): Promise<FairUseDecision> {
  if (!userId) return ALLOW;
  const admin = createAdminClient();
  const now = Date.now();

  if (AGENT_FAIR_USE_DAILY_USD > 0) {
    const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const spent = await sumAgentCostSince(admin, userId, since);
    if (Number.isFinite(spent) && spent >= AGENT_FAIR_USE_DAILY_USD) {
      return blocked('daily');
    }
  }

  if (AGENT_FAIR_USE_MONTHLY_USD > 0) {
    const since = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const spent = await sumAgentCostSince(admin, userId, since);
    if (Number.isFinite(spent) && spent >= AGENT_FAIR_USE_MONTHLY_USD) {
      return blocked('monthly');
    }
  }

  return ALLOW;
}

function blocked(window: 'daily' | 'monthly'): FairUseDecision {
  const message =
    window === 'daily'
      ? "You've reached today's usage limit for the assistant. It resets automatically within a day — or reach out to the team if you need a higher limit."
      : "You've reached the usage limit for the assistant for now. It resets automatically — or reach out to the team if you need a higher limit.";
  return { allowed: false, window, message };
}
