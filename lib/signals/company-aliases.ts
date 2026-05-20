/**
 * Populate the `aliases` column on companies via Haiku.
 *
 * Asks the model for the company's known legal entity names, subsidiaries
 * frequently used as filers, and common name variations. These are the names
 * signal monitors search against in external sources (FDA sponsor, patent
 * assignee, ClinicalTrials.gov sponsor, etc.).
 *
 * Idempotent — safe to call multiple times; re-runs only if the aliases column
 * is empty or older than ALIAS_REFRESH_DAYS.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase-admin';

const HAIKU_MODEL = 'claude-haiku-4-5';
const ALIAS_REFRESH_DAYS = 180;
const MAX_ALIASES_PER_COMPANY = 12;

function requireAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildPrompt(companyName: string, domain: string | null): string {
  const domainHint = domain ? `\nWebsite: ${domain}` : '';
  return `You are helping match a company against external regulatory and patent databases (FDA, ClinicalTrials.gov, USPTO).

Company: ${companyName}${domainHint}

Return a JSON array (and nothing else) of all known legal-entity names, subsidiaries that file patents/regulatory submissions on the company's behalf, and common name variations that might appear in regulatory or patent records. Include:
- The current legal name (e.g. "ModernaTx, Inc.")
- Historical legal names if the company was renamed
- Wholly-owned subsidiaries that are common filers (e.g. "Genentech, Inc." for Roche)
- Non-US parent or sister entities for global filings (e.g. "F. Hoffmann-La Roche AG")
- Common formatting variants used in regulatory data (e.g. "PFIZER INC", "Pfizer Inc.")
- NOT acquired competitors, brand names of products, or partners

If you don't know the company, return an empty array [].

Return at most ${MAX_ALIASES_PER_COMPANY} entries. Output ONLY the JSON array, no prose.

Example output for "Roche":
["F. Hoffmann-La Roche AG", "Roche Holding AG", "Hoffmann-La Roche Inc.", "Genentech, Inc.", "Roche Diagnostics GmbH", "Roche Diabetes Care"]`;
}

function parseAliasArray(text: string): string[] {
  // Tolerant parse — handles raw arrays, markdown-wrapped, or with leading prose.
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const bracketStart = candidate.indexOf('[');
  const bracketEnd = candidate.lastIndexOf(']');
  if (bracketStart === -1 || bracketEnd === -1 || bracketEnd < bracketStart) return [];
  const sliced = candidate.slice(bracketStart, bracketEnd + 1);
  try {
    const parsed = JSON.parse(sliced) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, MAX_ALIASES_PER_COMPANY);
  } catch {
    return [];
  }
}

async function fetchAliasesFromLlm(companyName: string, domain: string | null): Promise<string[]> {
  const client = requireAnthropicClient();
  const message = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: buildPrompt(companyName, domain) }],
  });
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('\n');
  return parseAliasArray(text);
}

type EnsureAliasesOptions = {
  /** Override the default 180-day staleness check; pass 0 to force a refresh. */
  refreshIfOlderThanDays?: number;
};

export type EnsureAliasesResult = {
  companyId: string;
  companyName: string;
  aliases: string[];
  source: 'cached' | 'llm' | 'skipped_unknown';
};

/**
 * Make sure a company has aliases populated. Cheap to call repeatedly —
 * returns the cached row unless aliases are empty or stale.
 */
export async function ensureCompanyAliases(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  opts: EnsureAliasesOptions = {},
): Promise<EnsureAliasesResult> {
  const { data, error } = await admin
    .from('companies')
    .select('id, company_name, domain, aliases, aliases_updated_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw new Error(`load company failed: ${error.message}`);
  if (!data) throw new Error(`company not found: ${companyId}`);
  const row = data as {
    id: string;
    company_name: string | null;
    domain: string | null;
    aliases: string[] | null;
    aliases_updated_at: string | null;
  };

  const name = row.company_name?.trim();
  if (!name) {
    return { companyId, companyName: '', aliases: [], source: 'skipped_unknown' };
  }

  const refreshAfterDays = opts.refreshIfOlderThanDays ?? ALIAS_REFRESH_DAYS;
  const aliases = row.aliases ?? [];
  const updatedAt = row.aliases_updated_at ? new Date(row.aliases_updated_at).getTime() : 0;
  const ageDays = updatedAt ? (Date.now() - updatedAt) / (1000 * 60 * 60 * 24) : Infinity;
  const isFresh = aliases.length > 0 && ageDays < refreshAfterDays;
  if (isFresh) {
    return { companyId, companyName: name, aliases, source: 'cached' };
  }

  const fetched = await fetchAliasesFromLlm(name, row.domain);
  const { error: updateErr } = await admin
    .from('companies')
    .update({ aliases: fetched, aliases_updated_at: new Date().toISOString() })
    .eq('id', companyId);
  if (updateErr) throw new Error(`update aliases failed: ${updateErr.message}`);
  return { companyId, companyName: name, aliases: fetched, source: 'llm' };
}

/**
 * Bulk version — used by the backfill script and on-demand refresh paths.
 */
export async function ensureAliasesForCompanies(
  admin: ReturnType<typeof createAdminClient>,
  companyIds: string[],
  opts: EnsureAliasesOptions = {},
): Promise<EnsureAliasesResult[]> {
  const results: EnsureAliasesResult[] = [];
  for (const companyId of companyIds) {
    try {
      results.push(await ensureCompanyAliases(admin, companyId, opts));
    } catch (error) {
      console.error(`[ensureAliasesForCompanies] ${companyId} failed:`, error);
      results.push({
        companyId,
        companyName: '',
        aliases: [],
        source: 'skipped_unknown',
      });
    }
  }
  return results;
}
