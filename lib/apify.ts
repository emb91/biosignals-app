import { createAdminClient } from '@/lib/supabase-admin';

export const APIFY_ACTORS = {
  profile: {
    id: 'harvestapi~linkedin-profile-scraper',
    publishedUnit: 'profile_result',
    unitPriceUsd: 0.004,
  },
  company: {
    id: 'harvestapi~linkedin-company',
    publishedUnit: 'company_result',
    unitPriceUsd: Number(process.env.APIFY_COMPANY_UNIT_PRICE_USD || 0.004),
  },
  jobs: {
    id: 'curious_coder~linkedin-jobs-scraper',
    publishedUnit: 'returned_job',
    unitPriceUsd: 0.001,
  },
  // Conference Phase 3 — social-intent (contact-level `attending_conference`).
  // Hashtag post-search: feed a conference hashtag, get posts back WITH the
  // author block (name/headline/company/profileUrl). Priced per post (FREE/BRONZE
  // $0.002; $0.0015 GOLD+) — see docs/CONFERENCE_PHASE3_SOCIAL.md. Env-overridable
  // so a tier change doesn't need a code change.
  'linkedin-post-search': {
    id: 'harvestapi~linkedin-post-search',
    publishedUnit: 'post',
    unitPriceUsd: Number(process.env.APIFY_LINKEDIN_POST_SEARCH_UNIT_PRICE_USD || 0.002),
  },
} as const;

export type ApifyActorKey = keyof typeof APIFY_ACTORS;

export async function runApifyActor<T extends Record<string, unknown>>(params: {
  actor: ApifyActorKey;
  input: Record<string, unknown>;
  orgId?: string | null;
  userId?: string | null;
  actionType: string;
  inputCount: number;
  attemptedCount?: number;
  customerCreditTransactionId?: string | null;
  includedMonitoring?: boolean;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<T[]> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) throw new Error('Missing APIFY_API_KEY');
  const actor = APIFY_ACTORS[params.actor];
  let items: T[] = [];
  let caught: unknown = null;
  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params.input),
        signal: AbortSignal.timeout(params.timeoutMs ?? 120_000),
      },
    );
    if (!response.ok) throw new Error(`Apify ${params.actor} returned HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    items = (Array.isArray(payload) ? payload : payload ? [payload] : []) as T[];
    return items;
  } catch (error) {
    caught = error;
    throw error;
  } finally {
    const outputCount = items.length;
    const attemptedCount = params.attemptedCount ?? params.inputCount;
    const successfulCount = caught
      ? 0
      : params.actor === 'jobs' ? attemptedCount : Math.min(attemptedCount, outputCount);
    const costUsd = outputCount * actor.unitPriceUsd;
    const admin = createAdminClient();
    admin.from('apify_run_usage').insert({
      org_id: params.orgId ?? null,
      user_id: params.userId ?? null,
      actor_id: actor.id,
      action_type: params.actionType,
      input_count: params.inputCount,
      output_count: outputCount,
      attempted_count: attemptedCount,
      successful_count: successfulCount,
      failed_count: Math.max(0, attemptedCount - successfulCount),
      unit_price_usd: actor.unitPriceUsd,
      actual_cost_usd: costUsd,
      customer_credit_transaction_id: params.customerCreditTransactionId ?? null,
      included_monitoring: params.includedMonitoring ?? false,
      price_snapshot: {
        publishedUnit: actor.publishedUnit,
        unitPriceUsd: actor.unitPriceUsd,
        capturedAt: new Date().toISOString(),
      },
      metadata: { ...(params.metadata ?? {}), error: caught instanceof Error ? caught.message : null },
    }).then(({ error }) => {
      if (error && error.code !== '42P01') console.error('[apify] usage recording failed:', error);
    });
  }
}
