import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  buildRefreshEmailCandidates,
  type RefreshEmailCandidate,
} from '@/lib/contact-profile-display';
import {
  classifyEnrichedEmail,
  classifyRefreshEmailCandidate,
  emailsEqual,
  isUsableVerifiedWorkEmail,
  looksLikeEmail,
  DEFAULT_EMAIL_VERIFICATION_PRIORITY_MIN,
  emailVerificationBannerCategory,
  shouldPromoteVerifiedCandidateToPrimary,
  type ContactEmailRow,
  type EmailVerificationResultItem,
} from '@/lib/contact-emails';
import {
  recordProviderUsage,
  zerobounceValidationBillableQuantity,
} from '@/lib/provider-usage';
import { createAdminClient } from '@/lib/supabase-admin';
import { refundCredits, reserveCredits, settleCredits } from '@/lib/billing/credits';
import { WORKSPACE_REQUIRED_ERROR } from '@/lib/org-context';

type ContactForVerification = {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  email_status: string | null;
  email_deliverability: string | null;
  priority_score: number | null;
  company_name: string | null;
  company_domain: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
};

type ContactEmailRecord = {
  id: string;
  contact_id: string;
  email: string;
  category: ContactEmailRow['category'];
  created_at: string;
  email_deliverability: string | null;
  email_deliverability_provider: string | null;
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

type RefreshResult = {
  scanned: number;
  eligible: number;
  skippedAlreadyCurrent: number;
  finderAttempts: number;
  finderFound: number;
  finderFailed: number;
  verified: number;
  invalid: number;
  catchAll: number;
  unknown: number;
  failed: number;
  skippedInvalidEmail: number;
  priorityMin: number;
  limit: number;
  errors: Array<{ contactId: string; email: string; error: string }>;
  items: EmailVerificationResultItem[];
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

function contactCurrentDomain(contact: ContactForVerification): string | null {
  return contact.resolved_current_company_domain?.trim() || contact.company_domain?.trim() || null;
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

function toContactEmailRows(
  contact: ContactForVerification,
  directory: ContactEmailRecord[],
): ContactEmailRow[] {
  return directory.map((row) => ({
    id: row.id,
    contact_id: row.contact_id,
    user_id: contact.user_id,
    email: row.email,
    category: row.category,
    label: null,
    source_provider: null,
    apollo_email_status: null,
    email_deliverability: row.email_deliverability,
    email_deliverability_provider: row.email_deliverability_provider,
    email_deliverability_checked_at: null,
    email_deliverability_metadata: null,
    created_at: row.created_at,
    updated_at: row.created_at,
  }));
}

function deliverabilityForCandidate(
  contact: ContactForVerification,
  candidate: RefreshEmailCandidate,
): string | null {
  if (candidate.isPrimary && candidate.email_deliverability == null) {
    return contact.email_deliverability;
  }
  return candidate.email_deliverability;
}

function incrementDeliverabilityBucket(result: RefreshResult, deliverability: string) {
  if (deliverability === 'verified') result.verified += 1;
  else if (deliverability === 'invalid') result.invalid += 1;
  else if (deliverability === 'catch-all') result.catchAll += 1;
  else result.unknown += 1;
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
    throw new Error(data.error || `Email validation returned HTTP ${res.status}`);
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
    throw new Error(data.error || data.failure_reason || `Email lookup returned HTTP ${res.status}`);
  }

  if (data.error) throw new Error(data.error);
  return data;
}

export async function POST(request: Request) {
  let creditTransactionId: string | null = null;
  let billableValidationCount = 0;
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
        { error: 'Email verification is temporarily unavailable.' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { limit?: unknown; operationId?: string };
    const limit = normalizeLimit(body.limit);
    const priorityMin = configuredPriorityMin();

    const { data, error } = await supabase
      .from('contacts')
      .select(
        'id, user_id, first_name, last_name, full_name, email, email_status, email_deliverability, priority_score, company_name, company_domain, resolved_current_company_name, resolved_current_company_domain',
      )
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
          .select(
            'id, contact_id, email, category, created_at, email_deliverability, email_deliverability_provider',
          )
          .eq('user_id', user.id)
          .in('contact_id', contactIds)
      : { data: [], error: null };

    if (contactEmailError) {
      return NextResponse.json({ error: contactEmailError.message }, { status: 500 });
    }

    const directoryRows = (contactEmailRows || []) as ContactEmailRecord[];
    const directoryByContact = new Map<string, ContactEmailRecord[]>();
    for (const row of directoryRows) {
      const list = directoryByContact.get(row.contact_id) ?? [];
      list.push(row);
      directoryByContact.set(row.contact_id, list);
    }
    const maxValidationRequests = contacts.reduce((sum, contact) => {
      const candidates = buildRefreshEmailCandidates(
        contact.email?.trim() || null,
        toContactEmailRows(contact, directoryByContact.get(contact.id) ?? []),
      );
      return sum + candidates.length;
    }, 0);
    if (maxValidationRequests > 0) {
      const admin = createAdminClient();
      const { data: member } = await admin.from('org_members').select('org_id')
        .eq('user_id', user.id).maybeSingle<{ org_id: string }>();
      if (!member?.org_id) return NextResponse.json(WORKSPACE_REQUIRED_ERROR, { status: 409 });
      const reservation = await reserveCredits({
        orgId: member.org_id,
        userId: user.id,
        action: 'email_validation',
        quantity: maxValidationRequests,
        idempotencyKey: `bulk-email-validation:${body.operationId?.trim() || crypto.randomUUID()}`,
      });
      if (!reservation.ok) return NextResponse.json(reservation, { status: 402 });
      creditTransactionId = reservation.transactionId;
    }

    const result: RefreshResult = {
      scanned: contacts.length,
      eligible: 0,
      skippedAlreadyCurrent: 0,
      finderAttempts: 0,
      finderFound: 0,
      finderFailed: 0,
      verified: 0,
      invalid: 0,
      catchAll: 0,
      unknown: 0,
      failed: 0,
      skippedInvalidEmail: 0,
      priorityMin,
      limit,
      errors: [],
      items: [],
    };

    const pushItem = (item: EmailVerificationResultItem) => {
      result.items.push(item);
    };

    const persistValidatedEmail = async (params: {
      contact: ContactForVerification;
      email: string;
      contactEmailId: string | null;
      emailDeliverability: string;
      verification: ZeroBounceResponse;
      source: 'existing' | 'finder';
      promotePrimary: boolean;
      finderMetadata?: ZeroBounceFinderResponse;
    }) => {
      const checkedAt = new Date().toISOString();
      const category = classifyEnrichedEmail(
        params.email,
        params.contact.resolved_current_company_domain || params.contact.company_domain,
      );

      if (params.contactEmailId) {
        const { error: updateEmailError } = await supabase
          .from('contact_emails')
          .update({
            email_deliverability: params.emailDeliverability,
            email_deliverability_provider: 'zerobounce',
            email_deliverability_checked_at: checkedAt,
            email_deliverability_metadata: params.verification as Record<string, unknown>,
            updated_at: checkedAt,
          })
          .eq('id', params.contactEmailId)
          .eq('user_id', user.id);

        if (updateEmailError) throw updateEmailError;
      } else if (params.source === 'finder') {
        const { error: insertEmailError } = await supabase.from('contact_emails').insert({
          contact_id: params.contact.id,
          user_id: user.id,
          email: params.email,
          category,
          label: null,
          source_provider: 'zerobounce_finder',
          apollo_email_status: null,
          email_deliverability: params.emailDeliverability,
          email_deliverability_provider: 'zerobounce',
          email_deliverability_checked_at: checkedAt,
          email_deliverability_metadata: {
            finder: params.finderMetadata ?? null,
            validation: params.verification,
          },
          updated_at: checkedAt,
        });

        if (insertEmailError && (insertEmailError as { code?: string }).code !== '23505') {
          throw insertEmailError;
        }
      }

      const candidateIsCurrentPrimary = Boolean(
        params.contact.email && emailsEqual(params.contact.email, params.email),
      );
      const shouldPromotePrimary = shouldPromoteVerifiedCandidateToPrimary({
        canReplacePrimary: params.promotePrimary,
        candidateEmail: params.email,
        candidateDeliverability: params.emailDeliverability,
        currentCompanyDomain: contactCurrentDomain(params.contact),
      });

      if (params.promotePrimary && (candidateIsCurrentPrimary || shouldPromotePrimary)) {
        const contactPatch: Record<string, unknown> = {
          email_deliverability: params.emailDeliverability,
        };
        if (shouldPromotePrimary) contactPatch.email = params.email;
        if (category === 'enriched_work' && params.emailDeliverability === 'verified') {
          contactPatch.email_status = 'aligned_current';
          contactPatch.email_status_reasoning = 'Email domain matches the resolved current company.';
        }

        const { error: updateContactError } = await supabase
          .from('contacts')
          .update(contactPatch)
          .eq('id', params.contact.id)
          .eq('user_id', user.id);

        if (updateContactError) throw updateContactError;
      }
    };

    const validateEmail = async (params: {
      contact: ContactForVerification;
      email: string;
      contactEmailId: string | null;
      source: 'existing' | 'finder';
      promotePrimary: boolean;
      finderMetadata?: ZeroBounceFinderResponse;
    }): Promise<string> => {
      result.eligible += 1;
      const verification = await verifyWithZeroBounce(params.email);
      const emailDeliverability = normalizeZeroBounceStatus(verification);

      recordProviderUsage({
        userId: user.id,
        contactId: params.contact.id,
        provider: 'zerobounce',
        eventType: 'zerobounce_email_validate',
        quantity: zerobounceValidationBillableQuantity(verification.status),
        metadata: {
          email: params.email,
          status: verification.status ?? null,
          sub_status: verification.sub_status ?? null,
          source: params.source,
        },
      }).catch(() => {});
      billableValidationCount += zerobounceValidationBillableQuantity(verification.status);

      await persistValidatedEmail({
        contact: params.contact,
        email: params.email,
        contactEmailId: params.contactEmailId,
        emailDeliverability,
        verification,
        source: params.source,
        promotePrimary: params.promotePrimary,
        finderMetadata: params.finderMetadata,
      });

      incrementDeliverabilityBucket(result, emailDeliverability);
      pushItem({
        contactId: params.contact.id,
        contactName: contactDisplayName(params.contact),
        companyName: contactCompanyName(params.contact),
        email: params.email,
        category: emailVerificationBannerCategory(emailDeliverability),
      });

      return emailDeliverability;
    };

    const findAndValidateEmail = async (contact: ContactForVerification): Promise<boolean> => {
      result.finderAttempts += 1;
      try {
        const found = await findEmailWithZeroBounce(contact);
        const foundEmail = found?.email?.trim() || null;
        if (!foundEmail || !looksLikeEmail(foundEmail)) return false;

        result.finderFound += 1;
        recordProviderUsage({
          userId: user.id,
          contactId: contact.id,
          provider: 'zerobounce',
          eventType: 'zerobounce_email_finder',
          metadata: { email: foundEmail, domain: found?.domain ?? null },
        }).catch(() => {});

        const deliverability = await validateEmail({
          contact,
          email: foundEmail,
          contactEmailId: null,
          source: 'finder',
          promotePrimary: true,
          finderMetadata: found ?? undefined,
        });

        return isUsableVerifiedWorkEmail(
          deliverability,
          foundEmail,
          contactCurrentDomain(contact),
        );
      } catch (e) {
        result.finderFailed += 1;
        const message = e instanceof Error ? e.message : String(e);
        result.errors.push({ contactId: contact.id, email: '', error: message });
        pushItem({
          contactId: contact.id,
          contactName: contactDisplayName(contact),
          companyName: contactCompanyName(contact),
          email: '',
          category: 'failed',
          error: message,
        });
        return false;
      }
    };

    for (const contact of contacts) {
      const primary = contact.email?.trim() || null;
      const directory = directoryByContact.get(contact.id) ?? [];
      const emailRows = toContactEmailRows(contact, directory);
      const candidates = buildRefreshEmailCandidates(primary, emailRows);
      const currentDomain = contactCurrentDomain(contact);

      if (candidates.length === 0) {
        continue;
      }

      const first = candidates[0];
      const firstAction = classifyRefreshEmailCandidate(
        {
          email: first.email,
          email_deliverability: deliverabilityForCandidate(contact, first),
          email_deliverability_provider: first.email_deliverability_provider,
        },
        currentDomain,
      );

      if (firstAction === 'good' && first.isPrimary) {
        result.skippedAlreadyCurrent += 1;
        continue;
      }

      let resolved = false;

      for (const candidate of candidates) {
        const row = {
          email: candidate.email,
          email_deliverability: deliverabilityForCandidate(contact, candidate),
          email_deliverability_provider: candidate.email_deliverability_provider,
        };
        const action = classifyRefreshEmailCandidate(row, currentDomain);

        if (action === 'good') {
          if (!candidate.isPrimary) {
            await persistValidatedEmail({
              contact,
              email: candidate.email,
              contactEmailId: candidate.contactEmailId,
              emailDeliverability: row.email_deliverability || 'verified',
              verification: {},
              source: 'existing',
              promotePrimary: true,
            });
          } else {
            result.skippedAlreadyCurrent += 1;
          }
          resolved = true;
          break;
        }

        if (action === 'skip') continue;

        try {
          const deliverability = await validateEmail({
            contact,
            email: candidate.email,
            contactEmailId: candidate.contactEmailId,
            source: 'existing',
            promotePrimary: true,
          });

          if (isUsableVerifiedWorkEmail(deliverability, candidate.email, currentDomain)) {
            resolved = true;
            break;
          }
        } catch (e) {
          result.failed += 1;
          const message = e instanceof Error ? e.message : String(e);
          result.errors.push({
            contactId: contact.id,
            email: candidate.email,
            error: message,
          });
          pushItem({
            contactId: contact.id,
            contactName: contactDisplayName(contact),
            companyName: contactCompanyName(contact),
            email: candidate.email,
            category: 'failed',
            error: message,
          });
        }
      }

      // Email finding is an explicit 11-credit customer action. Background
      // validation never starts a finder request automatically.
    }

    await settleCredits(creditTransactionId, billableValidationCount * 0.5);
    creditTransactionId = null;
    return NextResponse.json({ success: true, result });
  } catch (error) {
    await refundCredits(creditTransactionId).catch(() => {});
    console.error('[run-email-verification] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
