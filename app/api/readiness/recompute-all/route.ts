import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser } from '@/lib/org-context';
import {
  generateAccountReason,
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';

// Recompute can touch dozens of entities sequentially; give it headroom.
export const maxDuration = 300;

/**
 * POST /api/readiness/recompute-all
 *
 * Recomputes readiness for EVERY active company and contact belonging to the
 * authenticated user. Use this to apply changes to the scoring rubric (e.g. new
 * signal base-impact weights) retroactively — stored readiness snapshots keep
 * their old scores until each entity is recomputed, which normally only happens
 * on the next signal event. This forces a full refresh.
 *
 * Side effects (per the readiness service): updates readiness snapshots and
 * mirrors company readiness onto org_companies, with user_companies retained as
 * a legacy compatibility mirror.
 *
 * Body (optional): { regenerateReasons?: boolean }
 *   - regenerateReasons defaults to FALSE. Reason regeneration is an LLM call
 *     per company; leave it off for a pure score refresh to avoid the cost.
 *
 * Returns per-entity processed/failed counts. Synchronous — fine for the
 * current dataset size (tens of entities). Would need batching/background for
 * thousands.
 */
export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { regenerateReasons?: unknown };
    const regenerateReasons = body.regenerateReasons === true;

    const admin = createAdminClient();
    const orgId = await orgIdForUser(admin, user.id);

    const companyQuery = orgId
      ? admin
          .from('org_companies')
          .select('company_id')
          .eq('org_id', orgId)
          .is('archived_at', null)
      : admin
          .from('user_companies')
          .select('company_id')
          .eq('user_id', user.id)
          .is('archived_at', null);

    const { data: companyRows, error: companyErr } = await companyQuery;
    if (companyErr) {
      return NextResponse.json({ error: companyErr.message }, { status: 500 });
    }

    // Contacts for this user (with a company — readiness keys off signals, but
    // we recompute all non-archived contacts regardless).
    const { data: contactRows, error: contactErr } = await admin
      .from('contacts')
      .select('id')
      .eq('user_id', user.id)
      .is('archived_at', null);
    if (contactErr) {
      return NextResponse.json({ error: contactErr.message }, { status: 500 });
    }

    let companiesProcessed = 0;
    let companiesFailed = 0;
    let reasonsRegenerated = 0;
    const failures: Array<{ entity: 'company' | 'contact'; id: string; error: string }> = [];

    for (const row of (companyRows ?? []) as Array<{ company_id: string }>) {
      try {
        await recomputeAccountReadiness(admin, { userId: user.id, companyId: row.company_id });
        companiesProcessed += 1;
        if (regenerateReasons) {
          try {
            await generateAccountReason(admin, { userId: user.id, companyId: row.company_id });
            reasonsRegenerated += 1;
          } catch (e) {
            // Reason regen failure shouldn't fail the score recompute.
            console.warn('[recompute-all] reason regen failed', row.company_id, e);
          }
        }
      } catch (e) {
        companiesFailed += 1;
        failures.push({
          entity: 'company',
          id: row.company_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    let contactsProcessed = 0;
    let contactsFailed = 0;
    for (const row of (contactRows ?? []) as Array<{ id: string }>) {
      try {
        await recomputeContactReadiness(admin, { userId: user.id, contactId: row.id });
        contactsProcessed += 1;
      } catch (e) {
        contactsFailed += 1;
        failures.push({
          entity: 'contact',
          id: row.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      success: true,
      companies: { processed: companiesProcessed, failed: companiesFailed },
      contacts: { processed: contactsProcessed, failed: contactsFailed },
      reasonsRegenerated: regenerateReasons ? reasonsRegenerated : null,
      failures: failures.slice(0, 50),
    });
  } catch (error) {
    console.error('[readiness/recompute-all] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
