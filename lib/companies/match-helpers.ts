/**
 * Pure matching helpers used by the canonical company resolver.
 *
 * Kept separate from resolve-mentions.ts so they can be unit-tested without
 * pulling in the Supabase admin client or LLM wrapper. No external imports
 * on purpose.
 */

/**
 * Generic biotech / pharma / corporate tokens that appear in many company
 * names but carry no distinguishing meaning. Two companies sharing only one
 * of these is NOT a match — "Junshi Biosciences" and "Enzene Biosciences"
 * are different companies that happen to share "biosciences".
 *
 * Used to filter trigram candidates before LLM disambiguation: if the only
 * token overlap between input and candidate is from this set, the candidate
 * is discarded rather than asked about.
 */
export const GENERIC_BIOTECH_TOKENS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'of',
  'for',
  'biosciences',
  'bioscience',
  'biotech',
  'biotechnology',
  'biotechnologies',
  'biotherapeutics',
  'therapeutics',
  'pharmaceuticals',
  'pharmaceutical',
  'pharma',
  'medicines',
  'medical',
  'health',
  'healthcare',
  'sciences',
  'life',
  'bio',
  'genomics',
  'diagnostics',
  'oncology',
  'group',
  'holdings',
  'holding',
  'global',
  'international',
  'industries',
  'systems',
  'solutions',
  'technologies',
  'labs',
  'laboratories',
  'research',
]);

/**
 * Tokenize a normalized company name into "distinctive" tokens — those that
 * are at least 3 chars long and not in the generic-suffix set.
 */
export function distinctiveTokens(normalized: string): Set<string> {
  const out = new Set<string>();
  for (const t of normalized.split(' ')) {
    if (t.length < 3) continue;
    if (GENERIC_BIOTECH_TOKENS.has(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * Returns true if `input` and `candidate` share at least one DISTINCTIVE
 * (non-generic-suffix) token. Used to pre-filter trigram candidates so we
 * don't waste LLM calls on names that only overlap on "biosciences" / etc.
 */
export function sharesDistinctiveToken(inputNorm: string, candidateNorm: string): boolean {
  const a = distinctiveTokens(inputNorm);
  if (a.size === 0) return true; // input has no distinctive tokens — fall back to LLM
  const b = distinctiveTokens(candidateNorm);
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * Returns coverage (0..1) of `inputTokens` against the canonical's name and
 * any aliases, or `null` if no candidate has any distinctive overlap.
 *
 * Matching rule: pick the SHORTER token set as the "must-be-covered" side and
 * check that every one of its tokens appears in the LONGER side. This handles
 * both directions of length mismatch ("arvinas" ⊂ "arvinas therapeutics" and
 * vice versa) without the raw-substring false positive where "bayer" matches
 * inside "forbayer holdings".
 *
 * Tokens shorter than 3 chars and generic corporate/articles/prepositions are
 * ignored on the candidate side too. This prevents canonical names like
 * "The MT Group" from matching every extracted organization containing "the".
 */
export function uniqueTokenCoverage(
  inputTokens: Set<string>,
  canonicalName: string,
  canonicalAliases: string[],
): number | null {
  if (inputTokens.size === 0) return null;
  const candidates = [canonicalName, ...canonicalAliases];
  let bestCoverage = 0;
  for (const c of candidates) {
    const cTokens = distinctiveTokens(c);
    if (cTokens.size === 0) continue;
    const shorter = inputTokens.size <= cTokens.size ? inputTokens : cTokens;
    const longer = inputTokens.size <= cTokens.size ? cTokens : inputTokens;
    let hits = 0;
    for (const t of shorter) if (longer.has(t)) hits += 1;
    const coverage = hits / shorter.size;
    if (coverage > bestCoverage) bestCoverage = coverage;
  }
  return bestCoverage === 0 ? null : bestCoverage;
}

export function verifyNormalizedCompanyEvidence(
  sourceNorm: string,
  canonicalNorm: string,
  aliasNorms: string[] = [],
): { verified: boolean; reason: string } {
  const acceptedNames = [canonicalNorm, ...aliasNorms].filter(Boolean);

  if (acceptedNames.includes(sourceNorm)) {
    return { verified: true, reason: 'source phrase exactly matches company name or alias' };
  }

  const sourceDistinctive = distinctiveTokens(sourceNorm);
  const coverage = uniqueTokenCoverage(sourceDistinctive, canonicalNorm, aliasNorms);
  if (coverage !== null && coverage >= 1) {
    return {
      verified: true,
      reason: 'source phrase has full distinctive-token coverage with company name or alias',
    };
  }

  if (sourceDistinctive.size === 0) {
    return { verified: false, reason: 'source phrase has no distinctive company tokens' };
  }

  return {
    verified: false,
    reason: 'source phrase does not match the full company name or a known alias',
  };
}
