import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  classifyEnrichedEmail,
  emailsEqual,
  looksLikeEmail,
  type ContactEmailRow,
} from '@/lib/contact-emails';
import { shouldOfferFindNewEmailForContact } from '@/lib/contact-profile-display';
import {
  recordProviderUsage,
  zerobounceValidationBillableQuantity,
} from '@/lib/provider-usage';

type ContactForFinder = {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  email_status: string | null;
  email_deliverability: string | null;
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
  if (!res.ok) throw new Error(data.error || data.failure_reason || `ZeroBounce Email Finder returned HTTP ${res.status}`);
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
  if (!res.ok) throw new Error(data.error || `ZeroBounce returned HTTP ${res.status}`);
  if (data.error) throw new Error(data.error);
  return data;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, user_id, first_name, last_name, full_name, email, email_status, email_deliverability, priority_score, crm_is_suppressed, company_name, company_domain, resolved_current_company_name, resolved_current_company_domain')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const typedContact = contact as ContactForFinder;
    const { data: contactEmailRows, error: contactEmailError } = await supabase
      .from('contact_emails')
      .select(
        'id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, email_deliverability, email_deliverability_provider, email_deliverability_checked_at, email_deliverability_metadata, created_at, updated_at',
      )
      .eq('contact_id', id)
      .eq('user_id', user.id)
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
            'Verify the on-file email with ZeroBounce before finding a new address, or confirm the contact has a stale email from a prior employer.',
        },
        { status: 409 },
      );
    }

    const finder = await findEmailWithZeroBounce(typedContact);
    const email = finder.email?.trim() || null;
    if (!email || !looksLikeEmail(email)) {
      return NextResponse.json({ error: finder.failure_reason || 'ZeroBounce did not find a usable email.' }, { status: 404 });
    }

    recordProviderUsage({
      userId: user.id,
      contactId: id,
      provider: 'zerobounce',
      eventType: 'zerobounce_email_finder',
      metadata: { email, domain: finder.domain ?? null },
    }).catch(() => {});

    const validation = await validateWithZeroBounce(email);
    const emailDeliverability = normalizeZeroBounceStatus(validation);
    const checkedAt = new Date().toISOString();

    recordProviderUsage({
      userId: user.id,
      contactId: id,
      provider: 'zerobounce',
      eventType: 'zerobounce_email_validate',
      quantity: zerobounceValidationBillableQuantity(validation.status),
      metadata: { email, status: validation.status ?? null, sub_status: validation.sub_status ?? null },
    }).catch(() => {});

    const category = classifyEnrichedEmail(
      email,
      typedContact.resolved_current_company_domain || typedContact.company_domain,
    );

    const { data: existingRows, error: existingError } = await supabase
      .from('contact_emails')
      .select('id, email')
      .eq('contact_id', id)
      .eq('user_id', user.id);

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    const existing = ((existingRows ?? []) as Array<{ id: string; email: string }>).find((row) =>
      emailsEqual(row.email, email),
    );

    if (existing) {
      const { error: updateEmailError } = await supabase
        .from('contact_emails')
        .update({
          email_deliverability: emailDeliverability,
          email_deliverability_provider: 'zerobounce',
          email_deliverability_checked_at: checkedAt,
          email_deliverability_metadata: { finder, validation },
          updated_at: checkedAt,
        })
        .eq('id', existing.id)
        .eq('user_id', user.id);
      if (updateEmailError) return NextResponse.json({ error: updateEmailError.message }, { status: 500 });
    } else {
      const { error: insertEmailError } = await supabase.from('contact_emails').insert({
        contact_id: id,
        user_id: user.id,
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

    const shouldReplacePrimary = !typedContact.email || !looksLikeEmail(typedContact.email);
    const contactPatch: Record<string, unknown> = { email_deliverability: emailDeliverability };
    if (shouldReplacePrimary) contactPatch.email = email;
    const { data: updatedContact, error: contactUpdateError } = await supabase
      .from('contacts')
      .update(contactPatch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('id, email, email_deliverability, updated_at')
      .maybeSingle();

    if (contactUpdateError) return NextResponse.json({ error: contactUpdateError.message }, { status: 500 });

    const { data: emailRows, error: emailRowsError } = await supabase
      .from('contact_emails')
      .select('id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, email_deliverability, email_deliverability_provider, email_deliverability_checked_at, email_deliverability_metadata, created_at, updated_at')
      .eq('contact_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (emailRowsError) return NextResponse.json({ error: emailRowsError.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      data: {
        contact: updatedContact,
        contact_emails: (emailRows ?? []) as ContactEmailRow[],
        finder,
        validation,
        email_deliverability: emailDeliverability,
      },
    });
  } catch (error) {
    console.error('[find-new-email] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
