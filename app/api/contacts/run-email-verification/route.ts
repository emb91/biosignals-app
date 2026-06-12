import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { classifyEnrichedEmail, emailsEqual, looksLikeEmail, shouldRunAutomatedEmailVerification, DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN, emailVerificationBannerCategory, type EmailVerificationResultItem } from '@/lib/contact-emails';

type ContactForVerification = {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  email_deliverability: string | null;
  company_name: string | null;
  company_domain: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
};

type ContactEmailForVerification = {
  id: string;
  contact_id: string;
  email: string;
  email_deliverability: string | null;
  email_deliverability_provider: string | null;
};

type EmailForVerification = {
  contactId: string;
  contactEmailId: string | null;
  email: string;
  isPrimary: boolean;
  source: 'existing' | 'finder';
  finderMetadata?: ZeroBounceFinderResponse;
  contact: ContactForVerification;
};

type ZeroBounceResponse = {
  address?: string;
  status?: string;
  sub_status?: string;
  error?: string;
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

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function configuredPriorityMin(): number {
  const raw = Number(
    process.env.EMAIL_VERIFICATION_PRIORITY_MIN ??
      process.env.EMAIL_VERIFICATION_CONTACT_FIT_MIN ??
      DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN,
  );
  if (!Number.isFinite(raw)) return DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN;
  return Math.max(0, Math.min(1, raw));
}

function normalizeLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function contactDisplayName(contact: ContactForVerification): string | null {
  const full = contact.full_name?.trim();
  if (full) return full;
  const parts = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return parts || null;
}

function contactCompanyName(contact: ContactForVerification): string | null {
  return contact.resolved_current_company_name?.trim() || contact.company_name?.trim() || null;
}

function normalizeZeroBounceStatus(response: ZeroBounceResponse): string {
  const status = String(response.status || '').trim().toLowerCase();
  if (status === 'valid') return 'verified';
  if (
    status === 'invalid' ||
    status === 'catch-all' ||
    status === 'unknown' ||
    status === 'spamtrap' ||
    status === 'abuse' ||
    status === 'do_not_mail'
  ) {
    return status;
  }
  return status || 'unknown';
}

function shouldVerifyDeliverability(
  deliverability: string | null | undefined,
  provider: string | null | undefined,
): boolean {
  return shouldRunAutomatedEmailVerification(deliverability, provider);
}

async function verifyWithZeroBounce(email: string): Promise<ZeroBounceResponse> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) throw new Error('Missing ZEROBOUNCE_API_KEY');

  const baseUrl = process.env.ZEROBOUNCE_API_BASE_URL || 'https://api.zerobounce.net/v2/validate';
  const url = new URL(baseUrl);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('email', email);
  url.searchParams.set('timeout', process.env.ZEROBOUNCE_TIMEOUT_SECONDS || '10');

  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as ZeroBounceResponse;

  if (!res.ok) {
    throw new Error(data.error || `ZeroBounce returned HTTP ${res.status}`);
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

async function findEmailWithZeroBounce(contact: ContactForVerification): Promise<ZeroBounceFinderResponse | null> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) throw new Error('Missing ZEROBOUNCE_API_KEY');

  const domain = contact.resolved_current_company_domain || contact.company_domain;
  const companyName = contact.resolved_current_company_name || contact.company_name;
  if (!domain && !companyName) return null;

  const baseUrl = process.env.ZEROBOUNCE_EMAIL_FINDER_API_BASE_URL || 'https://api.zerobounce.net/v2/guessformat';
  const url = new URL(baseUrl);
  url.searchParams.set('api_key', apiKey);
  if (domain) url.searchParams.set('domain', domain);
  else if (companyName) url.searchParams.set('company_name', companyName);

  if (contact.first_name) url.searchParams.set('first_name', contact.first_name);
  if (contact.last_name) url.searchParams.set('last_name', contact.last_name);

  if (!contact.first_name && !contact.last_name && contact.full_name) {
    const parts = contact.full_name.trim().split(/\s+/).filter(Boolean);
    if (parts[0]) url.searchParams.set('first_name', parts[0]);
    if (parts.length > 1) url.searchParams.set('last_name', parts.slice(1).join(' '));
  }

  const res = await fetch(url, { method: 'GET', cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as ZeroBounceFinderResponse;

  if (!res.ok) {
    throw new Error(data.error || data.failure_reason || `ZeroBounce Email Finder returned HTTP ${res.status}`);
  }

  if (data.error) throw new Error(data.error);
  return data;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.ZEROBOUNCE_API_KEY) {
      return NextResponse.json(
        { error: 'Missing ZEROBOUNCE_API_KEY. Add it to the server environment before running verification.' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
    const limit = normalizeLimit(body.limit);
    const priorityMin = configuredPriorityMin();

    const { data, error } = await supabase
      .from('contacts')
      .select('id, user_id, first_name, last_name, full_name, email, email_deliverability, company_name, company_domain, resolved_current_company_name, resolved_current_company_domain')
      .eq('user_id', user.id)
      .is('archived_at', null)
      .eq('crm_is_suppressed', false)
      .gt('priority_score', priorityMin)
      .order('priority_score', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const contacts = (data || []) as ContactForVerification[];
    const contactIds = contacts.map((contact) => contact.id);
    const { data: contactEmailRows, error: contactEmailError } = contactIds.length
      ? await supabase
          .from('contact_emails')
          .select('id, contact_id, email, email_deliverability, email_deliverability_provider')
          .eq('user_id', user.id)
          .in('contact_id', contactIds)
      : { data: [], error: null };

    if (contactEmailError) {
      return NextResponse.json({ error: contactEmailError.message }, { status: 500 });
    }

    const directoryRows = (contactEmailRows || []) as ContactEmailForVerification[];
    const directoryByContact = new Map<string, ContactEmailForVerification[]>();
    for (const row of directoryRows) {
      const list = directoryByContact.get(row.contact_id) ?? [];
      list.push(row);
      directoryByContact.set(row.contact_id, list);
    }

    const emailsToVerify: EmailForVerification[] = [];
    const seen = new Set<string>();
    let skippedInvalidEmail = 0;
    let finderAttempts = 0;
    let finderFound = 0;
    let finderFailed = 0;
    const resultlessErrors: Array<{ contactId: string; email: string; error: string }> = [];
    for (const contact of contacts) {
      const primary = contact.email?.trim() || null;
      const directory = directoryByContact.get(contact.id) ?? [];
      let primaryRepresented = false;
      let hasClearEmail = primary ? looksLikeEmail(primary) : false;

      for (const row of directory) {
        const email = row.email.trim();
        const isPrimary = primary ? emailsEqual(primary, email) : false;
        const deliverability = isPrimary
          ? row.email_deliverability ?? contact.email_deliverability
          : row.email_deliverability;
        if (isPrimary) primaryRepresented = true;
        if (!looksLikeEmail(email)) {
          skippedInvalidEmail += 1;
          continue;
        }
        hasClearEmail = true;
        if (!shouldVerifyDeliverability(deliverability, row.email_deliverability_provider)) continue;
        const key = `${contact.id}:${email.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        emailsToVerify.push({
          contactId: contact.id,
          contactEmailId: row.id,
          email,
          isPrimary,
          source: 'existing',
          contact,
        });
      }

      if (
        primary &&
        !primaryRepresented &&
        looksLikeEmail(primary) &&
        shouldVerifyDeliverability(contact.email_deliverability, null)
      ) {
        const key = `${contact.id}:${primary.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          emailsToVerify.push({
            contactId: contact.id,
            contactEmailId: null,
            email: primary,
            isPrimary: true,
            source: 'existing',
            contact,
          });
        }
      } else if (primary && !primaryRepresented && !looksLikeEmail(primary)) {
        skippedInvalidEmail += 1;
      }

      if (!hasClearEmail) {
        try {
          finderAttempts += 1;
          const found = await findEmailWithZeroBounce(contact);
          const foundEmail = found?.email?.trim() || null;
          if (!foundEmail || !looksLikeEmail(foundEmail)) continue;

          const key = `${contact.id}:${foundEmail.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          finderFound += 1;
          emailsToVerify.push({
            contactId: contact.id,
            contactEmailId: null,
            email: foundEmail,
            isPrimary: !primary || !looksLikeEmail(primary),
            source: 'finder',
            finderMetadata: found ?? undefined,
            contact,
          });
        } catch (e) {
          finderFailed += 1;
          // Keep verification of other contacts moving; surface finder failures
          // in the same error array as validation failures.
          resultlessErrors.push({
            contactId: contact.id,
            email: '',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const result = {
      scanned: data?.length ?? 0,
      eligible: emailsToVerify.length,
      finderAttempts,
      finderFound,
      finderFailed,
      verified: 0,
      invalid: 0,
      catchAll: 0,
      unknown: 0,
      failed: 0,
      skippedInvalidEmail,
      priorityMin,
      limit,
      errors: resultlessErrors,
      items: [] as EmailVerificationResultItem[],
    };

    const pushVerificationItem = (item: EmailVerificationResultItem) => {
      result.items.push(item);
    };

    for (const item of emailsToVerify) {
      const email = item.email;
      const contact = item.contact;
      try {
        const verification = await verifyWithZeroBounce(email);
        const emailDeliverability = normalizeZeroBounceStatus(verification);
        const checkedAt = new Date().toISOString();

        if (item.contactEmailId) {
          const { error: updateEmailError } = await supabase
            .from('contact_emails')
            .update({
              email_deliverability: emailDeliverability,
              email_deliverability_provider: 'zerobounce',
              email_deliverability_checked_at: checkedAt,
              email_deliverability_metadata: verification as Record<string, unknown>,
              updated_at: checkedAt,
            })
            .eq('id', item.contactEmailId)
            .eq('user_id', user.id);

          if (updateEmailError) throw updateEmailError;
        } else if (item.source === 'finder') {
          const category = classifyEnrichedEmail(
            email,
            contact.resolved_current_company_domain || contact.company_domain,
          );
          const { error: insertEmailError } = await supabase
            .from('contact_emails')
            .insert({
              contact_id: item.contactId,
              user_id: user.id,
              email,
              category,
              label: null,
              source_provider: 'zerobounce_finder',
              apollo_email_status: null,
              email_deliverability: emailDeliverability,
              email_deliverability_provider: 'zerobounce',
              email_deliverability_checked_at: checkedAt,
              email_deliverability_metadata: {
                finder: item.finderMetadata ?? null,
                validation: verification,
              },
              updated_at: checkedAt,
            });

          if (insertEmailError && (insertEmailError as { code?: string }).code !== '23505') {
            throw insertEmailError;
          }
        }

        if (item.isPrimary) {
          const contactPatch: Record<string, unknown> = { email_deliverability: emailDeliverability };
          if (item.source === 'finder') contactPatch.email = email;

          const { error: updateContactError } = await supabase
            .from('contacts')
            .update(contactPatch)
            .eq('id', item.contactId)
            .eq('user_id', user.id);

          if (updateContactError) throw updateContactError;
        }

        if (emailDeliverability === 'verified') result.verified += 1;
        else if (emailDeliverability === 'invalid') result.invalid += 1;
        else if (emailDeliverability === 'catch-all') result.catchAll += 1;
        else result.unknown += 1;

        pushVerificationItem({
          contactId: item.contactId,
          contactName: contactDisplayName(contact),
          companyName: contactCompanyName(contact),
          email,
          category: emailVerificationBannerCategory(emailDeliverability),
        });
      } catch (e) {
        result.failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        result.errors.push({
          contactId: item.contactId,
          email,
          error: message,
        });
        pushVerificationItem({
          contactId: item.contactId,
          contactName: contactDisplayName(contact),
          companyName: contactCompanyName(contact),
          email,
          category: 'failed',
          error: message,
        });
      }
    }

    for (const err of resultlessErrors) {
      if (result.items.some((row) => row.contactId === err.contactId && row.category === 'failed')) continue;
      const contact = contacts.find((row) => row.id === err.contactId);
      if (!contact) continue;
      pushVerificationItem({
        contactId: err.contactId,
        contactName: contactDisplayName(contact),
        companyName: contactCompanyName(contact),
        email: err.email,
        category: 'failed',
        error: err.error,
      });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[run-email-verification] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
