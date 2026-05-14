/**
 * Display helpers for the target-company funding fields.
 *
 * Target-company enrichment merges two sources for funding data:
 *   - Claude web search → free-text `company_status` (e.g. "Private — Bootstrapped — raised ~$8M")
 *   - Apollo           → structured `funding_stage` + `total_funding_usd`
 *
 * The web search result is the priority — when `company_status` is present we
 * extract a short status descriptor and a dollar figure from it. Apollo's
 * structured fields are only shown when Claude returned no `company_status`.
 *
 * Both renderers (the live setup panel and the saved `/icps` page)
 * import these helpers so the rules stay consistent.
 */

export function formatCurrencyShort(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}

/**
 * Extracts a short ownership/funding descriptor from Claude's free-text company_status.
 * e.g. "Private — Bootstrapped — small funding noted (<$5M total)" → "Private — Bootstrapped"
 */
export function extractFundingStatus(status: string): string | null {
  const parts = status.split(/\s*[—–-]\s*/);
  const first = parts[0]?.trim();
  const second = parts[1]?.trim();
  if (!first) return null;
  const knownDescriptor = /^(bootstrapped|vc[\s-]backed|vc[\s-]funded|venture[\s-]backed|angel[\s-]funded|series\s+[a-z]|seed|pre[\s-]seed|growth|public|private)/i;
  if (second && knownDescriptor.test(second) && second.length < 35) {
    return `${first} — ${second}`;
  }
  return first.length < 35 ? first : null;
}

/**
 * Extracts the first dollar figure from Claude's free-text company_status.
 * e.g. "raised ~$8M from ..." → "~$8M"
 *      "small funding noted (<$5M total)" → "<$5M"
 */
export function extractFundingRaised(status: string): string | null {
  const match = status.match(/([~<>≈]?\s*\$[\d,.]+\s*[MBK]?(?:\s*(?:million|billion|thousand))?)/i);
  return match ? match[1].replace(/\s+/g, '') : null;
}
