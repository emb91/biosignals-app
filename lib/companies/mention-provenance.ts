import type { createAdminClient } from '@/lib/supabase-admin';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import { verifyNormalizedCompanyEvidence } from './match-helpers';
import { resolveCompanyMentions, type ResolveResult } from './resolve-mentions';

type AdminClient = ReturnType<typeof createAdminClient>;

export type CompanyMentionMatch = {
  company_id: string | null;
  company_name: string | null;
  source_field: string;
  source_text: string;
  normalized_source_text: string;
  resolved_by: ResolveResult['resolvedBy'];
  confidence: number;
  verified: boolean;
  verification_reason: string;
};

type MentionInput = {
  sourceText: string | null | undefined;
  sourceField: string;
};

type CompanyDirectoryRow = {
  id: string;
  company_name: string;
  aliases: string[];
};

function cleanSourceText(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function verifyResolvedMention(
  sourceText: string,
  result: ResolveResult,
  company: CompanyDirectoryRow | null,
): Pick<CompanyMentionMatch, 'verified' | 'verification_reason'> {
  if (!result.canonicalId) {
    return { verified: false, verification_reason: 'resolver returned no canonical company' };
  }
  if (!company) {
    return { verified: false, verification_reason: 'canonical company row was not found' };
  }

  const sourceNorm = normalizeCompanyForMatching(sourceText);
  const canonicalNorm = normalizeCompanyForMatching(company.company_name);
  const aliasNorms = company.aliases.map(normalizeCompanyForMatching).filter(Boolean);
  const verification = verifyNormalizedCompanyEvidence(sourceNorm, canonicalNorm, aliasNorms);
  return { verified: verification.verified, verification_reason: verification.reason };
}

async function fetchCompaniesById(
  admin: AdminClient,
  ids: string[],
): Promise<Map<string, CompanyDirectoryRow>> {
  const out = new Map<string, CompanyDirectoryRow>();
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const slice = uniqueIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('companies')
      .select('id, company_name, aliases')
      .in('id', slice);
    if (error) throw new Error(`fetch company provenance rows: ${error.message}`);
    for (const row of data ?? []) {
      const r = row as { id: string; company_name?: string | null; aliases?: string[] | null };
      out.set(r.id, {
        id: r.id,
        company_name: r.company_name ?? '',
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
      });
    }
  }
  return out;
}

export async function buildCompanyMentionMatches(
  admin: AdminClient,
  mentions: MentionInput[],
): Promise<CompanyMentionMatch[]> {
  const cleaned = mentions
    .map((mention) => ({
      sourceText: cleanSourceText(mention.sourceText),
      sourceField: mention.sourceField,
    }))
    .filter((mention): mention is { sourceText: string; sourceField: string } => Boolean(mention.sourceText));

  if (cleaned.length === 0) return [];

  const uniqueSourceTexts = [...new Set(cleaned.map((mention) => mention.sourceText))];
  const resolved = await resolveCompanyMentions(admin, uniqueSourceTexts);
  const companyIds = [...resolved.values()]
    .map((result) => result.canonicalId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const companies = await fetchCompaniesById(admin, companyIds);

  return cleaned.map((mention) => {
    const result = resolved.get(mention.sourceText) ?? {
      name: mention.sourceText,
      normalized: normalizeCompanyForMatching(mention.sourceText),
      canonicalId: null,
      confidence: 0,
      resolvedBy: 'no_match' as const,
    };
    const company = result.canonicalId ? companies.get(result.canonicalId) ?? null : null;
    const verification = verifyResolvedMention(mention.sourceText, result, company);

    return {
      company_id: result.canonicalId,
      company_name: company?.company_name ?? null,
      source_field: mention.sourceField,
      source_text: mention.sourceText,
      normalized_source_text: result.normalized,
      resolved_by: result.resolvedBy,
      confidence: result.confidence,
      verified: verification.verified,
      verification_reason: verification.verification_reason,
    };
  });
}

export function verifiedMentionCompanyIds(matches: CompanyMentionMatch[]): string[] {
  return [
    ...new Set(
      matches
        .filter((match) => match.verified && typeof match.company_id === 'string')
        .map((match) => match.company_id as string),
    ),
  ];
}

export function hasVerifiedCompanyMention(matches: unknown, companyId: string): boolean {
  if (!Array.isArray(matches)) return false;
  return matches.some((match) => {
    if (!match || typeof match !== 'object') return false;
    const row = match as Partial<CompanyMentionMatch>;
    return row.verified === true && row.company_id === companyId;
  });
}

export function hasVerifiedCanonicalCompanyMatch(match: unknown, companyId: string): boolean {
  if (!match || typeof match !== 'object') return false;
  const row = match as Partial<CompanyMentionMatch>;
  return row.verified === true && row.company_id === companyId;
}
