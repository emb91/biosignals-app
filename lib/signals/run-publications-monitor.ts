/**
 * Publications signal monitor — PubMed E-utilities.
 *
 * Searches PubMed for papers published in the last `lookbackDays` (default 30)
 * that either:
 *   (a) list one of the user's tracked companies as an author affiliation, OR
 *   (b) include one of the user's contacts as an author, with the contact's
 *       company used as an affiliation cross-check to reduce false positives.
 *
 * Signal mapping:
 *   company affiliation match → `publication`        (scope: company)
 *   contact author match      → `new_paper_published` (scope: contact)
 *
 * PubMed API calls:
 *   1. esearch.fcgi  — query → PMIDs
 *   2. efetch.fcgi   — PMIDs → full XML (abstract + author affiliations)
 *
 * efetch replaces esummary. esummary returns only author names with no
 * institution strings — we need the full affiliation text to (a) confirm the
 * company name actually appears in the paper, and (b) populate meaningful
 * signal-card summaries (abstract text rather than "Smith J. Nat Biotech.").
 *
 * Rate limit: 3 req/sec without NCBI_API_KEY; 10/sec with key.
 * datetype=pdat&reldate=N: papers with pub date ≤ N days ago.
 */

import { createAdminClient } from '@/lib/supabase-admin';
import { distinctiveTokens } from '@/lib/companies/match-helpers';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';
import { buildAdmissionMetadata } from '@/lib/signals/signal-admission';

// ── Types ──────────────────────────────────────────────────────────────────────

type CompanyRow = {
  id: string;
  company_name: string | null;
  aliases: string[] | null;
};

type ContactRow = {
  id: string;
  full_name: string | null;
  company_id: string | null;
};

/** A single named author on a paper. CollectiveName / group authors are skipped. */
type PubMedAuthor = {
  /** Lowercased surname, e.g. "ma". */
  lastName: string;
  /** Lowercased first initial, e.g. "c". */
  firstInitial: string;
};

/** Parsed result from efetch XML for a single article. */
type PubMedArticle = {
  pmid: string;
  title: string;
  abstract: string;
  /** All unique affiliation strings across every author in the paper. */
  affiliations: string[];
  /** Named authors in publication order. Used for contact cross-matching. */
  authors: PubMedAuthor[];
  pubdate: string;
  journal: string;
  doi: string | null;
};

export type PublicationsMonitorInput = {
  userId: string;
  companyIds?: string[];
  contactIds?: string[];
  /** How many days back to search. Default 30, clamped [1, 60]. */
  lookbackDays?: number;
  /** Max PMIDs returned per company esearch call. Default 20. */
  maxPerCompany?: number;
  /** Max PMIDs returned per contact esearch call. Default 10. */
  maxPerContact?: number;
};

export type PublicationsMonitorResult = {
  companies_processed: number;
  companies_failed: number;
  contacts_processed: number;
  contacts_failed: number;
  company_articles_scanned: number;
  contact_articles_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  recomputed_contacts: string[];
  failures: Array<{ entity_type: 'company' | 'contact'; entity_id: string; error: string }>;
};

// ── PubMed API ─────────────────────────────────────────────────────────────────

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const TOOL_PARAM = 'tool=arcova&email=platform%40arcova.bio';

function pubmedIntervalMs(): number {
  return process.env.NCBI_API_KEY ? 105 : 340;
}

function apiKeyParam(): string {
  const key = process.env.NCBI_API_KEY;
  return key ? `&api_key=${encodeURIComponent(key)}` : '';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** esearch: query → array of PMID strings. */
async function pubmedSearch(term: string, relDays: number, retMax: number): Promise<string[]> {
  const url =
    `${PUBMED_BASE}/esearch.fcgi?db=pubmed` +
    `&term=${encodeURIComponent(term)}` +
    `&datetype=pdat&reldate=${relDays}` +
    `&retmax=${retMax}&retmode=json` +
    `&${TOOL_PARAM}${apiKeyParam()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`PubMed esearch HTTP ${res.status}`);
  type ESearchResponse = { esearchresult?: { idlist?: string[] } };
  const json = (await res.json()) as ESearchResponse;
  return json.esearchresult?.idlist ?? [];
}

// ── efetch XML parser ──────────────────────────────────────────────────────────

/** Pull all text content from every occurrence of <Tag>...</Tag>. Strips inner tags. */
function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)<\\/${tag}>`, 'gsi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) results.push(text);
  }
  return results;
}

/** Pull first match. */
function xmlFirst(xml: string, tag: string): string {
  return xmlAll(xml, tag)[0] ?? '';
}

/**
 * Same as xmlAll but preserves the inner XML markup so the caller can run
 * sub-tag extraction (e.g. <Author> blocks containing <LastName>, <ForeName>).
 */
function xmlAllRaw(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)<\\/${tag}>`, 'gsi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1]);
  }
  return results;
}

/**
 * Parse <Author> blocks from a <PubmedArticle> XML body. Skips collective
 * group authors (which have <CollectiveName> instead of <LastName>) and any
 * author missing a usable first name / initial.
 */
function parseAuthors(block: string): PubMedAuthor[] {
  const out: PubMedAuthor[] = [];
  for (const authorXml of xmlAllRaw(block, 'Author')) {
    const lastName = xmlFirst(authorXml, 'LastName').trim();
    if (!lastName) continue;
    const foreName = xmlFirst(authorXml, 'ForeName').trim();
    const initials = xmlFirst(authorXml, 'Initials').trim();
    const firstChar = (foreName || initials).charAt(0);
    if (!firstChar) continue;
    out.push({
      lastName: lastName.toLowerCase(),
      firstInitial: firstChar.toLowerCase(),
    });
  }
  return out;
}

/**
 * Parse a single <PubmedArticle> XML block into a PubMedArticle.
 * Structured abstracts (Background/Methods/Results/Conclusion labels) are
 * concatenated into one string; the label prefixes make them readable as-is.
 */
function parseArticleXml(block: string, pmid: string): PubMedArticle {
  const title = xmlFirst(block, 'ArticleTitle');

  // Structured abstracts have multiple <AbstractText Label="..."> elements.
  const abstractParts = xmlAll(block, 'AbstractText');
  const abstract = abstractParts.join(' ').trim();

  // Collect all <Affiliation> strings — they appear inside <AffiliationInfo>
  // blocks on each author, and sometimes at article level.
  const affiliations = [...new Set(xmlAll(block, 'Affiliation'))];

  // Publication date — prefer <ArticleDate> (epub), fall back to <PubDate>.
  let pubdate = '';
  const articleDateBlock = xmlFirst(block, 'ArticleDate');
  if (articleDateBlock) {
    const y = xmlFirst(articleDateBlock, 'Year');
    const mo = xmlFirst(articleDateBlock, 'Month');
    const d = xmlFirst(articleDateBlock, 'Day');
    pubdate = [y, mo, d].filter(Boolean).join(' ');
  }
  if (!pubdate) {
    const pubDateBlock = xmlFirst(block, 'PubDate');
    const y = xmlFirst(pubDateBlock, 'Year');
    const mo = xmlFirst(pubDateBlock, 'Month') || xmlFirst(pubDateBlock, 'Season');
    pubdate = [y, mo].filter(Boolean).join(' ');
  }

  // Journal name — prefer full title, fall back to ISO abbreviation.
  const journal = xmlFirst(block, 'Title') || xmlFirst(block, 'ISOAbbreviation');

  // DOI from <ELocationID EIdType="doi">
  const doiMatch = /EIdType="doi"[^>]*>(.*?)<\/ELocationID>/i.exec(block);
  const doi = doiMatch ? doiMatch[1].replace(/<[^>]+>/g, '').trim() : null;

  // Named authors (skips collective/group authors) — used downstream to
  // cross-match against the user's contacts list.
  const authors = parseAuthors(block);

  return { pmid, title, abstract, affiliations, authors, pubdate, journal, doi };
}

/**
 * efetch: PMIDs → map of PMID → PubMedArticle (abstract + affiliations).
 * Batches up to 200 PMIDs per call.
 */
async function pubmedFetch(pmids: string[]): Promise<Map<string, PubMedArticle>> {
  const result = new Map<string, PubMedArticle>();
  if (pmids.length === 0) return result;

  for (let i = 0; i < pmids.length; i += 200) {
    const chunk = pmids.slice(i, i + 200);
    const url =
      `${PUBMED_BASE}/efetch.fcgi?db=pubmed` +
      `&id=${chunk.join(',')}` +
      `&rettype=abstract&retmode=xml` +
      `&${TOOL_PARAM}${apiKeyParam()}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`PubMed efetch HTTP ${res.status}`);

    const xml = await res.text();

    // Split on <PubmedArticle> boundaries.
    const articleBlocks = xml.split(/<PubmedArticle[^>]*>/).slice(1);
    for (const block of articleBlocks) {
      // PMID is always the first <PMID> in the block.
      const pmidMatch = /<PMID[^>]*>(\d+)<\/PMID>/i.exec(block);
      if (!pmidMatch) continue;
      const pmid = pmidMatch[1];
      result.set(pmid, parseArticleXml(block, pmid));
    }

    if (i + 200 < pmids.length) await sleep(pubmedIntervalMs());
  }
  return result;
}

// ── Matching helpers ───────────────────────────────────────────────────────────

/**
 * Min character length required for an alias to be considered. Short aliases
 * (`BMS`, `MSD`, `Arc`) substring-match too aggressively against PubMed
 * affiliations and cause false positives.
 */
const MIN_ALIAS_LENGTH = 4;

/**
 * Escape a string for use as a literal inside a RegExp.
 */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word substring check against `haystack`. Word boundaries are defined as
 * non-alphanumeric (so "Pfizer" matches "Pfizer, " and "(Pfizer)" but NOT
 * "PfizerPharma" or "Forbayer").
 *
 * `haystack` is assumed lowercase. `needle` is lowercased here for safety.
 */
function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = escapeForRegex(needle.toLowerCase());
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return re.test(haystack);
}

/**
 * Returns true if the company name (or a qualifying alias) appears in at least
 * one affiliation string. Three guards against false positives:
 *
 *   1. WORD-BOUNDARY match (not bare substring). "Bayer" no longer matches
 *      "Forbayer". "BMS" no longer matches "BMSc".
 *   2. MIN ALIAS LENGTH. Aliases shorter than `MIN_ALIAS_LENGTH` are skipped
 *      regardless. Three-letter aliases ("BMS", "MSD") false-match too often
 *      to be trusted, even with word boundaries.
 *   3. DISTINCTIVE-TOKEN guard. The company name must have at least one
 *      distinctive (non-generic) token, and that token must appear in the
 *      affiliation as a whole word. Stops "Bio Therapeutics" (no distinctive
 *      tokens) from matching every academic affiliation that says "bio".
 *
 * The resolver's `distinctiveTokens()` and `normalizeCompanyForMatching()`
 * are reused so this stays consistent with the rest of the canonical pipeline.
 */
function companyInAffiliations(
  name: string,
  aliases: string[],
  affiliations: string[],
): boolean {
  if (!name) return false;
  const haystack = affiliations.join(' ').toLowerCase();
  if (!haystack) return false;

  // Distinctive-token guard. If the company name has zero distinctive tokens
  // (i.e. it's entirely generic biotech words like "Bio Therapeutics"), refuse
  // to match — too noisy on PubMed affiliations.
  const normalizedName = normalizeCompanyForMatching(name);
  const nameDistinct = distinctiveTokens(normalizedName);
  if (nameDistinct.size === 0) return false;

  // At least one distinctive token must appear as a whole word in the
  // affiliation. This is the floor — the full-name or alias check below is the
  // ceiling.
  let anyDistinctiveTokenSeen = false;
  for (const tok of nameDistinct) {
    if (containsWholeWord(haystack, tok)) {
      anyDistinctiveTokenSeen = true;
      break;
    }
  }
  if (!anyDistinctiveTokenSeen) return false;

  // Primary: whole-word match on the normalized company name.
  if (containsWholeWord(haystack, normalizedName)) return true;

  // Secondary: whole-word match on any qualifying alias.
  for (const alias of aliases) {
    if (!alias) continue;
    const normalizedAlias = normalizeCompanyForMatching(alias);
    if (normalizedAlias.length < MIN_ALIAS_LENGTH) continue;
    // Generic-only aliases (rare but possible) — skip.
    if (distinctiveTokens(normalizedAlias).size === 0) continue;
    if (containsWholeWord(haystack, normalizedAlias)) return true;
  }

  return false;
}

function firstMatchingAffiliation(
  name: string,
  aliases: string[],
  affiliations: string[],
): string | null {
  return affiliations.find((affiliation) => companyInAffiliations(name, aliases, [affiliation])) ?? null;
}

/** Build a PubMed source URL. */
function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

/** DOI URL if available, otherwise PubMed fallback. */
function sourceUrlForArticle(pmid: string, article: PubMedArticle): string {
  if (article.doi) return `https://doi.org/${article.doi}`;
  return pubmedUrl(pmid);
}

/** Trim title to ≤ 150 chars. */
function trimTitle(title: string): string {
  const clean = title.replace(/<[^>]+>/g, '').trim() || `PubMed article ${title}`;
  return clean.length > 150 ? `${clean.slice(0, 147)}…` : clean;
}

/** ISO date string from a PubMed pubdate like "2025 May 23" or "2025 May". */
function isoDate(pubdate: string): string {
  if (!pubdate) return new Date().toISOString();
  const parsed = Date.parse(pubdate);
  return isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

/**
 * Extract `"Last F"` style author query token from a full name.
 * Returns null if extraction is not reliable (single-word name, etc.).
 */
function authorQueryToken(fullName: string): string | null {
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  // "Last, First" format
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx > 0) {
    const last = trimmed.slice(0, commaIdx).trim();
    const rest = trimmed.slice(commaIdx + 1).trim();
    const firstInitial = rest.charAt(0).toUpperCase();
    if (last && firstInitial) return `${last} ${firstInitial}`;
  }
  // "First [Middle] Last" format
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const firstInitial = parts[0].charAt(0).toUpperCase();
  return `${last} ${firstInitial}`;
}

function articleHasAuthorToken(article: PubMedArticle, authorToken: string): boolean {
  const normalized = authorToken.trim().toLowerCase();
  return article.authors.some((author) => `${author.lastName} ${author.firstInitial}` === normalized);
}

// ── Deduplication ──────────────────────────────────────────────────────────────

async function fetchExistingSourceEventIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  source: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(candidateIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Set<string>();
  const found = new Set<string>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const slice = uniqueIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('signal_source_events')
      .select('source_event_id')
      .eq('user_id', userId)
      .eq('source', source)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

const SOURCE = 'pubmed';

// ── Main monitor ───────────────────────────────────────────────────────────────

export async function runPublicationsMonitor(
  input: PublicationsMonitorInput,
): Promise<PublicationsMonitorResult> {
  const admin = createAdminClient();
  const lookbackDays = Math.min(60, Math.max(1, Math.floor(input.lookbackDays ?? 30)));
  const maxPerCompany = Math.min(50, Math.max(1, input.maxPerCompany ?? 20));
  const maxPerContact = Math.min(20, Math.max(1, input.maxPerContact ?? 10));
  const intervalMs = pubmedIntervalMs();

  // ── Load user's active companies ────────────────────────────────────────────
  let ownedCompanyIds = (await listActiveCompanyStateForUser(admin, input.userId))
    .map((r) => r.company_id);
  const contactEligibleCompanyIds = new Set(ownedCompanyIds);

  if (Array.isArray(input.companyIds) && input.companyIds.length > 0) {
    const allowed = new Set(input.companyIds.filter(Boolean));
    ownedCompanyIds = ownedCompanyIds.filter((id) => allowed.has(id));
  }

  // ── Load user's contacts ────────────────────────────────────────────────────
  let contactQuery = admin
    .from('contacts')
    .select('id, full_name, company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .not('full_name', 'is', null);

  if (Array.isArray(input.contactIds) && input.contactIds.length > 0) {
    contactQuery = contactQuery.in('id', input.contactIds);
  }

  const { data: contacts, error: contactsError } = await contactQuery;
  if (contactsError) throw new Error(`contacts query: ${contactsError.message}`);
  const contactRows = ((contacts ?? []) as ContactRow[]).filter(
    (contact) => Boolean(contact.company_id && contactEligibleCompanyIds.has(contact.company_id)),
  );

  // ── Build contact author-token lookup for the company-phase cross-match ────
  // We want: "for every paper we fetch in the company phase, if any author on
  // the paper matches a tracked contact, emit a new_paper_published signal for
  // that contact." The token is the same `Last F` format the contact phase
  // already uses for PubMed queries.
  //
  // We carry the contact's company name + aliases so the matcher can verify
  // the contact's actual employer appears in the paper's affiliations — that
  // disambiguates the many-thousands of "Ma C" / "Wang Y" / "Chen J" authors
  // who share a token but aren't actually our contact.
  type ContactCrossMatchEntry = {
    contact: ContactRow;
    companyName: string;
    companyAliases: string[];
  };
  const contactsByAuthorToken = new Map<string, ContactCrossMatchEntry[]>();
  {
    const allContactRows = contactRows;
    const contactCompanyIdsForXMatch = [
      ...new Set(
        allContactRows
          .map((c) => c.company_id)
          .filter((v): v is string => typeof v === 'string' && Boolean(v)),
      ),
    ];
    const xMatchCompanyInfo = new Map<string, { name: string; aliases: string[] }>();
    if (contactCompanyIdsForXMatch.length > 0) {
      const { data: companyRows } = await admin
        .from('companies')
        .select('id, company_name, aliases')
        .in('id', contactCompanyIdsForXMatch);
      for (const r of (companyRows ?? []) as Array<{
        id: string;
        company_name: string | null;
        aliases: string[] | null;
      }>) {
        if (r.company_name) {
          xMatchCompanyInfo.set(r.id, {
            name: r.company_name,
            aliases: (r.aliases ?? []).filter(Boolean) as string[],
          });
        }
      }
    }
    for (const contact of allContactRows) {
      const fullName = contact.full_name?.trim();
      if (!fullName) continue;
      const token = authorQueryToken(fullName)?.toLowerCase();
      if (!token) continue;
      // Without a company we can't safely verify the author identity — skip,
      // otherwise every common "Last F" token false-matches at random.
      if (!contact.company_id) continue;
      const companyInfo = xMatchCompanyInfo.get(contact.company_id);
      if (!companyInfo) continue;
      const arr = contactsByAuthorToken.get(token) ?? [];
      arr.push({ contact, companyName: companyInfo.name, companyAliases: companyInfo.aliases });
      contactsByAuthorToken.set(token, arr);
    }
  }

  // ── Result accumulators ─────────────────────────────────────────────────────
  let companiesProcessed = 0;
  let companiesFailed = 0;
  let contactsProcessed = 0;
  let contactsFailed = 0;
  let companyArticlesScanned = 0;
  let contactArticlesScanned = 0;
  let candidateEventsMatched = 0;
  let eventsSkippedAsDuplicates = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const recomputedContactIds = new Set<string>();
  const failures: Array<{ entity_type: 'company' | 'contact'; entity_id: string; error: string }> = [];

  // ── Phase 1: Company affiliation matching ───────────────────────────────────

  if (ownedCompanyIds.length > 0) {
    const { data: companies, error: companiesError } = await admin
      .from('companies')
      .select('id, company_name, aliases')
      .in('id', ownedCompanyIds);
    if (companiesError) throw new Error(companiesError.message);

    for (const row of (companies ?? []) as CompanyRow[]) {
      const name = row.company_name?.trim();
      if (!name) continue;

      try {
        await sleep(intervalMs);
        const pmids = await pubmedSearch(`"${name}"[Affiliation]`, lookbackDays, maxPerCompany);
        if (pmids.length === 0) {
          companiesProcessed += 1;
          continue;
        }

        const candidateIds = pmids.map((pmid) => `pubmed:${pmid}:${row.id}:publication`);
        const existingIds = await fetchExistingSourceEventIds(admin, input.userId, SOURCE, candidateIds);

        await sleep(intervalMs);
        const articles = await pubmedFetch(pmids);
        companyArticlesScanned += articles.size;

        const aliases = (row.aliases ?? []).filter(Boolean) as string[];
        let emittedAny = false;

        for (const pmid of pmids) {
          const article = articles.get(pmid);
          if (!article) continue;

          // Confirm the company name (or an alias) appears in an affiliation string.
          // PubMed's [Affiliation] index is occasionally broad; this is the real gate.
          const matchedAffiliation = firstMatchingAffiliation(name, aliases, article.affiliations);
          if (!matchedAffiliation) continue;

          const sourceEventId = `pubmed:${pmid}:${row.id}:publication`;
          const title = trimTitle(article.title || `PubMed ${pmid}`);
          const eventAt = isoDate(article.pubdate);
          const sourceUrl = sourceUrlForArticle(pmid, article);
          // Use abstract as summary if available; fall back to journal line.
          const summary = article.abstract
            ? article.abstract.slice(0, 600)
            : article.journal || `PubMed ${pmid}`;
          const baseMetadata: Record<string, unknown> = {
            pmid,
            journal: article.journal,
            affiliations: article.affiliations,
            matched_affiliation: matchedAffiliation,
            ...buildAdmissionMetadata({
              admitted: true,
              reason: 'PubMed affiliation is verified as the tracked company.',
              confidence: 'high',
              entityScope: 'company',
              companyId: row.id,
              matchType: 'verified_pubmed_affiliation',
              metadata: {
                role_gate: 'passed',
                role_gate_reason: 'company name or accepted alias appears in an author affiliation',
                matched_source_field: 'affiliation',
                matched_source_text: matchedAffiliation,
                matched_company_name: name,
              },
            }),
          };
          if (article.doi) baseMetadata.doi = article.doi;

          // ── Company-side publication signal ─────────────────────────────
          candidateEventsMatched += 1;
          if (existingIds.has(sourceEventId)) {
            eventsSkippedAsDuplicates += 1;
          } else {
            const ingest = await ingestSignalSourceEvent(admin, {
              userId: input.userId,
              entityScope: 'company',
              companyId: row.id,
              source: SOURCE,
              sourceEventType: 'pubmed_publication',
              sourceEventId,
              sourceUrl,
              title,
              summary,
              excerpt: summary.slice(0, 300),
              eventAt,
              metadata: baseMetadata,
            });

            await normalizeSignalSourceEvent(admin, {
              userId: input.userId,
              rawEvent: {
                id: ingest.sourceEventId,
                userId: input.userId,
                entityId: row.id,
                entityScope: 'company',
                source: SOURCE,
                sourceUrl,
                sourceEventType: 'pubmed_publication',
                sourceEventId,
                title,
                summary,
                excerpt: summary.slice(0, 300),
                eventAt,
                observedAt: new Date().toISOString(),
                metadata: baseMetadata,
              },
              signalKeys: ['publication'],
              companyId: row.id,
            });

            existingIds.add(sourceEventId);
            emittedAny = true;
            emittedSignalTypes.add('publication');
          }

          // ── Contact cross-match ────────────────────────────────────────
          // Even if the company emission was a duplicate (paper already in
          // DB from a previous run), we still need to cross-match: a contact
          // added AFTER the paper was first ingested would otherwise never
          // get the new_paper_published signal.
          //
          // For each named author on the paper:
          //   1. Build "Last F" token, look up in contactsByAuthorToken
          //   2. For each candidate contact, verify their company name
          //      appears in this paper's affiliations (the matcher with all
          //      its guards — word-boundary, min alias length, distinctive
          //      token). This disambiguates common author names.
          //   3. Emit new_paper_published for that contact (scope: contact).
          if (contactsByAuthorToken.size > 0 && article.authors.length > 0) {
            // Dedupe inside this PMID first — same contact could appear via
            // two different author entries (rare but possible) and we don't
            // want to emit twice.
            const matchedForPmid = new Map<string, ContactCrossMatchEntry>();
            for (const author of article.authors) {
              const token = `${author.lastName} ${author.firstInitial}`;
              const candidates = contactsByAuthorToken.get(token) ?? [];
              for (const cand of candidates) {
                if (matchedForPmid.has(cand.contact.id)) continue;
                if (!companyInAffiliations(cand.companyName, cand.companyAliases, article.affiliations)) continue;
                matchedForPmid.set(cand.contact.id, cand);
              }
            }

            if (matchedForPmid.size > 0) {
              const contactCandidateIds = [...matchedForPmid.values()].map(
                (m) => `pubmed:${pmid}:${m.contact.id}:new_paper_published`,
              );
              const contactExistingIds = await fetchExistingSourceEventIds(
                admin,
                input.userId,
                SOURCE,
                contactCandidateIds,
              );

              for (const m of matchedForPmid.values()) {
                const contactSourceEventId = `pubmed:${pmid}:${m.contact.id}:new_paper_published`;
                candidateEventsMatched += 1;
                if (contactExistingIds.has(contactSourceEventId)) {
                  eventsSkippedAsDuplicates += 1;
                  continue;
                }

                const contactMetadata: Record<string, unknown> = {
                  ...baseMetadata,
                  matched_contact_name: m.contact.full_name,
                  // Provenance: this signal came from the company-phase
                  // cross-match, not from a contact-phase PubMed query.
                  cross_matched_from_company_id: row.id,
                  coauthor_derived: true,
                  author_match_strength: 'author_token_plus_affiliation',
                  ...buildAdmissionMetadata({
                    admitted: true,
                    reason: 'Contact author token matched a paper author and the paper affiliation matches the contact company.',
                    confidence: 'medium',
                    entityScope: 'contact',
                    companyId: m.contact.company_id ?? undefined,
                    contactId: m.contact.id,
                    matchType: 'verified_pubmed_author_affiliation',
                    metadata: {
                      role_gate: 'passed',
                      role_gate_reason: 'author token plus company affiliation cross-check',
                      matched_source_field: 'author_and_affiliation',
                      matched_source_text: `${m.contact.full_name ?? 'contact'} / ${matchedAffiliation}`,
                    },
                  }),
                };
                if (m.contact.company_id) contactMetadata.contact_company_id = m.contact.company_id;

                const contactIngest = await ingestSignalSourceEvent(admin, {
                  userId: input.userId,
                  entityScope: 'contact',
                  contactId: m.contact.id,
                  companyId: m.contact.company_id ?? undefined,
                  source: SOURCE,
                  sourceEventType: 'pubmed_contact_paper',
                  sourceEventId: contactSourceEventId,
                  sourceUrl,
                  title,
                  summary,
                  excerpt: summary.slice(0, 300),
                  eventAt,
                  metadata: contactMetadata,
                });

                await normalizeSignalSourceEvent(admin, {
                  userId: input.userId,
                  rawEvent: {
                    id: contactIngest.sourceEventId,
                    userId: input.userId,
                    entityId: m.contact.id,
                    entityScope: 'contact',
                    source: SOURCE,
                    sourceUrl,
                    sourceEventType: 'pubmed_contact_paper',
                    sourceEventId: contactSourceEventId,
                    title,
                    summary,
                    excerpt: summary.slice(0, 300),
                    eventAt,
                    observedAt: new Date().toISOString(),
                    metadata: contactMetadata,
                  },
                  signalKeys: ['new_paper_published'],
                  contactId: m.contact.id,
                  companyId: m.contact.company_id ?? undefined,
                });

                emittedSignalTypes.add('new_paper_published');
                // Recompute the contact's readiness inline. Cheap, idempotent
                // — if the contact phase later processes the same contact and
                // also recomputes, that's fine (no duplicate work issue).
                await recomputeContactReadiness(admin, {
                  userId: input.userId,
                  contactId: m.contact.id,
                });
                recomputedContactIds.add(m.contact.id);
              }
            }
          }
        }

        if (emittedAny) {
          await recomputeAccountReadiness(admin, { userId: input.userId, companyId: row.id });
          await generateAccountReason(admin, { userId: input.userId, companyId: row.id });
          recomputedCompanyIds.add(row.id);
        }

        companiesProcessed += 1;
      } catch (error) {
        companiesFailed += 1;
        failures.push({ entity_type: 'company', entity_id: row.id, error: messageFromUnknown(error) });
        console.error(`[publications-monitor] Company ${row.id} (${row.company_name}) failed:`, error);
      }
    }
  }

  // ── Phase 2: Contact author matching ───────────────────────────────────────

  if (contactRows.length > 0) {
    // Build company name map for affiliation cross-checks
    const contactCompanyIds = [
      ...new Set(
        contactRows
          .map((c) => c.company_id)
          .filter((v): v is string => typeof v === 'string' && Boolean(v)),
      ),
    ];
    const companyInfoMap = new Map<string, { name: string; aliases: string[] }>();
    if (contactCompanyIds.length > 0) {
      const { data: companyRows } = await admin
        .from('companies')
        .select('id, company_name, aliases')
        .in('id', contactCompanyIds);
      for (const r of (companyRows ?? []) as { id: string; company_name: string | null; aliases: string[] | null }[]) {
        if (r.company_name) {
          companyInfoMap.set(r.id, {
            name: r.company_name,
            aliases: (r.aliases ?? []).filter(Boolean) as string[],
          });
        }
      }
    }

    for (const row of contactRows) {
      const fullName = row.full_name?.trim();
      if (!fullName) continue;

      const authorToken = authorQueryToken(fullName);
      if (!authorToken) {
        contactsProcessed += 1;
        continue;
      }

      const companyInfo = row.company_id ? companyInfoMap.get(row.company_id) : undefined;
      const companyName = companyInfo?.name;
      if (!companyName) {
        contactsProcessed += 1;
        continue;
      }
      const query = companyName
        ? `"${authorToken}"[Author] AND "${companyName}"[Affiliation]`
        : `"${authorToken}"[Author]`;

      try {
        await sleep(intervalMs);
        const pmids = await pubmedSearch(query, lookbackDays, maxPerContact);
        if (pmids.length === 0) {
          contactsProcessed += 1;
          continue;
        }

        const candidateIds = pmids.map((pmid) => `pubmed:${pmid}:${row.id}:new_paper_published`);
        const existingIds = await fetchExistingSourceEventIds(admin, input.userId, SOURCE, candidateIds);

        await sleep(intervalMs);
        const articles = await pubmedFetch(pmids);
        contactArticlesScanned += articles.size;

        let emittedAny = false;

        for (const pmid of pmids) {
          const article = articles.get(pmid);
          if (!article) continue;
          if (!articleHasAuthorToken(article, authorToken)) continue;

          // If we have a company name, confirm it appears in an affiliation —
          // catches cases where two people share the same "Last F" author token.
          const matchedAffiliation = companyName
            ? firstMatchingAffiliation(companyName, companyInfo?.aliases ?? [], article.affiliations)
            : null;
          if (companyName && !matchedAffiliation) continue;

          const sourceEventId = `pubmed:${pmid}:${row.id}:new_paper_published`;
          candidateEventsMatched += 1;

          if (existingIds.has(sourceEventId)) {
            eventsSkippedAsDuplicates += 1;
            continue;
          }

          const title = trimTitle(article.title || `PubMed ${pmid}`);
          const eventAt = isoDate(article.pubdate);
          const sourceUrl = sourceUrlForArticle(pmid, article);
          const summary = article.abstract
            ? article.abstract.slice(0, 600)
            : article.journal || `PubMed ${pmid}`;

          const metadata: Record<string, unknown> = {
            pmid,
            journal: article.journal,
            affiliations: article.affiliations,
            matched_contact_name: fullName,
            matched_author_token: authorToken,
            matched_affiliation: matchedAffiliation,
            author_match_strength: 'author_token_plus_affiliation',
            ...buildAdmissionMetadata({
              admitted: true,
              reason: 'Contact author token matched a paper author and the paper affiliation matches the contact company.',
              confidence: 'medium',
              entityScope: 'contact',
              companyId: row.company_id ?? undefined,
              contactId: row.id,
              matchType: 'verified_pubmed_author_affiliation',
              metadata: {
                role_gate: 'passed',
                role_gate_reason: 'author token plus company affiliation cross-check',
                matched_source_field: 'author_and_affiliation',
                matched_source_text: `${authorToken} / ${matchedAffiliation ?? ''}`,
              },
            }),
          };
          if (row.company_id) metadata.contact_company_id = row.company_id;
          if (article.doi) metadata.doi = article.doi;

          const ingest = await ingestSignalSourceEvent(admin, {
            userId: input.userId,
            entityScope: 'contact',
            contactId: row.id,
            companyId: row.company_id ?? undefined,
            source: SOURCE,
            sourceEventType: 'pubmed_contact_paper',
            sourceEventId,
            sourceUrl,
            title,
            summary,
            excerpt: summary.slice(0, 300),
            eventAt,
            metadata,
          });

          await normalizeSignalSourceEvent(admin, {
            userId: input.userId,
            rawEvent: {
              id: ingest.sourceEventId,
              userId: input.userId,
              entityId: row.id,
              entityScope: 'contact',
              source: SOURCE,
              sourceUrl,
              sourceEventType: 'pubmed_contact_paper',
              sourceEventId,
              title,
              summary,
              excerpt: summary.slice(0, 300),
              eventAt,
              observedAt: new Date().toISOString(),
              metadata,
            },
            signalKeys: ['new_paper_published'],
            contactId: row.id,
            companyId: row.company_id ?? undefined,
          });

          existingIds.add(sourceEventId);
          emittedAny = true;
          emittedSignalTypes.add('new_paper_published');
        }

        if (emittedAny) {
          await recomputeContactReadiness(admin, { userId: input.userId, contactId: row.id });
          recomputedContactIds.add(row.id);
        }

        contactsProcessed += 1;
      } catch (error) {
        contactsFailed += 1;
        failures.push({ entity_type: 'contact', entity_id: row.id, error: messageFromUnknown(error) });
        console.error(`[publications-monitor] Contact ${row.id} (${fullName}) failed:`, error);
      }
    }
  }

  return {
    companies_processed: companiesProcessed,
    companies_failed: companiesFailed,
    contacts_processed: contactsProcessed,
    contacts_failed: contactsFailed,
    company_articles_scanned: companyArticlesScanned,
    contact_articles_scanned: contactArticlesScanned,
    candidate_events_matched_before_dedupe: candidateEventsMatched,
    events_skipped_as_duplicates: eventsSkippedAsDuplicates,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    recomputed_contacts: [...recomputedContactIds],
    failures,
  };
}
