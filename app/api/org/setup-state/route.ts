/**
 * GET /api/org/setup-state
 *
 * Org-aware onboarding completion (Path A vs Path B). Replaces the per-user
 * `user_company` + `icps` checks in lib/use-setup-state.tsx, which broke for invited
 * members (they have neither — those belong to the org owner — so they'd be bounced to
 * /arcova-setup forever).
 *
 * Rules:
 *  - Members never do org setup. They are setup-complete the moment they join; their
 *    only personal step (My details) is non-blocking. → setupComplete: true.
 *  - Owners/admins must complete org setup: the org needs a company profile AND ≥1 ICP.
 *    We check across all org members' rows (admin client) so the check is correct both
 *    before and after ICPs move to org scope (Phase 3).
 *
 * Returns: { step1Complete, step2Complete, setupComplete, role, isMember }
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Members skip org setup entirely.
  if (ctx.role === 'member') {
    return NextResponse.json({
      step1Complete: true,
      step2Complete: true,
      setupComplete: true,
      role: ctx.role,
      isMember: true,
    });
  }

  const admin = createAdminClient();

  const { data: members } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', ctx.orgId);
  const memberIds = (members ?? []).map((m) => (m as { user_id: string }).user_id);
  const ids = memberIds.length > 0 ? memberIds : [ctx.user.id];

  const [companyRes, icpRes] = await Promise.all([
    admin.from('user_company').select('id').in('user_id', ids).limit(1).maybeSingle(),
    admin.from('icps').select('id').in('user_id', ids).limit(1).maybeSingle(),
  ]);

  const step1Complete = !!companyRes.data;
  const step2Complete = !!icpRes.data;

  return NextResponse.json({
    step1Complete,
    step2Complete,
    setupComplete: step1Complete && step2Complete,
    role: ctx.role,
    isMember: false,
  });
}
