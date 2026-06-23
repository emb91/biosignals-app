import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { attemptApolloPhoneRevealForContact } from '@/lib/contact-phone-enrichment';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import {
  refundCredits,
  reserveCreditsWithIncludedAllowance,
  settleUsage,
  settleCredits,
} from '@/lib/billing/credits';
import { recordProviderUsage } from '@/lib/provider-usage';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: contact, error } = await admin.from('contacts')
    .select('id, full_name, first_name, last_name, company_name, company_domain, email, linkedin_url, location')
    .eq('id', id).eq('user_id', user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', user.id).maybeSingle<{ org_id: string }>();
  if (!member?.org_id) return NextResponse.json({ error: 'Workspace not found' }, { status: 409 });

  const entitlements = await getOrgEntitlements(member.org_id);
  const operationId = request.headers.get('x-operation-id') || crypto.randomUUID();
  const reservation = await reserveCreditsWithIncludedAllowance({
    orgId: member.org_id,
    userId: user.id,
    action: 'phone_reveal',
    operationKey: operationId,
    window: 'utc_month',
    windowStart: entitlements.currentPeriodStart,
    windowEnd: entitlements.currentPeriodEnd,
    allowanceLimit: entitlements.billingInterval === 'annual'
      ? entitlements.caps.phoneRevealsIncludedMonthly * 12
      : entitlements.caps.phoneRevealsIncludedMonthly,
    idempotencyKey: `phone-reveal:${operationId}`,
    entityType: 'contact',
    entityId: id,
  });
  if (!reservation.ok) return NextResponse.json(reservation, { status: 402 });

  const result = await attemptApolloPhoneRevealForContact(admin, {
    userId: user.id,
    contactId: id,
    lookupInput: {
      full_name: contact.full_name ?? undefined,
      first_name: contact.first_name ?? undefined,
      last_name: contact.last_name ?? undefined,
      company_name: contact.company_name ?? undefined,
      company_domain: contact.company_domain ?? undefined,
      email: contact.email ?? undefined,
      linkedin_url: contact.linkedin_url ?? undefined,
      location: contact.location ?? undefined,
    },
  });
  if (!result.gateAllowed) {
    await refundCredits(reservation.transactionId);
    await settleUsage({ orgId: member.org_id, action: 'phone_reveal', operationKey: operationId, quantity: 0 });
    return NextResponse.json({ error: 'Phone reveal is available for high-fit leads.' }, { status: 422 });
  }
  if (result.error) {
    await refundCredits(reservation.transactionId);
    await settleUsage({ orgId: member.org_id, action: 'phone_reveal', operationKey: operationId, quantity: 0 });
    return NextResponse.json({ error: 'Phone reveal could not be started. Credits were returned.' }, { status: 502 });
  }

  await settleCredits(reservation.transactionId);
  await settleUsage({ orgId: member.org_id, action: 'phone_reveal', operationKey: operationId, quantity: 1 });
  recordProviderUsage({
    userId: user.id,
    contactId: id,
    provider: 'apollo',
    eventType: 'apollo_phone_reveal',
    metadata: { pending: result.pending, inlinePhonesRevealed: result.revealed },
  }).catch(() => {});
  return NextResponse.json({
    success: true,
    pending: result.pending,
    revealed: result.revealed,
    creditsCharged: 20,
  });
}
