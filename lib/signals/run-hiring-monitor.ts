/**
 * Hiring signal monitor — V2.
 *
 * Classifies job postings from the shared job_postings_local mirror. The
 * jobs-delta cron refreshes that mirror once per due company/source target;
 * customer/org cadence gates decide when each subscriber receives the signal.
 *
 * Signal keys emitted:
 *   cmc_hiring              — CMC, process development, manufacturing science
 *   clinical_ops_hiring     — clinical operations, CRA, trial management
 *   regulatory_hiring       — regulatory affairs, submissions
 *   research_hiring         — R&D, discovery, preclinical science
 *   quality_hiring          — QA, QC, GMP, validation
 *   medical_hiring          — CMO, medical director, medical affairs
 *   bd_hiring               — business development, licensing, alliances
 *   commercial_hiring       — commercial, sales, market access
 *   data_informatics_hiring — bioinformatics, biostatistics, data engineering
 *   executive_hiring        — VP, SVP, C-suite
 *   hiring_expansion        — ≥ JOB_SURGE_THRESHOLD total postings (broad growth signal)
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
import { verifySourceCompanyNameAgainstCandidates } from '@/lib/signals/signal-entity-guards';
import { buildAdmissionMetadata } from '@/lib/signals/signal-admission';
import { isCompanySweepEligible } from '@/lib/signals/sweep-fit-gate';
import { runApifyActor } from '@/lib/apify';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * curious_coder/linkedin-jobs-scraper: 78K users, 81 reviews, 4.73★, 98% success.
 * Accepts an array of LinkedIn jobs search URLs — we pass one per company so
 * the whole list is scraped in a single actor run.
 */
/** Timeout for the batch call. One run covers all companies. */
const ACTOR_TIMEOUT_MS = 120_000;
/**
 * Target results per company. The actor returns min(count, actually-available),
 * so a higher value only matters for companies that genuinely have more roles —
 * it doesn't over-scrape small ones. 100 matches the all_roles display cap and
 * keeps single-company runs from being starved.
 */
const RESULTS_PER_COMPANY = 100;
/**
 * Hard ceiling on the actor's GLOBAL `count` for a single call. The actor's
 * `count` is a TOTAL cap across ALL search URLs (verified against its input
 * schema: "Number of jobs needed — Limit number of jobs scraped"), so passing a
 * flat 25 with N company URLs starved every company to ~25/N postings. We now
 * request RESULTS_PER_COMPANY × companyCount, bounded by this ceiling so a
 * large batch can't request an unbounded scrape.
 */
const COMPANY_CHUNK_SIZE = 20;

/** Emit hiring_expansion if a company returns at least this many matching postings. */
const JOB_SURGE_THRESHOLD = 5;

const SOURCE = 'linkedin_jobs';

// ── Keyword classification ────────────────────────────────────────────────
// All terms lowercased; matched against padded title_normalized so boundaries
// work correctly (e.g. ' cra ' won't match 'aircraft').
// First match wins for the primary category; a posting also contributes to
// hiring_expansion regardless of category.

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
  'market access',
  'key account manager',
  'key account director',
  'sales director',
  'sales manager',
  'marketing director',
  'marketing manager',
  'launch excellence',
  'brand manager',
  'msl ',
];

const RESEARCH_TERMS = [
  'research scientist',
  'senior scientist',
  'principal scientist',
  'discovery scientist',
  'drug discovery',
  'medicinal chemistry',
  'medicinal chemist',
  'target identification',
  'target id',
  'lead optimization',
  'lead generation',
  'hit identification',
  'hit-to-lead',
  'molecular biology',
  'cell biology',
  'structural biology',
  'biochemist',
  'biochemistry',
  'pharmacologist',
  'pharmacology',
  'in vitro',
  'in vivo',
  'preclinical',
  'toxicologist',
  'toxicology',
  'dmpk',
  'pharmacokinetics',
  ' pk ',
  'pk/pd',
  'translational',
  'research associate',
  'research director',
  'head of research',
  'vp research',
  'chief scientific officer',
  ' cso ',
];

const QUALITY_TERMS = [
  'quality assurance',
  'quality control',
  'quality director',
  'quality manager',
  'quality associate',
  'quality engineer',
  'quality systems',
  'quality operations',
  ' qa ',
  ' qc ',
  'gmp',
  'gxp',
  'good manufacturing',
  'good laboratory',
  'validation engineer',
  'validation scientist',
  'qualified person',
  ' qp ',
  'batch release',
  'deviation management',
  'capa',
  'audit manager',
  'compliance specialist',
  'compliance manager',
  'quality compliance',
];

const MEDICAL_TERMS = [
  'chief medical officer',
  ' cmo ',
  'medical director',
  'vp medical',
  'svp medical',
  'head of medical',
  'medical affairs',
  'medical science liaison',
  'field medical',
  'medical monitor',
  'medical lead',
  'clinical development',
  'vp clinical development',
  'head of clinical development',
  'clinical physician',
  'physician scientist',
  'medical advisor',
  'medical manager',
];

const DATA_INFORMATICS_TERMS = [
  'bioinformatics',
  'bioinformatician',
  'computational biologist',
  'computational biology',
  'biostatistician',
  'biostatistics',
  'statistical programmer',
  'statistical programming',
  'data scientist',
  'data science',
  'data engineer',
  'data engineering',
  'data analyst',
  'machine learning',
  'ai scientist',
  'informatics',
  'clinical informatics',
  'clinical data scientist',
  'omics',
  'genomics analyst',
  'genomics scientist',
  'sequencing',
  'ngs analyst',
];

const EXECUTIVE_TERMS = [
  // C-suite — unambiguous regardless of company type
  'chief executive officer',
  ' ceo ',
  'chief operating officer',
  ' coo ',
  'chief scientific officer',
  ' cso ',
  'chief medical officer',
  ' cmo ',
  'chief development officer',
  ' cdo ',
  'chief commercial officer',
  ' cco ',
  'chief business officer',
  ' cbo ',
  'chief financial officer',
  ' cfo ',
  // Named VP titles — specific enough to avoid noise
  'vp clinical',
  'vp regulatory',
  'vp manufacturing',
  'vp cmc',
  'vp research',
  'vp medical',
  'vp business development',
  'vp commercial',
  'vp operations',
  'vp development',
  'vp scientific',
  'vice president clinical',
  'vice president regulatory',
  'vice president manufacturing',
  'vice president research',
  'vice president medical',
  'vice president business development',
  'vice president commercial',
  // SVP equivalents
  'svp clinical',
  'svp regulatory',
  'svp manufacturing',
  'svp research',
  'svp medical',
  'svp commercial',
  'svp development',
  // Named president/GM titles specific to biopharma
  'president and ceo',
  'president & ceo',
  'general manager, ',
  // Executive director (common in biopharma for senior ICs and functional leads)
  'executive director, clinical',
  'executive director, regulatory',
  'executive director, manufacturing',
  'executive director, cmc',
  'executive director, research',
  'executive director, medical',
  'executive director, commercial',
  'executive director, business',
];

type HiringCategory =
  | 'cmc_hiring'
  | 'clinical_ops_hiring'
  | 'regulatory_hiring'
  | 'research_hiring'
  | 'quality_hiring'
  | 'medical_hiring'
  | 'bd_hiring'
  | 'commercial_hiring'
  | 'data_informatics_hiring'
  | 'executive_hiring';

// Human-readable label used in signal summaries shown to sales reps.
const CATEGORY_LABELS: Record<HiringCategory, string> = {
  cmc_hiring: 'CMC / process development',
  clinical_ops_hiring: 'clinical operations',
  regulatory_hiring: 'regulatory affairs',
  research_hiring: 'R&D / discovery',
  quality_hiring: 'quality / GMP',
  medical_hiring: 'medical affairs',
  bd_hiring: 'business development',
  commercial_hiring: 'commercial / market access',
  data_informatics_hiring: 'data & informatics',
  executive_hiring: 'executive / VP',
};

// One-line reasoning for why this hire matters commercially — shown in signal summary.
const CATEGORY_REASONS: Record<HiringCategory, string> = {
  cmc_hiring: 'likely scaling a drug into manufacturing',
  clinical_ops_hiring: 'likely starting or expanding a clinical trial',
  regulatory_hiring: 'likely approaching a submission or new market entry',
  research_hiring: 'likely starting a new program or indication',
  quality_hiring: 'likely ramping manufacturing or preparing for an audit',
  medical_hiring: 'likely entering a new clinical phase or building pre-launch medical affairs',
  bd_hiring: 'likely actively partnering or out-licensing',
  commercial_hiring: 'likely in pre-launch or launch execution',
  data_informatics_hiring: 'likely building data infrastructure or scaling trial operations',
  executive_hiring: 'new leadership typically triggers active vendor re-evaluation',
};

function classifyTitle(titleNorm: string): HiringCategory | null {
  // Pad so word-boundary terms like ' cra ' work at string edges.
  // Order matters: more specific / higher-signal categories first.
  const t = ` ${titleNorm} `;
  if (EXECUTIVE_TERMS.some((term) => t.includes(term))) return 'executive_hiring';
  if (CMC_TERMS.some((term) => t.includes(term))) return 'cmc_hiring';
  if (CLINICAL_OPS_TERMS.some((term) => t.includes(term))) return 'clinical_ops_hiring';
  if (REGULATORY_TERMS.some((term) => t.includes(term))) return 'regulatory_hiring';
  if (QUALITY_TERMS.some((term) => t.includes(term))) return 'quality_hiring';
  if (MEDICAL_TERMS.some((term) => t.includes(term))) return 'medical_hiring';
  if (RESEARCH_TERMS.some((term) => t.includes(term))) return 'research_hiring';
  if (BD_TERMS.some((term) => t.includes(term))) return 'bd_hiring';
  if (COMMERCIAL_TERMS.some((term) => t.includes(term))) return 'commercial_hiring';
  if (DATA_INFORMATICS_TERMS.some((term) => t.includes(term))) return 'data_informatics_hiring';
  return null;
}

// ── ATS scraping ──────────────────────────────────────────────────────────

type RawAtsJob = Record<string, unknown>;

type ScrapedJob = {
  title: string;
  title_normalized: string;
  job_url: string | null;
  company_name_raw: string;
  company_match_metadata?: Record<string, unknown>;
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

function linkedinJobIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const currentJobId = /[?&]currentJobId=(\d+)/i.exec(url)?.[1];
  if (currentJobId) return currentJobId;
  const viewId = /\/jobs\/view\/(\d+)/i.exec(url)?.[1];
  if (viewId) return viewId;
  const anyLongId = /\b(\d{8,})\b/.exec(url)?.[1];
  return anyLongId ?? null;
}

function fallbackLinkedInJobId(job: ScrapedJob): string {
  const normalized = [
    job.title.toLowerCase(),
    job.company_name_raw.toLowerCase(),
    job.job_url ?? '',
  ].join('|');
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `arcova-${hash.toString(16)}`;
}

async function fetchJobsFromLinkedIn(
  companyNames: string[],
  context: { orgId: string | null; userId: string | null },
): Promise<{ jobs: ScrapedJob[]; rawCount: number; error: string | null }> {
  if (companyNames.length === 0) return { jobs: [], rawCount: 0, error: null };
  const rawItems: RawAtsJob[] = [];
  try {
    for (let index = 0; index < companyNames.length; index += COMPANY_CHUNK_SIZE) {
      const chunk = companyNames.slice(index, index + COMPANY_CHUNK_SIZE);
      const urls = chunk.map(
        (name) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(name)}&position=1&pageNum=0`,
      );
      const items = await runApifyActor<RawAtsJob>({
        actor: 'jobs',
        input: {
          urls,
          count: RESULTS_PER_COMPANY * urls.length,
          scrapeCompany: false, // skip extra per-job company requests — we already have company data
        },
        orgId: context.orgId,
        userId: context.userId,
        actionType: 'company_hiring_monitoring',
        inputCount: urls.length,
        attemptedCount: urls.length,
        includedMonitoring: true,
        timeoutMs: ACTOR_TIMEOUT_MS,
        metadata: { companyNames: chunk },
      });
      rawItems.push(...items);
    }
    const jobs = rawItems.map(parseRawJob).filter((j): j is ScrapedJob => j !== null);
    return { jobs, rawCount: rawItems.length, error: null };
  } catch (err) {
    return { jobs: [], rawCount: 0, error: messageFromUnknown(err) };
  }
}

export type HiringJobsSyncResult = {
  companies_processed: number;
  companies_failed: number;
  raw_jobs_returned: number;
  jobs_upserted: number;
  failures: Array<{ company_id: string; error: string }>;
  details: Array<{ company_id: string; company_name: string; jobs_seen: number }>;
};

export async function syncLinkedInJobsForCompanies(input: {
  companyIds: string[];
  orgId?: string | null;
  userId?: string | null;
}): Promise<HiringJobsSyncResult> {
  const admin = createAdminClient();
  const companyIds = [...new Set(input.companyIds.filter(Boolean))];
  if (!companyIds.length) {
    return {
      companies_processed: 0,
      companies_failed: 0,
      raw_jobs_returned: 0,
      jobs_upserted: 0,
      failures: [],
      details: [],
    };
  }

  const { data: companiesRaw, error: companiesErr } = await admin
    .from('companies')
    .select('id, company_name, aliases')
    .in('id', companyIds);
  if (companiesErr) throw new Error(companiesErr.message);
  const companies = (companiesRaw ?? []) as CompanyRow[];
  for (const company of companies) {
    if (!company.aliases?.length && company.company_name) {
      try {
        const result = await ensureCompanyAliases(admin, company.id);
        company.aliases = result.aliases;
      } catch { /* non-fatal */ }
    }
  }

  const companyNames = companies
    .map((company) => company.company_name?.trim())
    .filter((name): name is string => Boolean(name));
  const startedAt = new Date().toISOString();
  const { jobs, rawCount, error } = await fetchJobsFromLinkedIn(companyNames, {
    orgId: input.orgId ?? null,
    userId: input.userId ?? null,
  });
  if (error) {
    return {
      companies_processed: 0,
      companies_failed: companies.length,
      raw_jobs_returned: 0,
      jobs_upserted: 0,
      failures: companies.map((company) => ({
        company_id: company.id,
        error: `ATS fetch: ${error}`,
      })),
      details: [],
    };
  }

  const idToCompany = new Map(companies.map((company) => [company.id, company]));
  const rows: Array<{
    company_id: string;
    linkedin_job_id: string;
    title: string;
    title_normalized: string;
    company_name: string | null;
    job_url: string | null;
    scraped_at: string;
    last_seen_at: string;
  }> = [];
  const detailsByCompany = new Map<string, number>();

  for (const job of jobs) {
    const match = verifySourceCompanyNameAgainstCandidates(job.company_name_raw, companies);
    if (!match?.companyId) continue;
    const company = idToCompany.get(match.companyId);
    rows.push({
      company_id: match.companyId,
      linkedin_job_id: linkedinJobIdFromUrl(job.job_url) ?? fallbackLinkedInJobId(job),
      title: job.title,
      title_normalized: job.title_normalized,
      company_name: job.company_name_raw || company?.company_name || null,
      job_url: job.job_url,
      scraped_at: startedAt,
      last_seen_at: startedAt,
    });
    detailsByCompany.set(match.companyId, (detailsByCompany.get(match.companyId) ?? 0) + 1);
  }

  if (rows.length > 0) {
    const { error: upsertError } = await admin
      .from('job_postings_local')
      .upsert(rows, { onConflict: 'company_id,linkedin_job_id' });
    if (upsertError) throw new Error(`job postings mirror upsert failed: ${upsertError.message}`);
  }

  return {
    companies_processed: companies.length,
    companies_failed: 0,
    raw_jobs_returned: rawCount,
    jobs_upserted: rows.length,
    failures: [],
    details: companies.map((company) => ({
      company_id: company.id,
      company_name: company.company_name ?? company.id,
      jobs_seen: detailsByCompany.get(company.id) ?? 0,
    })),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────

type HiringMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
  lookbackDays?: number;
  refreshFromLinkedIn?: boolean;
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
  hiring_expansion: boolean;
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

type LocalJobPostingRow = {
  company_id: string;
  title: string;
  title_normalized: string | null;
  company_name: string | null;
  job_url: string | null;
  last_seen_at: string;
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
    /** Override buyer functions for normalization (e.g. derived from role mix for hiring_expansion) */
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

async function fetchJobsFromLocalMirror(
  admin: ReturnType<typeof createAdminClient>,
  companyIds: string[],
  lookbackDays: number,
): Promise<Map<string, ScrapedJob[]>> {
  const jobsByCompanyId = new Map<string, ScrapedJob[]>();
  const uniqueCompanyIds = [...new Set(companyIds.filter(Boolean))];
  if (!uniqueCompanyIds.length) return jobsByCompanyId;

  const freshCutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  for (let index = 0; index < uniqueCompanyIds.length; index += 200) {
    const slice = uniqueCompanyIds.slice(index, index + 200);
    const { data, error } = await admin
      .from('job_postings_local')
      .select('company_id, title, title_normalized, company_name, job_url, last_seen_at')
      .in('company_id', slice)
      .gte('last_seen_at', freshCutoff);
    if (error) throw new Error(`job postings mirror read failed: ${error.message}`);
    for (const row of (data ?? []) as LocalJobPostingRow[]) {
      if (!row.company_id || !row.title) continue;
      const list = jobsByCompanyId.get(row.company_id) ?? [];
      list.push({
        title: row.title,
        title_normalized: row.title_normalized ?? row.title.toLowerCase(),
        job_url: row.job_url,
        company_name_raw: row.company_name ?? '',
      });
      jobsByCompanyId.set(row.company_id, list);
    }
  }

  return jobsByCompanyId;
}

// ── Main monitor ──────────────────────────────────────────────────────────

export async function runHiringMonitor(input: HiringMonitorInput): Promise<HiringMonitorResult> {
  const admin = createAdminClient();
  const lookbackDays = Math.min(60, Math.max(1, Math.trunc(input.lookbackDays ?? 14)));
  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', input.userId).maybeSingle<{ org_id: string }>();

  // 1. Resolve which companies to process
  const ownedRows = (await listActiveCompanyStateForUser(admin, input.userId, 'company_id, company_fit_score'))
    .filter((r): r is { company_id: string; company_fit_score: number | null } =>
      typeof r.company_id === 'string' && Boolean(r.company_id));

  const requestedIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((v): v is string => typeof v === 'string' && Boolean(v))
    : [];
  let ownedIds: string[];
  if (requestedIds.length > 0) {
    // Explicit/targeted request — run exactly the companies asked for
    // (bypasses the routine-sweep fit gate).
    const set = new Set(requestedIds);
    ownedIds = ownedRows.filter((r) => set.has(r.company_id)).map((r) => r.company_id);
  } else {
    // Rolling sweep — good-fit companies only (guardrail #2). The Apify jobs
    // scrape should only ever recur on accounts worth watching; unscored
    // (null fit) companies are excluded.
    ownedIds = ownedRows
      .filter((r) => isCompanySweepEligible(r.company_fit_score))
      .map((r) => r.company_id)
      .slice(0, Math.min(Math.max(input.limit ?? 200, 1), 500));
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
      try {
        const result = await ensureCompanyAliases(admin, c.id);
        c.aliases = result.aliases;
      } catch { /* non-fatal */ }
    }
  }

  const idToCompany = new Map<string, CompanyRow>(companies.map((c) => [c.id, c]));

  if (input.refreshFromLinkedIn) {
    const sync = await syncLinkedInJobsForCompanies({
      companyIds: ownedIds,
      orgId: member?.org_id ?? null,
      userId: input.userId,
    });
    if (sync.companies_failed > 0) {
      return {
        processed: 0,
        failed: sync.companies_failed,
        postings_scanned: 0,
        candidate_events_before_dedupe: 0,
        events_skipped_as_duplicates: 0,
        emitted_signal_types: [],
        recomputed_companies: [],
        failures: sync.failures,
        details: [],
      };
    }
  }

  const jobsByCompanyId = await fetchJobsFromLocalMirror(admin, ownedIds, lookbackDays);
  const totalPostingsScanned = [...jobsByCompanyId.values()].reduce((sum, list) => sum + list.length, 0);

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
      // hiring_expansion (per catalog note: "computed from classified role mix").
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
          hiring_expansion: postings.length >= JOB_SURGE_THRESHOLD,
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
      if (shouldEmit('hiring_expansion') && postings.length >= JOB_SURGE_THRESHOLD) {
        candidateIds.push(`${SOURCE}:${companyId}:hiring_expansion:${currentWeekKey}`);
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
        const label = CATEGORY_LABELS[cat];
        const reason = CATEGORY_REASONS[cat];
        const exampleTitles = list.slice(0, 3).map((p) => p.title).join('; ');
        const roleCount = list.length === 1 ? 'an open' : `${list.length} open`;
        const summary = `${name} is hiring for ${roleCount} ${label} role${list.length > 1 ? 's' : ''} (${reason}). E.g. ${exampleTitles}.`;

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
            source_company_names: [...new Set(list.map((p) => p.company_name_raw).filter(Boolean))],
            ...(list[0]?.company_match_metadata ?? {}),
          },
          existingIds,
        });

        if (result === 'emitted') { emittedAny = true; emittedSignalTypes.add(cat); }
        else skippedDupes += 1;
      }

      // Emit hiring_expansion — buyer functions derived from actual category mix,
      // not the static catalog list (per catalog note on hiring_expansion).
      if (shouldEmit('hiring_expansion') && postings.length >= JOB_SURGE_THRESHOLD) {
        const sourceEventId = `${SOURCE}:${companyId}:hiring_expansion:${currentWeekKey}`;
        const matchedTitles = [...byCategory.values()].flat().map((p) => p.title);
        const categoryLabels = categoryMatches
          .map((c) => `${CATEGORY_LABELS[c.key]} (${c.count})`)
          .join(', ');
        const summary = `${name} has ${postings.length} open roles across multiple functions — broad hiring expansion. Functions: ${categoryLabels || 'unclassified'}.`;

        const result = await emitHiringSignal(admin, {
          userId: input.userId,
          companyId,
          companyName: name,
          signalKey: 'hiring_expansion',
          sourceEventType: 'ats_jobs_surge',
          sourceEventId,
          sourceUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(name)}`,
          summary,
          eventAt: now,
          metadata: {
            total_postings: postings.length,
            matched_postings: matchedTitles.length,
            matched_titles: matchedTitles,
            // Every scraped posting (title + LinkedIn URL), so the /log surge
            // row can list the full set of open roles, not just the matched
            // ones. Capped to keep the metadata blob bounded.
            all_roles: postings.slice(0, 100).map((p) => ({ title: p.title, url: p.job_url })),
            source_company_names: [...new Set(postings.map((p) => p.company_name_raw).filter(Boolean))],
            ...(postings[0]?.company_match_metadata ?? {}),
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

        if (result === 'emitted') { emittedAny = true; emittedSignalTypes.add('hiring_expansion'); }
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
    postings_scanned: totalPostingsScanned,
    candidate_events_before_dedupe: candidatesBefore,
    events_skipped_as_duplicates: skippedDupes,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedIds],
    failures,
    details,
  };
}
