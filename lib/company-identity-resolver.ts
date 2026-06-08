/**
 * Company identity resolver — pins a company stub to the RIGHT real-world
 * organization before we write firmographics onto it.
 *
 * Why this exists: Apollo's `/organizations/enrich?domain=…` is a fuzzy match,
 * not an exact lookup. Asking for `moderna.com` returns "Moderna Housewares"
 * (modernahousewares.com) — a different company with a DIFFERENT domain than we
 * requested. Trusting that blindly corrupted the canonical biotech Moderna row
 * (employee_count=0, HQ=Ventura CA, "boutique housewares distributor").
 *
 * The fix mirrors the SEC CIK resolver (lib/signals/company-cik.ts): a tiered
 * strategy ending in an LLM disambiguation tier, with a verification step and
 * an honest "couldn't resolve" terminal state.
 *
 *   Tier 1 — domain-exact:  enrich by the domain on file, but ACCEPT only if
 *            Apollo's returned primary_domain matches what we asked for.
 *   Tier 2 — name search:   Apollo org search by name → candidate orgs.
 *   Tier 3 — LLM pick:       when >1 plausible candidate, Haiku
 *            (`company_resolution`, OpenRouter-fallback) chooses using the
 *            company name + any linked-contact context, and we verify the
 *            chosen index is one we offered.
 *
 * Terminal: returns { resolved: false, reason } when nothing matches
 * confidently — the caller marks the row failed rather than stamping empty
 * firmographics and calling it a success.
 */
import {
  enrichOrganizationWithApollo,
  searchOrganizationsWithApollo,
  type ApolloOrganizationEnrichmentResult,
  type ApolloOrganization,
} from '@/lib/apollo';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/** True when two domains refer to the same site (ignoring www/protocol/path). */
function domainsMatch(a: string | null, b: string | null): boolean {
  const na = normalizeDomain(a);
  const nb = normalizeDomain(b);
  return !!na && !!nb && na === nb;
}

export type CompanyIdentityContext = {
  /** A contact known to work at this company — strong disambiguation signal. */
  contactName?: string | null;
  contactTitle?: string | null;
  contactHeadline?: string | null;
};

export type CompanyIdentityResolution = {
  resolved: boolean;
  /** Normalized Apollo firmographics for the confirmed org (empty if unresolved). */
  apollo: ApolloOrganizationEnrichmentResult;
  /** The confirmed canonical domain (may differ from the one on file). */
  domain: string | null;
  /** The confirmed company LinkedIn URL, if Apollo had one. */
  linkedinUrl: string | null;
  /** How we resolved — for logging / debugging. */
  method: 'domain_exact' | 'name_single' | 'name_llm' | null;
  /** When unresolved, a human-readable reason for the failure banner. */
  reason: string | null;
};

const MAX_CANDIDATES = 10;

function candidateLine(org: ApolloOrganization, index: number): string {
  const parts = [
    org.name || '(unknown name)',
    org.primary_domain ? `domain: ${org.primary_domain}` : 'no domain',
    org.estimated_num_employees != null ? `~${org.estimated_num_employees} employees` : null,
    org.industry || null,
    [org.city, org.state, org.country].filter(Boolean).join(', ') || null,
  ].filter(Boolean);
  return `${index + 1}. ${parts.join(' — ')}`;
}

/** Convert a raw Apollo search org into the normalized enrichment shape. */
function orgToEnrichmentResult(org: ApolloOrganization): ApolloOrganizationEnrichmentResult {
  return {
    company_name: org.name || undefined,
    company_domain: normalizeDomain(org.primary_domain || org.website_url) || undefined,
    company_linkedin_url: org.linkedin_url || undefined,
    company_description: org.short_description || undefined,
    company_industry: org.industry || undefined,
    company_employee_count: org.estimated_num_employees ?? undefined,
    company_founded_year: org.founded_year ?? undefined,
    company_hq_city: org.city || undefined,
    company_hq_state: org.state || undefined,
    company_hq_country: org.country || undefined,
    company_funding_stage: org.latest_funding_stage || undefined,
    company_total_funding_usd: org.total_funding ?? undefined,
    company_latest_funding_date: org.latest_funding_round_date || undefined,
    raw_company: org,
  };
}

/**
 * Tier 3 — ask Haiku to pick the correct candidate. Returns the chosen
 * candidate index (0-based) or null if the model isn't confident. Verifies the
 * chosen index is one we actually offered (mirrors the CIK resolver's
 * "chosen must be one of the candidates" guard).
 */
async function disambiguateWithLlm(
  companyName: string,
  context: CompanyIdentityContext | null,
  candidates: ApolloOrganization[],
): Promise<number | null> {
  const list = candidates.map((c, i) => candidateLine(c, i)).join('\n');

  const contextLines: string[] = [];
  if (context?.contactName) {
    const role = [context.contactTitle, context.contactHeadline].filter(Boolean).join(' — ');
    contextLines.push(
      `A contact named "${context.contactName}"${role ? ` (${role})` : ''} works at the company we are looking for.`,
    );
  }

  const prompt =
    `I am identifying the real company "${companyName}" in a B2B sales database.\n` +
    (contextLines.length ? `${contextLines.join('\n')}\n` : '') +
    `\nApollo returned these candidate organizations:\n${list}\n\n` +
    `Which candidate is the real "${companyName}" that the contact works at? ` +
    `Prefer the substantial operating company over an unrelated same-name business. ` +
    `Reply with ONLY the candidate number if you are confident, or "none" if none ` +
    `clearly match or you are unsure.`;

  let result: Awaited<ReturnType<typeof completeLlm>> | null = null;
  try {
    result = await completeLlm({
      feature: 'company_resolution',
      prompt,
      maxTokens: 16,
      temperature: 0,
    });
  } catch (err) {
    console.warn(
      '[company-identity] LLM disambiguation failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  void recordLlmUsageEvent({
    provider: result.provider,
    feature: 'company_resolution',
    route: 'lib/company-identity-resolver#disambiguateWithLlm',
    model: result.model,
    usage: result.usage,
    metadata: { company_name: companyName, candidate_count: candidates.length },
  }).catch(() => undefined);

  const text = result.text.trim();
  if (/^none$/i.test(text)) return null;
  const match = text.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const oneBased = Number(match[1]);
  const index = oneBased - 1;
  // Verify the chosen index is one we offered.
  if (Number.isInteger(index) && index >= 0 && index < candidates.length) return index;
  return null;
}

export async function resolveCompanyIdentity(input: {
  companyName: string | null;
  domain: string | null;
  context?: CompanyIdentityContext | null;
}): Promise<CompanyIdentityResolution> {
  const companyName = input.companyName?.trim() || '';
  const requestedDomain = normalizeDomain(input.domain);

  const empty: ApolloOrganizationEnrichmentResult = {};
  const fail = (reason: string): CompanyIdentityResolution => ({
    resolved: false,
    apollo: empty,
    domain: requestedDomain,
    linkedinUrl: null,
    method: null,
    reason,
  });

  // ── Tier 1: domain-exact ───────────────────────────────────────────────
  if (requestedDomain) {
    const byDomain = await enrichOrganizationWithApollo({ company_domain: requestedDomain }).catch(
      (): ApolloOrganizationEnrichmentResult => ({}),
    );
    const returnedDomain = normalizeDomain(byDomain.company_domain);
    if (Object.keys(byDomain).length > 0 && domainsMatch(returnedDomain, requestedDomain)) {
      return {
        resolved: true,
        apollo: byDomain,
        domain: returnedDomain ?? requestedDomain,
        linkedinUrl: byDomain.company_linkedin_url ?? null,
        method: 'domain_exact',
        reason: null,
      };
    }
    // Domain mismatch (e.g. moderna.com → modernahousewares.com): DO NOT trust
    // it. Fall through to name resolution below.
    if (Object.keys(byDomain).length > 0 && returnedDomain && !domainsMatch(returnedDomain, requestedDomain)) {
      console.warn(
        `[company-identity] Apollo domain mismatch for "${companyName}": asked ${requestedDomain}, got ${returnedDomain} — rejecting and falling back to name search.`,
      );
    }
  }

  // ── Tier 2: name search ────────────────────────────────────────────────
  if (!companyName) {
    return fail('No company name or resolvable domain to identify this company.');
  }

  const search = await searchOrganizationsWithApollo({
    keywords: [companyName],
    perPage: MAX_CANDIDATES,
  }).catch(() => null);

  const candidates = (search?.organizations ?? []).filter(
    (o): o is ApolloOrganization => Boolean(o && (o.primary_domain || o.website_url)),
  );

  if (candidates.length === 0) {
    return fail(
      `Couldn't find a matching company in Apollo for "${companyName}"` +
        (requestedDomain ? ` (the domain on file, ${requestedDomain}, didn't match either).` : '.'),
    );
  }

  // Strong exact-name matches narrow the field. If exactly one candidate's
  // normalized name equals the stub name, take it without burning an LLM call.
  const normTarget = normalizeCompanyForMatching(companyName);
  const exactNameMatches = candidates.filter(
    (o) => o.name && normalizeCompanyForMatching(o.name) === normTarget,
  );

  let chosen: ApolloOrganization | null = null;
  let method: CompanyIdentityResolution['method'] = null;

  if (exactNameMatches.length === 1) {
    chosen = exactNameMatches[0];
    method = 'name_single';
  } else {
    // Multiple candidates (or multiple exact-name collisions like
    // "Moderna" vs "Moderna Housewares") → LLM disambiguation.
    const pool = exactNameMatches.length > 1 ? exactNameMatches : candidates;
    const index = await disambiguateWithLlm(companyName, input.context ?? null, pool);
    if (index != null) {
      chosen = pool[index];
      method = 'name_llm';
    }
  }

  if (!chosen) {
    return fail(
      `Couldn't confidently identify which "${companyName}" this is among ${candidates.length} Apollo candidates.`,
    );
  }

  // Re-enrich by the confirmed domain to get the full normalized firmographics
  // shape (funding etc. that search results may omit). Fall back to the search
  // org if the re-enrich returns nothing.
  const confirmedDomain = normalizeDomain(chosen.primary_domain || chosen.website_url);
  let apollo: ApolloOrganizationEnrichmentResult = orgToEnrichmentResult(chosen);
  if (confirmedDomain) {
    const reEnriched = await enrichOrganizationWithApollo({ company_domain: confirmedDomain }).catch(
      (): ApolloOrganizationEnrichmentResult => ({}),
    );
    // Only trust the re-enrich if its domain matches the candidate's domain.
    if (
      Object.keys(reEnriched).length > 0 &&
      domainsMatch(normalizeDomain(reEnriched.company_domain), confirmedDomain)
    ) {
      apollo = reEnriched;
    }
  }

  return {
    resolved: true,
    apollo,
    domain: confirmedDomain ?? requestedDomain,
    linkedinUrl: apollo.company_linkedin_url ?? chosen.linkedin_url ?? null,
    method,
    reason: null,
  };
}
