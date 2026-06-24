/**
 * Keep contacts.company_id aligned with resolved current employer.
 * Accounts contact_count and the company column link depend on company_id,
 * not resolved_current_company_name alone.
 */

import { normalizeCompanyDomain } from './contact-emails';
import { listActiveCompanyStateForUser, userHasActiveCompany } from './org-company-state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any };

function normalizeName(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

async function userOwnsCompany(
  supabase: SupabaseLike,
  userId: string,
  companyId: string,
): Promise<boolean> {
  return userHasActiveCompany(supabase as any, userId, companyId);
}

/**
 * Resolve the canonical companies.id for a contact's current employer.
 * Domain match wins; name match is fallback when domain is unknown.
 */
export async function linkContactToResolvedCompany(
  supabase: SupabaseLike,
  params: {
    userId: string;
    contactId: string;
    resolvedCompanyName?: string | null;
    resolvedCompanyDomain?: string | null;
    preferredCompanyId?: string | null;
  },
): Promise<string | null> {
  const domain = normalizeCompanyDomain(params.resolvedCompanyDomain);
  const name = (params.resolvedCompanyName ?? '').trim();

  if (
    params.preferredCompanyId &&
    (await userOwnsCompany(supabase, params.userId, params.preferredCompanyId))
  ) {
    return params.preferredCompanyId;
  }

  if (domain) {
    const { data: byDomain, error: domainError } = await supabase
      .from('companies')
      .select('id')
      .eq('domain', domain)
      .limit(1)
      .maybeSingle();

    if (!domainError && byDomain?.id && (await userOwnsCompany(supabase, params.userId, byDomain.id))) {
      return byDomain.id as string;
    }
  }

  if (!name) return null;

  const companyIds = (await listActiveCompanyStateForUser(
    supabase as any,
    params.userId,
    'company_id',
  )).map((row) => row.company_id);
  if (!companyIds.length) return null;
  const { data: byNameRows, error: nameError } = await supabase
    .from('companies')
    .select('id, company_name')
    .in('id', companyIds)
    .ilike('company_name', name);

  if (nameError || !byNameRows?.length) return null;

  const normalizedTarget = normalizeName(name);
  const exact = (byNameRows as Array<{ id: string; company_name: string | null }>).find(
    (row) => normalizeName(row.company_name) === normalizedTarget,
  );
  return exact?.id ?? null;
}

/** Persist contacts.company_id when it differs from the resolved employer. */
export async function syncContactCompanyLink(
  supabase: SupabaseLike,
  params: {
    userId: string;
    contactId: string;
    resolvedCompanyName?: string | null;
    resolvedCompanyDomain?: string | null;
    preferredCompanyId?: string | null;
    currentCompanyId?: string | null;
  },
): Promise<string | null> {
  const linkedId = await linkContactToResolvedCompany(supabase, params);
  // Never drop an existing link just because we couldn't resolve a new one —
  // retain the prior FK so Accounts counts/navigation don't silently break.
  if (!linkedId) return params.currentCompanyId ?? null;
  if (linkedId === params.currentCompanyId) return linkedId;

  const { error } = await supabase
    .from('contacts')
    .update({ company_id: linkedId, updated_at: new Date().toISOString() })
    .eq('id', params.contactId)
    .eq('user_id', params.userId);

  if (error) {
    console.error('[contact-company-link] failed to update contacts.company_id:', error.message);
    return params.currentCompanyId ?? null;
  }

  return linkedId;
}
