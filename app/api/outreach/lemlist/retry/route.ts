/**
 * POST /api/outreach/lemlist/retry
 *
 * One-click retry for failed dispatches. For each sequenceId:
 *   1. Look at external_ref.lemlist_campaign_id from the prior attempt and
 *      reuse it — the rep already picked a campaign; defaulting to a different
 *      one would surprise them.
 *   2. If that's missing (e.g. the prior attempt failed before lemlist
 *      returned a campaign id), fall back to ensuring the Arcova template
 *      and using that.
 *
 * Body shape mirrors the dispatch endpoint but campaignId is optional:
 *   { sequenceIds: string[], campaignId?: string }
 *
 * If campaignId is provided, it's used for ALL rows (override).
 * Otherwise per-row resolution as described.
 *
 * Returns the same { results: [...] } shape the dispatch endpoint does.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  ensureArcovaTemplate,
  getLemlistKeyForCurrentUser,
} from '@/lib/lemlist';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sequenceIds?: unknown;
    campaignId?: unknown;
  };
  const sequenceIds = Array.isArray(body.sequenceIds)
    ? (body.sequenceIds.filter((v) => typeof v === 'string') as string[])
    : [];
  const overrideCampaignId = typeof body.campaignId === 'string' ? body.campaignId.trim() : '';

  if (sequenceIds.length === 0) {
    return NextResponse.json({ error: 'sequenceIds required' }, { status: 400 });
  }

  const apiKey = await getLemlistKeyForCurrentUser();
  if (!apiKey) return NextResponse.json({ error: 'lemlist not connected' }, { status: 400 });

  // Load prior external_ref so we can reuse the previous campaign per row.
  const { data: priorRows } = await supabase
    .from('outreach_sequences')
    .select('id, external_ref')
    .eq('user_id', user.id)
    .in('id', sequenceIds);
  const priorByid = new Map<string, { lemlist_campaign_id?: string | null } | null>(
    (priorRows ?? []).map((r) => [
      (r as { id: string }).id,
      (r as { external_ref: { lemlist_campaign_id?: string | null } | null }).external_ref,
    ]),
  );

  // Lazy-resolve the Arcova template only if we need it (some row has no prior).
  let arcovaCampaignId: string | null = null;
  const needsArcovaFor = sequenceIds.filter((id) => {
    if (overrideCampaignId) return false;
    return !priorByid.get(id)?.lemlist_campaign_id;
  });
  if (needsArcovaFor.length > 0) {
    try {
      const { campaignId } = await ensureArcovaTemplate(apiKey);
      arcovaCampaignId = campaignId;
    } catch (err) {
      return NextResponse.json(
        {
          error: 'Could not auto-provision Arcova template',
          detail: err instanceof Error ? err.message : 'unknown',
        },
        { status: 500 },
      );
    }
  }

  // Group sequenceIds by the campaignId we'll dispatch them to, then call the
  // existing dispatch route's handler once per group. We POST internally
  // rather than refactor dispatch — keeps the retry surface skinny.
  const buckets = new Map<string, string[]>();
  for (const id of sequenceIds) {
    const cid =
      overrideCampaignId ||
      priorByid.get(id)?.lemlist_campaign_id ||
      arcovaCampaignId ||
      '';
    if (!cid) continue;
    if (!buckets.has(cid)) buckets.set(cid, []);
    buckets.get(cid)!.push(id);
  }

  // Build absolute URL for the internal POST. Use the incoming request's origin.
  const origin = new URL(req.url).origin;
  const cookieHeader = req.headers.get('cookie') ?? '';

  const allResults: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const [cid, ids] of buckets.entries()) {
    const res = await fetch(`${origin}/api/outreach/lemlist/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieHeader,
      },
      body: JSON.stringify({ sequenceIds: ids, campaignId: cid }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      results?: Array<{ id: string; ok: boolean; error?: string }>;
      error?: string;
    };
    if (res.ok && Array.isArray(j.results)) {
      allResults.push(...j.results);
    } else {
      for (const id of ids) {
        allResults.push({ id, ok: false, error: j.error ?? `HTTP ${res.status}` });
      }
    }
  }

  return NextResponse.json({ results: allResults });
}
