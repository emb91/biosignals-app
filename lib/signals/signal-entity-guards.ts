import { verifyNormalizedCompanyEvidence } from '../companies/match-helpers';
import { normalizeCompanyForMatching } from './company-name-variants';

export type CompanyEntityCandidate = {
  id: string;
  company_name: string | null;
  aliases?: string[] | null;
};

export type VerifiedCompanyEntityMatch = {
  companyId: string;
  reason: string;
};

/**
 * Attach source-provided company names to tracked companies only when the
 * existing canonical-name evidence verifier says the match is strong. If two
 * tracked companies both verify, fail closed rather than picking one.
 */
export function verifySourceCompanyNameAgainstCandidates(
  sourceCompanyName: string | null | undefined,
  candidates: CompanyEntityCandidate[],
): VerifiedCompanyEntityMatch | null {
  const sourceNorm = normalizeCompanyForMatching(sourceCompanyName ?? '');
  if (!sourceNorm) return null;

  const verified: VerifiedCompanyEntityMatch[] = [];
  for (const candidate of candidates) {
    const canonicalNorm = normalizeCompanyForMatching(candidate.company_name ?? '');
    const aliasNorms = (candidate.aliases ?? [])
      .map((alias) => normalizeCompanyForMatching(alias))
      .filter(Boolean);
    const result = verifyNormalizedCompanyEvidence(sourceNorm, canonicalNorm, aliasNorms);
    if (result.verified) {
      verified.push({ companyId: candidate.id, reason: result.reason });
    }
  }

  return verified.length === 1 ? verified[0] : null;
}
