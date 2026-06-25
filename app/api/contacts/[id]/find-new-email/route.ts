import { NextResponse } from 'next/server';
import {
  classifyEnrichedEmail,
  emailsEqual,
  looksLikeEmail,
  shouldPromoteVerifiedCandidateToPrimary,
  type ContactEmailRow,
} from '@/lib/contact-emails';
import { shouldOfferFindNewEmailForContact } from '@/lib/contact-profile-display';
import {
  recordProviderUsage,
  zerobounceValidationBillableQuantity,
} from '@/lib/provider-usage';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import {
  refundCredits,
  reserveCreditsWithIncludedAllowance,
  settleUsage,
  settleCredits,
} from '@/lib/billing/credits';
import { getOrgContext } from '@/lib/org-context';
import { resolveOrgContactAccess } from '@/lib/org-contact-access';

type ContactForFinder = {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  email_status: string | null;
  email_deliverability: string | null;
  updated_at: string | null;
  priority_score: number | null;
  crm_is_suppressed: boolean | null;
  company_name: string | null;
  company_domain: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
};

type ZeroBounceFinderResponse = {
  email?: string;
  email_confidence?: string;
  domain?: string;
  company_name?: string;
  did_you_mean?: string;
  failure_reason?: string;
  error?: string;
};

type ZeroBounceValidationResponse = {
  address?: string;
  status?: string;
  sub_status?: string;
  error?: string;
};

function normalizeZeroBounceStatus(response: ZeroBounceValidationResponse): string {
  const status = String(response.status || '').trim().toLowerCase();
  if (status === 'valid') return 'verified';
  return status || 'unknown';
}

function splitFullName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return { firstName: null, lastName: null };
  return {
    firstName: parts[0] ?? null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

async function findEmailWithZeroBounce(contact: ContactForFinder): Promise<ZeroBounceFinderResponse> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) throw new Error('Missing ZEROBOUNCE_API_KEY');

  const domain = contact.resolved_current_company_domain || contact.company_domain;
  const companyName = contact.resolved_current_company_name || contact.company_name;
  if (!domain && !companyName) throw new Error('Contact has no company domain or company name for email lookup.');

  const fallbackName = splitFullName(contact.full_name);
  const firstName = contact.first_name || fallbackName.firstName;
  const lastName = contact.last_name || fallbackName.lastName;

  const baseUrl = process.env.ZEROBOUNCE_EMAIL_FINDER_API_BASE_URL || 'https://api.zerobounce.net/v2/guessformat';
  const url = new URL(baseUrl);
  url.searchParams.set('api_key', apiKey);
  if (domain) url.searchParams.set('domain', domain);
  else if (companyName) url.searchParams.set('company_name', companyName);
  if (firstName) url.searchParams.set('first_name', firstName);
  if (lastName) url.searchParams.set('last_name', lastName);

  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as ZeroBounceFinderResponse;
  if (!res.ok) throw new Error(data.error || data.failure_reason || `Email lookup returned HTTP ${res.status}`);
  if (data.error) throw new Error(data.error);
  return data;
}

async function validateWithZeroBounce(email: string): Promise<ZeroBounceValidationResponse> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) throw new Error('Missing ZEROBOUNCE_API_KEY');

  const baseUrl = process.env.ZEROBOUNCE_API_BASE_URL || 'https://api.zerobounce.net/v2/validate';
  const url = new URL(baseUrl);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('email', email);
  url.searchParams.set('timeout', process.env.ZEROBOUNCE_TIMEOUT_SECONDS || '10');

  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as ZeroBounceValidationResponse;
  if (!res.ok) throw new Error(data.error || `Email validation returned HTTP ${res.status}`);
  if (data.error) throw new Error(data.error);
  return data;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let creditTransactionId: string | null = null;
  let usageContext: { orgId: string; operationId: string } | null = null;
  try {
    const { id } = await context.params;
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminClient();
    const access = await resolveOrgContactAccess({
      id,
      orgId: ctx.orgId,
      userId: ctx.user.id,
      admin,
    });
    if (!access) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const { data: contact, error: contactError } = await admin
      .from('contacts')
      .select('id, user_id, first_name, last_name, full_name, email, email_status, email_deliverability, updated_at, priority_score, crm_is_suppressed, company_name, company_domain, resolved_current_company_name, resolved_current_company_domain')
      .eq('id', access.contactId)
      .eq('user_id', access.ownerUserId)
      .maybeSingle();

    if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const typedContact = contact as ContactForFinder;
    const { data: contactEmailRows, error: contactEmailError } = await admin
      .from('contact_emails')
      .select(
        'id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, email_deliverability, email_deliverability_provider, email_deliverability_checked_at, email_deliverability_metadata, created_at, updated_at',
      )
      .eq('contact_id', access.contactId)
      .order('created_at', { ascending: true });

    if (contactEmailError) {
      return NextResponse.json({ error: contactEmailError.message }, { status: 500 });
    }

    if (typedContact.crm_is_suppressed) {
      return NextResponse.json(
        { error: 'Email finder is not offered for CRM-suppressed contacts (closed-won or closed-lost).' },
        { status: 409 },
      );
    }

    if (
      !shouldOfferFindNewEmailForContact(
        typedContact.priority_score,
        typedContact.email,
        (contactEmailRows ?? []) as ContactEmailRow[],
        {
          emailStatus: typedContact.email_status,
          currentCompanyDomain:
            typedContact.resolved_current_company_domain || typedContact.company_domain,
        },
      )
    ) {
      return NextResponse.json(
        {
          error:
            'Verify the on-file email before finding a new address, or confirm the contact has a stale email from a prior employer.',
        },
        { status: 409 },
      );
    }

    const entitlements = await getOrgEntitlements(ctx.orgId);
    const operationId = request.headers.get('x-operation-id') || crypto.randomUUID();
    const reservation = await reserveCreditsWithIncludedAllowance({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      action: 'email_finder',
      operationKey: operationId,
      window: 'utc_month',
      windowStart: entitlements.currentPeriodStart,
      windowEnd: entitlements.currentPeriodEnd,
      allowanceLimit: entitlements.billingInterval === 'annual'
        ? entitlements.caps.emailFinderRequestsIncludedMonthly * 12
        : entitlements.caps.emailFinderRequestsIncludedMonthly,
      idempotencyKey: `email-finder:${operationId}`,
      entityType: 'contact',
      entityId: access.personId,
    });
    if (!reservation.ok) return NextResponse.json(reservation, { status: 402 });
    usageContext = { orgId: ctx.orgId, operationId };
    creditTransactionId = reservation.transactionId;

    const finder = await findEmailWithZeroBounce(typedContact);
    const email = finder.email?.trim() || null;
    if (!email || !looksLikeEmail(email)) {
      await refundCredits(creditTransactionId);
      if (usageContext) await settleUsage({
        orgId: usageContext.orgId,
        action: 'email_finder',
        operationKey: usageContext.operationId,
        quantity: 0,
      });
      creditTransactionId = null;
      return NextResponse.json({ error: finder.failure_reason || 'No usable email was found.' }, { status: 404 });
    }

    recordProviderUsage({
      userId: ctx.user.id,
      contactId: access.contactId,
      provider: 'zerobounce',
      eventType: 'zerobounce_email_finder',
      metadata: { email, domain: finder.domain ?? null },
    }).catch(() => {});

    const validation = await validateWithZeroBounce(email);
    const emailDeliverability = normalizeZeroBounceStatus(validation);
    const checkedAt = new Date().toISOString();

    recordProviderUsage({
      userId: ctx.user.id,
      contactId: access.contactId,
      provider: 'zerobounce',
      eventType: 'zerobounce_email_validate',
      quantity: zerobounceValidationBillableQuantity(validation.status),
      metadata: { email, status: validation.status ?? null, sub_status: validation.sub_status ?? null },
    }).catch(() => {});

    const currentCompanyDomain = typedContact.resolved_current_company_domain || typedContact.company_domain;
    const category = classifyEnrichedEmail(email, currentCompanyDomain);

    const { data: existingRows, error: existingError } = await admin
      .from('contact_emails')
      .select('id, email')
      .eq('contact_id', access.contactId);

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    const existing = ((existingRows ?? []) as Array<{ id: string; email: string }>).find((row) =>
      emailsEqual(row.email, email),
    );

    if (existing) {
      const { error: updateEmailError } = await admin
        .from('contact_emails')
        .update({
          email_deliverability: emailDeliverability,
          email_deliverability_provider: 'zerobounce',
          email_deliverability_checked_at: checkedAt,
          email_deliverability_metadata: { finder, validation },
          updated_at: checkedAt,
        })
        .eq('id', existing.id);
      if (updateEmailError) return NextResponse.json({ error: updateEmailError.message }, { status: 500 });
    } else {
      const { error: insertEmailError } = await admin.from('contact_emails').insert({
        contact_id: access.contactId,
        user_id: access.ownerUserId,
        email,
        category,
        label: null,
        source_provider: 'zerobounce_finder',
        apollo_email_status: null,
        email_deliverability: emailDeliverability,
        email_deliverability_provider: 'zerobounce',
        email_deliverability_checked_at: checkedAt,
        email_deliverability_metadata: { finder, validation },
        updated_at: checkedAt,
      });
      if (insertEmailError && (insertEmailError as { code?: string }).code !== '23505') {
        return NextResponse.json({ error: insertEmailError.message }, { status: 500 });
      }
    }

    const shouldReplacePrimary =
      !typedContact.email ||
      !looksLikeEmail(typedContact.email) ||
      typedContact.email_status === 'stale_suspected';
    const candidateIsCurrentPrimary = Boolean(typedContact.email && emailsEqual(typedContact.email, email));
    const shouldPromotePrimary = shouldPromoteVerifiedCandidateToPrimary({
      canReplacePrimary: shouldReplacePrimary,
      candidateEmail: email,
      candidateDeliverability: emailDeliverability,
      currentCompanyDomain,
    });
    const contactPatch: Record<string, unknown> = {};
    if (candidateIsCurrentPrimary || shouldPromotePrimary) {
      contactPatch.email_deliverability = emailDeliverability;
    }
    if (shouldPromotePrimary) contactPatch.email = email;
    if (shouldPromotePrimary && category === 'enriched_work') {
      contactPatch.email_status = 'aligned_current';
      contactPatch.email_status_reasoning = 'Email domain matches the resolved current company.';
    }

    let updatedContact: {
      id: string;
      email: string | null;
      email_deliverability: string | null;
      email_status: string | null;
      updated_at: string | null;
    } | null = {
      id: typedContact.id,
      email: typedContact.email,
      email_deliverability: typedContact.email_deliverability,
      email_status: typedContact.email_status,
      updated_at: typedContact.updated_at,
    };

    if (Object.keys(contactPatch).length > 0) {
      const { data: updated, error: contactUpdateError } = await admin
        .from('contacts')
        .update(contactPatch)
        .eq('id', access.contactId)
        .eq('user_id', access.ownerUserId)
        .select('id, email, email_deliverability, email_status, updated_at')
        .maybeSingle();

      if (contactUpdateError) return NextResponse.json({ error: contactUpdateError.message }, { status: 500 });
      updatedContact = updated;
    }

    const { data: emailRows, error: emailRowsError } = await admin
      .from('contact_emails')
      .select('id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, email_deliverability, email_deliverability_provider, email_deliverability_checked_at, email_deliverability_metadata, created_at, updated_at')
      .eq('contact_id', access.contactId)
      .order('created_at', { ascending: true });

    if (emailRowsError) return NextResponse.json({ error: emailRowsError.message }, { status: 500 });

    await settleCredits(creditTransactionId);
    if (usageContext) await settleUsage({
      orgId: usageContext.orgId,
      action: 'email_finder',
      operationKey: usageContext.operationId,
      quantity: 1,
    });
    creditTransactionId = null;
    return NextResponse.json({
      success: true,
      data: {
        contact: updatedContact,
        contact_emails: ((emailRows ?? []) as ContactEmailRow[]).map((row) => ({
          ...row,
          source_provider: row.source_provider ? 'arcova' : null,
          email_deliverability_provider: row.email_deliverability_provider ? 'arcova' : null,
          email_deliverability_metadata: null,
        })),
        email_deliverability: emailDeliverability,
      },
    });
  } catch (error) {
    await refundCredits(creditTransactionId).catch(() => {});
    if (usageContext) await settleUsage({
      orgId: usageContext.orgId,
      action: 'email_finder',
      operationKey: usageContext.operationId,
      quantity: 0,
    }).catch(() => {});
    console.error('[find-new-email] error:', error);
    return NextResponse.json(
      { error: 'Email lookup failed. Any reserved credits were returned.' },
      { status: 500 },
    );
  }
}
