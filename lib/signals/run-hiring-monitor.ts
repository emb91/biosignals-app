/**
 * Hiring signal monitor — V2.
 *
 * Queries job postings directly from LinkedIn via the
 * curious_coder/linkedin-jobs-scraper Apify actor (78K users, 98% success,
 * $0.001/job). One batch call per run covers all tracked companies —
 * no per-company scraping, no local DB mirror.
 *
 * Signal keys emitted:
 *   cmc_hiring          — CMC, process development, manufacturing science
 *   clinical_ops_hiring — clinical operations, CRA, trial management
 *   regulatory_hiring   — regulatory affairs, RA, regulatory submissions
 *   bd_hiring           — business development, licensing, alliance management
 *   commercial_hiring   — commercial, sales, medical affairs, market access
 *   job_surge           — ≥ JOB_SURGE_THRESHOLD matching postings for a company
 *
 * Dedup: one signal event per (company, signal_key, ISO-week). Prevents
 * re-emitting for roles that stay open across multiple weekly runs.
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';
import { READINESS_SIGNAL_CATALOG_BY_KEY } from '@/lib/signals/readiness-catalog';
import {
  generateAccountReason,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import { insertSignalSourceEvent } from '@/lib/signals/readiness-store';
import type { BuyerFunction, SignalKey } from '@/lib/signals/readiness-types';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * curious_coder/linkedin-jobs-scraper: 78K users, 81 reviews, 4.73★, 98% success.
 * Accepts an array of LinkedIn jobs search URLs — we pass one per company so
 * the whole list is scraped in a single actor run.
 */
const APIFY_ACTOR = 'curious_coder~linkedin-jobs-scraper';
/** Timeout for the batch call. One run covers all companies. */
const ACTOR_TIMEOUT_MS = 120_000;
/** Max results fetched per company search URL. */
const RESULTS_PER_COMPANY = 25;

/** Emit job_surge if a company returns at least this many matching postings. */
const JOB_SURGE_THRESHOLD = 10;

const SOURCE = 'linkedin_jobs';

// ── Keyword classification ────────────────────────────────────────────────
// All terms lowercased; matched against padded title_normalized so boundaries
// work correctly (e.g. ' cra ' won't match 'aircraft').
// First match wins for the primary category; a posting also contributes to
// job_surge regardless of category.

const CMC_TERMS = [
  'cmc',
  'process development',
  'drug substance',
  'drug product',
  'formulation development',
  'formulation scientist',
  'analytical development',
  'manufacturing science',
  'manufacturing & supply',
  'manufacturing and supply',
  'tech transfer',
  'technology transfer',
  'scale-up',
  'scale up',
  'bioprocess',
  'upstream process',
  'downstream process',
  'fill finish',
  'fill-finish',
  'biologics manufacturing',
  'small molecule manufacturing',
  'mab manufacturing',
  'cell therapy manufacturing',
  'gene therapy manufacturing',
  'pharmaceutical manufacturing',
  'process engineer',
  'process scientist',
];

const CLINICAL_OPS_TERMS = [
  'clinical operations',
  'clinical operation',
  'clinical trial manager',
  'clinical study manager',
  'clinical project manager',
  'clinical research associate',
  ' cra ',
  'cra ii',
  'cra iii',
  'site management',
  'patient recruitment',
  'clinical data manager',
  'data management',
  'pharmacovigilance',
  'drug safety',
  'medical monitor',
  'ctms',
  'clinical supplies',
  'clinical logistics',
  'clinical outsourcing',
  'vendor management',
];

const REGULATORY_TERMS = [
  'regulatory affairs',
  'regulatory strategy',
  'regulatory submission',
  'regulatory compliance',
  'regulatory scientist',
  'regulatory reviewer',
  'regulatory operations',
  'regulatory writing',
  'regulatory lead',
  'regulatory director',
  'regulatory manager',
  'regulatory associate',
  'submissions manager',
  'submissions director',
  'drug regulatory',
  'device regulatory',
  'anda',
  'nda regulatory',
  'bla regulatory',
  'ind regulatory',
  'maa regulatory',
  'regulatory intelligence',
];

const BD_TERMS = [
  'business development',
  'bd director',
  'bd manager',
  'bd lead',
  'partnerships director',
  'alliance management',
  'alliance manager',
  'licensing director',
  'licensing manager',
  'corporate development',
  'in-licensing',
  'out-licensing',
  'deal sourcing',
  'strategic partnerships',
];

const COMMERCIAL_TERMS = [
  'commercial director',
  'commercial manager',
  'commercial lead',
  'commercial strategy',
  'medical affairs',
  'market access',
  'key account manager',
  'key account director',
  'sales director',
  'sales manager',
  'marketing director',
  'marketing manager',
  'launch excellence',
  'brand manager',
  'field medical',
  'medical science liaison',
  'msl ',
];

type HiringCategory =
  | 'cmc_hiring'
  | 'clinical_ops_hiring'
  | 'regulatory_hiring'
  | 'bd_hiring'
  | 'commercial_hiring';

function classifyTitle(titleNorm: string): HiringCategory | null {
  // Pad so word-boundary terms like ' cra ' work at string edges.
  const t = ` ${titleNorm} `;
  for (const term of CMC_TERMS) if (t.includes(term)) return 'cmc_hiring';
  for (const term of CLINICAL_OPS_TERMS) if (t.includes(term)) return 'clinical_ops_hiring';
  for (const term of REGULATORY_TERMS) if (t.includes(term)) return 'regulatory_hiring';
  for (const term of BD_TERMS) if (t.includes(term)) return 'bd_hiring';
  for (const term of COMMERCIAL_TERMS) if (t.includes(term)) return 'commercial_hiring';
  return null;
}

// ── ATS scraping ──────────────────────────────────────────────────────────

type RawAtsJob = Record<string, unknown>;

type ScrapedJob = {
  title: string;
  title_normalized: string;
  job_url: string | null;
  company_name_raw: string;
};

function extractString(obj: RawAtsJob, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseRawJob(raw: RawAtsJob): ScrapedJob | null {
  const title = extractString(raw, 'title', 'jobTitle', 'job_title', 'name');
  if (!title) return null;

  const companyRaw = extractString(
    raw,
    'company', 'organization', 'companyName', 'company_name',
    'employer', 'employerName', 'employer_name',
  );

  const jobUrl = extractString(raw, 'url', 'jobUrl', 'job_url', 'link', 'applyUrl', 'apply_url') || null;

  return {
    title,
    title_normalized: title.toLowerCase(),
    job_url: jobUrl,
    company_name_raw: companyRaw,
  };
}

async function fetchJobsFromLinkedIn(
  companyNames: string[],
): Promise<{ jobs: ScrapedJob[]; rawCount: number; error: string | null }> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) return { jobs: [], rawCount: 0, error: 'APIFY_API_KEY is not set' };
  if (companyNames.length === 0) return { jobs: [], rawCount: 0, error: null };

  // One search URL per company — no quotes around the name (quoted keywords
  // return 0 results on LinkedIn's public job search endpoint).
  const urls = companyNames.map(
    (name) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(name)}&position=1&pageNum=0`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTOR_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls,
          count: RESULTS_PER_COMPANY,
          scrapeCompany: false, // skip extra per-job company requests — we already have company data
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { jobs: [], rawCount: 0, error: `LinkedIn jobs scrape failed (${response.status}): ${text.slice(0, 300)}` };
    }

    const payload = (await response.json()) as unknown;
    const rawItems = Array.isArray(payload) ? (payload as RawAtsJob[]) : [];
    const jobs = rawItems.map(parseRawJob).filter((j): j is ScrapedJob => j !== null);
    return { jobs, rawCount: rawItems.length, error: null };
  } catch (err) {
    return { jobs: [], rawCount: 0, error: messageFromUnknown(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

type HiringMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
};

export type CategoryMatch = {
  key: HiringCategory;
  count: number;
  titles: string[];
  /** Buyer functions activated by this category (from catalog) */
  buyer_functions: BuyerFunction[];
};

export type CompanyHiringDetail = {
  company_id: string;
  company_name: string;
  /** Total postings returned by the scraper for this company */
  postings_scraped: number;
  /** Postings that matched at least one keyword category */
  postings_matched: number;
  /** Per-category breakdown with all matched titles and buyer function mappings */
  categories: CategoryMatch[];
  /** True if postings_scraped >= JOB_SURGE_THRESHOLD */
  job_surge: boolean;
  /** Deduplicated union of all buyer functions activated across detected categories */
  buyer_functions_activated: BuyerFunction[];
};

export type HiringMonitorResult = {
  processed: number;
  failed: number;
  postings_scanned: number;
  candidate_events_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
  /** Per-company classification detail — only companies with ≥1 matched posting */
  details: CompanyHiringDetail[];
};

type CompanyRow = {
  id: string;
  company_name: string | null;
  aliases: string[] | null;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
  }
  return String(error);
}

// ── Signal emission helpers ────────────────────────────────────────────────

async function fetchExistingSourceEventIds(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sourceEventIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(sourceEventIds.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const found = new Set<string>();
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const { data, error } = await admin
      .from('signal_source_events')
      .select('source_event_id')
      .eq('user_id', userId)
      .eq('source', SOURCE)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

async function emitHiringSignal(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    companyId: string;
    companyName: string;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    sourceUrl: string | null;
    summary: string;
    eventAt: string;
    metadata: Record<string, unknown>;
    existingIds: Set<string>;
    /** Override buyer functions for normalization (e.g. derived from role mix for job_surge) */
    buyerFunctionsOverride?: BuyerFunction[];
  },
): Promise<'emitted' | 'duplicate'> {
  if (input.existingIds.has(input.sourceEventId)) return 'duplicate';

  const title = `${input.signalKey} detected at ${input.companyName}`;

  // insertSignalSourceEvent stores sourceEventId (composite text key) in the
  // source_event_id TEXT column and returns the full RawSignalEvent where
  // rawEvent.id is the auto-generated UUID primary key of the inserted row.
  // We pass rawEvent directly to normalizeSignalSourceEvent so that
  // rawEvent.id (UUID PK) is unambiguously used as the FK in normalized_signals.
  const rawEvent = await insertSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    sourceUrl: input.sourceUrl ?? `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(input.companyName)}`,
    title,
    summary: input.summary,
    excerpt: input.summary,
    eventAt: input.eventAt,
    metadata: input.metadata,
  });

  await normalizeSignalSourceEvent(admin, {
    userId: input.userId,
    rawEvent, // rawEvent.id is the UUID PK — no manual reconstruction needed
    signalKeys: [input.signalKey],
    companyId: input.companyId,
    buyerFunctionsOverride: input.buyerFunctionsOverride,
  });

  input.existingIds.add(input.sourceEventId);
  return 'emitted';
}

// ── Main monitor ──────────────────────────────────────────────────────────

export async function runHiringMonitor(input: HiringMonitorInput): Promise<HiringMonitorResult> {
  const admin = createAdminClient();

  // 1. Resolve which companies to process
  const { data: linkRows, error: linkError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null);
  if (linkError) throw new Error(`user_companies query: ${linkError.message}`);

  let ownedIds = (linkRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string' && Boolean(v));

  const requestedIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  if (requestedIds.length > 0) {
    const set = new Set(requestedIds);
    ownedIds = ownedIds.filter((id) => set.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 200, 1), 500));
  }

  if (ownedIds.length === 0) {
    return {
      processed: 0, failed: 0, postings_scanned: 0,
      candidate_events_before_dedupe: 0, events_skipped_as_duplicates: 0,
      emitted_signal_types: [], recomputed_companies: [], failures: [], details: [],
    };
  }

  const { data: companiesRaw, error: companiesErr } = await admin
    .from('companies')
    .select('id, company_name, aliases')
    .in('id', ownedIds);
  if (companiesErr) throw new Error(companiesErr.message);

  const companies = (companiesRaw ?? []) as CompanyRow[];

  // 2. Ensure aliases exist (lazy-populate)
  for (const c of companies) {
    if (!c.aliases?.length && c.company_name) {
      try { await ensureCompanyAliases(admin, c.id); } catch { /* non-fatal */ }
    }
  }

  // 3. Build name → company-id lookup (primary name + all aliases, lowercased)
  const nameToId = new Map<string, string>();
  for (const c of companies) {
    if (c.company_name) nameToId.set(c.company_name.toLowerCase().trim(), c.id);
    for (const alias of c.aliases ?? []) {
      if (alias) nameToId.set(alias.toLowerCase().trim(), c.id);
    }
  }
  const idToCompany = new Map<string, CompanyRow>(companies.map((c) => [c.id, c]));

  // 4. One batch ATS call for all companies + all role keyword groups
  const companyNames = companies
    .map((c) => c.company_name?.trim())
    .filter((n): n is string => Boolean(n));

  const { jobs, rawCount, error: atsError } = await fetchJobsFromLinkedIn(companyNames);

  if (atsError) {
    // Whole call failed — record a failure per company and return
    return {
      processed: 0,
      failed: companies.length,
      postings_scanned: 0,
      candidate_events_before_dedupe: 0,
      events_skipped_as_duplicates: 0,
      emitted_signal_types: [],
      recomputed_companies: [],
      failures: companies.map((c) => ({ company_id: c.id, error: `ATS fetch: ${atsError}` })),
      details: [],
    };
  }

  // 5. Group jobs by company ID (match returned company name → our ID)
  const jobsByCompanyId = new Map<string, ScrapedJob[]>();
  for (const job of jobs) {
    const rawNameLower = job.company_name_raw.toLowerCase().trim();
    // Exact match first
    let companyId = nameToId.get(rawNameLower);
    // Fallback: check if any of our names is a substring of the returned name (handles "Moderna, Inc.")
    if (!companyId) {
      for (const [storedName, id] of nameToId) {
        if (rawNameLower.includes(storedName) || storedName.includes(rawNameLower)) {
          companyId = id;
          break;
        }
      }
    }
    if (!companyId) continue; // not one of our tracked companies

    const list = jobsByCompanyId.get(companyId) ?? [];
    list.push(job);
    jobsByCompanyId.set(companyId, list);
  }

  // 6. Per-company: classify → emit signals
  const now = new Date().toISOString();
  const year = new Date().getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(
    ((Date.now() - jan1.getTime()) / 86_400_000 + jan1.getUTCDay() + 1) / 7,
  );
  const currentWeekKey = `${year}-W${String(weekNum).padStart(2, '0')}`;

  const onlySignal = input.onlySignalKey;
  const shouldEmit = (k: SignalKey) => !onlySignal || onlySignal === k;

  let processed = 0, failed = 0;
  let candidatesBefore = 0, skippedDupes = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];
  const details: CompanyHiringDetail[] = [];

  for (const companyId of ownedIds) {
    const company = idToCompany.get(companyId);
    if (!company?.company_name) continue;

    const name = company.company_name.trim();
    const postings = jobsByCompanyId.get(companyId) ?? [];

    try {
      // Categorise each posting — collect ALL titles (not just examples)
      const byCategory = new Map<HiringCategory, ScrapedJob[]>();
      for (const p of postings) {
        const cat = classifyTitle(p.title_normalized);
        if (!cat) continue;
        const list = byCategory.get(cat) ?? [];
        list.push(p);
        byCategory.set(cat, list);
      }

      // Build detail entry for any company with matched postings.
      // Also derive the union of buyer functions from the actual category mix —
      // used both for the drilldown display and as the buyerFunctionsOverride for
      // job_surge (per catalog note: "computed from classified role mix").
      const categoryMatches: CategoryMatch[] = [...byCategory.entries()].map(([key, list]) => ({
        key,
        count: list.length,
        titles: list.map((p) => p.title),
        buyer_functions: [...(READINESS_SIGNAL_CATALOG_BY_KEY[key]?.buyerFunctions ?? [])],
      }));

      const buyerFunctionsFromMix: BuyerFunction[] = [
        ...new Set(categoryMatches.flatMap((c) => c.buyer_functions)),
      ];

      if (postings.length > 0 && byCategory.size > 0) {
        const matchedCount = [...byCategory.values()].reduce((s, l) => s + l.length, 0);
        details.push({
          company_id: companyId,
          company_name: name,
          postings_scraped: postings.length,
          postings_matched: matchedCount,
          categories: categoryMatches,
          job_surge: postings.length >= JOB_SURGE_THRESHOLD,
          buyer_functions_activated: buyerFunctionsFromMix,
        });
      }

      // Build dedup candidate IDs for this week
      const candidateIds: string[] = [];
      for (const [cat] of byCategory) {
        if (shouldEmit(cat)) {
          candidateIds.push(`${SOURCE}:${companyId}:${cat}:${currentWeekKey}`);
        }
      }
      if (shouldEmit('job_surge') && postings.length >= JOB_SURGE_THRESHOLD) {
        candidateIds.push(`${SOURCE}:${companyId}:job_surge:${currentWeekKey}`);
      }
      candidatesBefore += candidateIds.length;

      if (candidateIds.length === 0) {
        processed += 1;
        continue;
      }

      const existingIds = await fetchExistingSourceEventIds(admin, input.userId, candidateIds);
      let emittedAny = false;

      // Emit per-category signals
      for (const [cat, list] of byCategory) {
        if (!shouldEmit(cat)) continue;
        const sourceEventId = `${SOURCE}:${companyId}:${cat}:${currentWeekKey}`;
        const exampleTitles = list.slice(0, 3).map((p) => p.title).join('; ');
        const summary = `${list.length} open ${cat.replace(/_/g, ' ')} role${list.length > 1 ? 's' : ''} detected at ${name} via LinkedIn (e.g. ${exampleTitles}).`;

        const result = await emitHiringSignal(admin, {
          userId: input.userId,
          companyId,
          companyName: name,
          signalKey: cat,
          sourceEventType: `ats_jobs_${cat}`,
          sourceEventId,
          sourceUrl: list[0].job_url,
          summary,
          eventAt: now,
          metadata: {
            category: cat,
            count: list.length,
            week: currentWeekKey,
            titles: list.map((p) => p.title),
            example_urls: list.slice(0, 3).map((p) => p.job_url).filter(Boolean),
          },
          existingIds,
        });

        if (result === 'emitted') { emittedAny = true; emittedSignalTypes.add(cat); }
        else skippedDupes += 1;
      }

      // Emit job_surge — buyer functions derived from actual category mix,
      // not the static catalog list (per catalog note on job_surge).
      if (shouldEmit('job_surge') && postings.length >= JOB_SURGE_THRESHOLD) {
        const sourceEventId = `${SOURCE}:${companyId}:job_surge:${currentWeekKey}`;
        const matchedTitles = [...byCategory.values()].flat().map((p) => p.title);
        const categoryLabels = categoryMatches.map((c) => `${c.key.replace(/_/g, ' ')} (${c.count})`).join(', ');
        const summary = `${postings.length} open roles at ${name} — significant hiring activity. Matched categories: ${categoryLabels || 'none'}.`;

        const result = await emitHiringSignal(admin, {
          userId: input.userId,
          companyId,
          companyName: name,
          signalKey: 'job_surge',
          sourceEventType: 'ats_jobs_surge',
          sourceEventId,
          sourceUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(name)}`,
          summary,
          eventAt: now,
          metadata: {
            total_postings: postings.length,
            matched_postings: matchedTitles.length,
            matched_titles: matchedTitles,
            buyer_functions_activated: buyerFunctionsFromMix,
            categories: Object.fromEntries(categoryMatches.map((c) => [c.key, c.count])),
            week: currentWeekKey,
            threshold: JOB_SURGE_THRESHOLD,
          },
          // Override buyer functions to reflect the actual role mix rather than
          // the broad static list in the catalog.
          buyerFunctionsOverride: buyerFunctionsFromMix.length > 0 ? buyerFunctionsFromMix : undefined,
          existingIds,
        });

        if (result === 'emitted') { emittedAny = true; emittedSignalTypes.add('job_surge'); }
        else skippedDupes += 1;
      }

      if (emittedAny) {
        await recomputeAccountReadiness(admin, { userId: input.userId, companyId });
        await generateAccountReason(admin, { userId: input.userId, companyId });
        recomputedIds.add(companyId);
      }

      processed += 1;
    } catch (error) {
      failed += 1;
      failures.push({ company_id: companyId, error: messageFromUnknown(error) });
    }
  }

  return {
    processed,
    failed,
    postings_scanned: jobs.length,
    candidate_events_before_dedupe: candidatesBefore,
    events_skipped_as_duplicates: skippedDupes,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedIds],
    failures,
    details,
  };
}
