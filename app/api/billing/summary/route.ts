/**
 * GET /api/billing/summary — billing state for the Settings page. Any org
 * member can view; mutations (checkout/portal) are owner/admin-gated in their
 * own routes.
 *
 * Returns: {
 *   available,            // Stripe configured + catalog priced — buttons usable
 *   role,                 // caller's org role (UI gates buttons on this)
 *   plan: { key, name, status, renewsAt, cancelAtPeriodEnd },
 *   seats: { used, included },
 *   contacts: { used, included, lifetime, packBalance, remaining },
 *   catalog: { plans: [...], pack }   // for upgrade buttons + copy
 * }
 */
import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { isBillingConfigured } from '@/lib/billing/stripe';
import { CONTACT_PACK, PLANS, contactPackPriceId, planPriceId } from '@/lib/billing/config';

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const [entitlements, memberCountResult] = await Promise.all([
    getOrgEntitlements(ctx.orgId),
    admin.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', ctx.orgId),
  ]);

  const available =
    isBillingConfigured() &&
    Object.values(PLANS).every((plan) => Boolean(planPriceId(plan))) &&
    Boolean(contactPackPriceId());

  return NextResponse.json({
    available,
    role: ctx.role,
    plan: {
      key: entitlements.planKey,
      name: entitlements.planName,
      status: entitlements.status,
      renewsAt: entitlements.currentPeriodEnd,
      cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
    },
    seats: {
      used: memberCountResult.count ?? 1,
      included: entitlements.seatLimit,
    },
    contacts: {
      used: entitlements.contactsUsedThisPeriod,
      included: entitlements.includedContacts,
      lifetime: entitlements.lifetimeAllowance,
      packBalance: entitlements.packBalance,
      remaining: entitlements.contactAllowanceRemaining,
    },
    catalog: {
      plans: Object.values(PLANS).map((plan) => ({
        key: plan.key,
        name: plan.name,
        monthlyUsd: plan.monthlyUsd,
        includedSeats: plan.includedSeats,
        includedMonthlyContacts: plan.includedMonthlyContacts,
        extraSeatMonthlyUsd: plan.extraSeatMonthlyUsd,
      })),
      pack: { contacts: CONTACT_PACK.contacts, usd: CONTACT_PACK.usd },
    },
  });
}
