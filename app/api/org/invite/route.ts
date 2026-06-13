/**
 * POST /api/org/invite
 *
 * Invite a teammate to the caller's org. Owner/admin only.
 *
 * Two delivery paths (audit #4 — invite-first, handle existing accounts):
 *  - Fresh email: Supabase `inviteUserByEmail` creates the auth user (invited state)
 *    and sends the invite email. We embed { org_id, org_role } in user_metadata so the
 *    member's first login attaches them to this org (see lib/org-context.ts). We then
 *    write a pending org_members row with the returned user id.
 *  - Already-registered email: `inviteUserByEmail` errors. We fall back to an
 *    `org_invites` row and return a copy-link the owner can send; the invitee accepts
 *    it while logged in via /api/org/invites/accept (consent required — we never move
 *    an existing account silently).
 *
 * Body: { email: string, role?: 'admin' | 'member' }
 * Returns: { delivered: 'email' } | { delivered: 'link', acceptUrl: string }
 */
import { NextResponse } from 'next/server';
import { getOrgContext, canEditOrgSetup, type OrgRole } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { billingEnforcementEnabled } from '@/lib/billing/consume';

function isAlreadyRegistered(error: { message?: string; status?: number; code?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.status === 422 ||
    error.code === 'email_exists' ||
    msg.includes('already been registered') ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  );
}

export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEditOrgSetup(ctx.role)) {
    return NextResponse.json({ error: 'Only an owner or admin can invite members' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { email?: string; role?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  const role: OrgRole = body?.role === 'admin' ? 'admin' : 'member';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const origin = new URL(request.url).origin;

  // Seat gate: members + pending invites must fit the plan's seat count.
  // Shadow mode (BILLING_ENFORCEMENT unset) logs instead of blocking.
  const entitlements = await getOrgEntitlements(ctx.orgId);
  const [{ count: memberCount }, { count: pendingCount }] = await Promise.all([
    admin.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', ctx.orgId),
    admin
      .from('org_invites')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId)
      .eq('status', 'pending'),
  ]);
  const seatsTaken = (memberCount ?? 0) + (pendingCount ?? 0);
  if (seatsTaken >= entitlements.seatLimit) {
    if (billingEnforcementEnabled()) {
      const seats = entitlements.seatLimit === 1 ? '1 seat' : `${entitlements.seatLimit} seats`;
      return NextResponse.json(
        { error: `Your plan includes ${seats}. Upgrade your plan in Settings to invite more teammates.` },
        { status: 403 },
      );
    }
    console.log(
      `[billing] seat limit exceeded in shadow mode: org ${ctx.orgId} has ${seatsTaken}/${entitlements.seatLimit} seats used`,
    );
  }

  // ── Path 1: fresh email — Supabase creates + emails the user ──────────────
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { org_id: ctx.orgId, org_role: role },
    redirectTo: `${origin}/auth/callback?next=/today`,
  });

  if (!inviteError && invited?.user) {
    const { error: memberError } = await admin.from('org_members').upsert(
      {
        org_id: ctx.orgId,
        user_id: invited.user.id,
        role,
        invited_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (memberError) {
      console.error('[org/invite] member upsert failed:', memberError);
      return NextResponse.json({ error: 'Invite sent but membership failed; retry.' }, { status: 500 });
    }
    return NextResponse.json({ delivered: 'email', email });
  }

  // ── Path 2: already-registered email — copy-link accept flow ──────────────
  if (isAlreadyRegistered(inviteError)) {
    // Refresh any prior pending invite for this (org, email) to a new token.
    await admin
      .from('org_invites')
      .update({ status: 'revoked' })
      .eq('org_id', ctx.orgId)
      .eq('status', 'pending')
      .ilike('email', email);

    const { data: inviteRow, error: inviteRowError } = await admin
      .from('org_invites')
      .insert({ org_id: ctx.orgId, email, role, invited_by: ctx.user.id })
      .select('token')
      .single();

    if (inviteRowError || !inviteRow) {
      console.error('[org/invite] org_invites insert failed:', inviteRowError);
      return NextResponse.json({ error: 'Could not create invite link' }, { status: 500 });
    }

    return NextResponse.json({
      delivered: 'link',
      email,
      acceptUrl: `${origin}/org/accept?token=${inviteRow.token}`,
    });
  }

  if (inviteError?.code === 'over_email_send_rate_limit' || inviteError?.status === 429) {
    return NextResponse.json(
      { error: 'Invite emails are temporarily rate-limited — please try again in about an hour.' },
      { status: 429 },
    );
  }

  console.error('[org/invite] inviteUserByEmail failed:', inviteError);
  return NextResponse.json({ error: 'Could not send invite' }, { status: 500 });
}
