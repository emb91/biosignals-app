import { createAdminClient } from '@/lib/supabase-admin';
import { orgIdForUser, scopeIcpsToUser } from '@/lib/org-context';
import { processQueuedRowsInBackground, type QueuedRow } from '@/lib/import-queue';
import type { ImportProgressCallback } from '@/lib/import-ingestion';
import {
  DEFAULT_CONTACTS_PER_COMPANY,
  DEFAULT_MONTHLY_CREDIT_LIMIT,
  creditUnitsForEvent,
  recordDataAcquisitionUsageEvent,
  type DataAcquisitionUsageEventType,
} from '@/lib/data-acquisition-metering';
import { refundCredits, settleCredits, settleUsage } from '@/lib/billing/credits';
import {
  discoverApolloCompanies,
  discoverApolloPeopleForCompanies,
  type DiscoveredCompany,
  type DiscoveredPerson,
  type PeopleSearchTarget,
} from '@/lib/data-acquisition/apollo-discovery';
import {
  apolloOrganizationHardRejectReason,
  buildApolloCompanySearchRecipes,
  buildApolloPeopleSearchRecipe,
  type AcquisitionIcp,
  type AcquisitionPersona,
} from '@/lib/data-acquisition/search-spec';
import { enrichOrganizationWithApollo } from '@/lib/apollo';
import { discoverCompaniesWithWebSearch } from '@/lib/data-acquisition/web-discovery';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { personaFunctionNames } from '@/lib/persona-functions';
import { SOURCE_COMPANY_MIN } from '@/lib/lead-action';

type DataAcquisitionJob = {
  id: string;
  user_id: string;
  org_id: string | null;
  icp_id: string;
  upload_batch_id: string | null;
  request_type: 'expand_companies' | 'better_contacts' | 'more_contacts_at_accounts' | 'contacts_at_company';
  target_company_count: number;
  target_contact_count: number | null;
  max_screened_companies: number | null;
  max_contact_enrichments: number | null;
  max_credit_units: number | string | null;
  actual_credit_units: number | string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type ExistingCompany = {
  company_name: string | null;
  domain?: string | null;
  website?: string | null;
  linkedin_url: string | null;
};

type ExistingContact = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  apollo_person_raw?: unknown;
};

/** Apollo person id from a stored contact's revealed record, if present. */
function apolloPersonIdOf(raw: unknown): string | null {
  const id = (raw as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

type OwnedContactRef = {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  company_id: string | null;
  company_domain: string | null;
};

type CompanyContext = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  matched_icp_id: string | null;
};

type DbCompanyRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  website: string | null;
  linkedin_url: string | null;
  // The `companies` table does not store an Apollo org record — people search
  // falls back to the company domain (q_organization_domains_list), so this is
  // always absent here. Kept optional for the DiscoveredCompany mapping shape.
  apollo_organization_raw?: unknown;
  employee_count: number | null;
};

type UserCompanyFitRow = {
  company_id: string | null;
  company_fit_score: number | string | null;
};

// Jobs in these states own the user's single execution slot. The FIFO queue
// only starts the next 'queued' job when nothing is in one of these states.
const ACTIVE_JOB_STATUSES = ['discovering', 'processing', 'importing', 'enriching'] as const;

/** Chunk imports so the /data pipeline rail can show stepped progress like the demo. */
const IMPORT_PROGRESS_CHUNKS = 4;

/** Max owned-contact exclusion entries passed to a single Apollo people search. */
const MAX_EXCLUSIONS_PER_CALL = 100;

function apolloOrgIdFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function discoveredCompanyFromDbRow(row: DbCompanyRow): DiscoveredCompany | null {
  const domain =
    (row.domain || row.website || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '') || null;
  const name = row.company_name?.trim() || domain;
  if (!name || !domain) return null;
  const sourceId = apolloOrgIdFromRaw(row.apollo_organization_raw);
  return {
    source: 'apollo',
    source_id: sourceId,
    name,
    domain,
    linkedin_url: row.linkedin_url || null,
    employee_count: typeof row.employee_count === 'number' ? row.employee_count : null,
    raw: {
      name,
      primary_domain: domain,
      website_url: row.website || row.domain || null,
      linkedin_url: row.linkedin_url || null,
      id: sourceId || undefined,
    },
  };
}

function normalizeFitScore01(value: unknown): number | null {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  if (!Number.isFinite(raw)) return null;
  if (raw > 1 && raw <= 100) return raw / 100;
  return raw >= 0 && raw <= 1 ? raw : null;
}

async function loadCompanyFitForPurchase(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyId: string,
  icpId: string,
): Promise<number | null> {
  const { data, error } = await admin
    .from('user_companies')
    .select('company_fit_score')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('matched_icp_id', icpId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return normalizeFitScore01((data as { company_fit_score?: unknown } | null)?.company_fit_score);
}

function lowCompanyFitPurchaseNote(companyName: string | null, companyFit: number | null): string {
  const label = companyName?.trim() || 'this account';
  if (companyFit == null) {
    return `We did not source contacts at ${label} because it does not have a high company-fit score yet.`;
  }
  return `We did not source contacts at ${label} because its company fit is ${Math.round(companyFit * 100)}%, below the ${Math.round(SOURCE_COMPANY_MIN * 100)}% purchase threshold.`;
}

async function loadPrioritizedCompaniesForIcpAccounts(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  icpId: string,
  requestType: 'better_contacts' | 'more_contacts_at_accounts',
  limit: number,
): Promise<DbCompanyRow[]> {
  const { data: ownedRows, error: ownedError } = await admin
    .from('user_companies')
    .select('company_id, company_fit_score')
    .eq('user_id', userId)
    .eq('matched_icp_id', icpId);
  if (ownedError) throw new Error(ownedError.message);
  const ownedIds = ((ownedRows ?? []) as UserCompanyFitRow[])
    .filter((row) => {
      const fit = normalizeFitScore01(row.company_fit_score);
      return typeof row.company_id === 'string' && fit != null && fit >= SOURCE_COMPANY_MIN;
    })
    .map((row) => row.company_id as string);
  if (ownedIds.length === 0) return [];

  const { data: companies, error } = await admin
    .from('companies')
    .select('id, company_name, domain, website, linkedin_url, employee_count')
    .in('id', ownedIds);

  if (error) throw new Error(error.message);
  const rows = (companies || []) as DbCompanyRow[];
  if (rows.length === 0) return [];

  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('company_id, contact_fit_score')
    .eq('user_id', userId)
    .not('company_id', 'is', null);

  if (cErr) throw new Error(cErr.message);

  const byCompany = new Map<string, { count: number; fitSum: number; fitN: number }>();
  for (const row of contacts || []) {
    const cid = row.company_id as string | null;
    if (!cid) continue;
    if (!byCompany.has(cid)) byCompany.set(cid, { count: 0, fitSum: 0, fitN: 0 });
    const agg = byCompany.get(cid)!;
    agg.count += 1;
    const rawFit = row.contact_fit_score;
    if (typeof rawFit === 'number' && Number.isFinite(rawFit)) {
      let f = rawFit;
      if (f > 1 && f <= 100) f /= 100;
      if (f >= 0 && f <= 1) {
        agg.fitSum += f;
        agg.fitN += 1;
      }
    }
  }

  const scored = rows.map((row) => {
    const agg = byCompany.get(row.id) || { count: 0, fitSum: 0, fitN: 0 };
    const avgFit = agg.fitN > 0 ? agg.fitSum / agg.fitN : null;
    return { row, contactCount: agg.count, avgFit };
  });

  if (requestType === 'more_contacts_at_accounts') {
    scored.sort((a, b) => a.contactCount - b.contactCount || a.row.id.localeCompare(b.row.id));
  } else {
    scored.sort((a, b) => {
      const af = a.avgFit ?? -1;
      const bf = b.avgFit ?? -1;
      if (af !== bf) return af - bf;
      return a.contactCount - b.contactCount;
    });
  }

  return scored.slice(0, limit).map((s) => s.row);
}

// ─── Internal provider-cost guard (never customer billing) ──────────────────

type CapKind = 'monthly' | 'job';

type CreditGuard = {
  /** Book units consumed by this job (call after each metered usage event). */
  charge: (units: number) => void;
  /** Which cap (if any) has been reached. */
  capReached: () => CapKind | null;
};

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the optional runtime provider-cost safety guard. Monthly usage is the sum of
 * actual_credit_units over the user's jobs requested this calendar month
 * (trigger-maintained per job, so no event-table scan is needed). The monthly
 * limit comes from user_billing_limits and falls back to
 * DEFAULT_MONTHLY_CREDIT_LIMIT when the user has no row (or a null limit).
 * The per-job cap is the job's max_credit_units. Customer authorization is
 * handled by the Arcova credit reservation before this runner starts. This
 * legacy guard is analytics-only unless DATA_ACQUISITION_INTERNAL_SAFETY_CAP_ENABLED=true.
 */
async function buildCreditGuard(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
): Promise<CreditGuard> {
  // Org-scoped cap: data is billed to the org, so the monthly ceiling and month-to-date
  // spend are summed across the whole org. Falls back to the per-user limit/spend when the
  // job has no org (legacy / un-orged). org_billing_limits overrides user_billing_limits.
  let monthlyLimit: number | null = null;
  if (job.org_id) {
    const { data: orgLimitRow } = await admin
      .from('org_billing_limits')
      .select('monthly_credit_limit')
      .eq('org_id', job.org_id)
      .maybeSingle();
    monthlyLimit = toFiniteNumber((orgLimitRow as { monthly_credit_limit?: unknown } | null)?.monthly_credit_limit);
  }
  if (monthlyLimit == null) {
    const { data: limitRow } = await admin
      .from('user_billing_limits')
      .select('monthly_credit_limit')
      .eq('user_id', job.user_id)
      .maybeSingle();
    monthlyLimit =
      toFiniteNumber((limitRow as { monthly_credit_limit?: unknown } | null)?.monthly_credit_limit) ??
      DEFAULT_MONTHLY_CREDIT_LIMIT;
  }

  const now = new Date();
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthJobsQuery = admin
    .from('data_acquisition_jobs')
    .select('id, actual_credit_units')
    .gte('requested_at', monthStartIso);
  const { data: monthJobs } = await (job.org_id
    ? monthJobsQuery.eq('org_id', job.org_id)
    : monthJobsQuery.eq('user_id', job.user_id));

  let monthUnits = 0;
  let jobUnits = 0;
  for (const row of (monthJobs ?? []) as Array<{ id: string; actual_credit_units: unknown }>) {
    const units = toFiniteNumber(row.actual_credit_units) ?? 0;
    monthUnits += units;
    if (row.id === job.id) jobUnits = units;
  }

  const jobLimit = toFiniteNumber(job.max_credit_units);

  return {
    charge(units: number) {
      jobUnits += units;
      monthUnits += units;
    },
    capReached() {
      if (process.env.DATA_ACQUISITION_INTERNAL_SAFETY_CAP_ENABLED !== 'true') return null;
      if (monthUnits >= monthlyLimit) return 'monthly';
      if (jobLimit != null && jobLimit > 0 && jobUnits >= jobLimit) return 'job';
      return null;
    },
  };
}

type Meter = (
  eventType: DataAcquisitionUsageEventType,
  quantity: number,
  metadata: Record<string, unknown>,
  provider?: string,
) => Promise<void>;

function makeMeter(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  guard: CreditGuard,
): Meter {
  return async (eventType, quantity, metadata, provider = 'apollo') => {
    if (quantity <= 0) return;
    await recordDataAcquisitionUsageEvent(admin, {
      jobId: job.id,
      userId: job.user_id,
      orgId: job.org_id,
      eventType,
      provider,
      quantity,
      metadata,
    });
    guard.charge(creditUnitsForEvent(eventType, quantity));
  };
}

function formatPersonaForContactScreen(persona: AcquisitionPersona): string {
  const functions = personaFunctionNames(persona.functions);
  return [
    `Persona: ${persona.name || 'Unnamed persona'}`,
    `Functions: ${functions.length > 0 ? functions.join(', ') : 'Not specified'}`,
    `Seniority: ${persona.seniority_levels?.length ? persona.seniority_levels.join(', ') : 'Not specified'}`,
    `Title examples: ${persona.job_titles?.length ? persona.job_titles.join(', ') : 'Not specified'}`,
  ].join('\n');
}

function formatPersonForContactScreen(person: DiscoveredPerson, index: number): string {
  return [
    `Contact ${index}`,
    `Name: ${person.full_name || 'Unknown'}`,
    `Title: ${person.job_title || 'Unknown'}`,
    `Company: ${person.company_name || 'Unknown'}`,
    `Company domain: ${person.company_domain || 'Unknown'}`,
  ].join('\n');
}

type ContactPersonaScreenVerdict = {
  contact_index?: unknown;
  verdict?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

type ContactPersonaScreenResult = {
  people: DiscoveredPerson[];
  rejected: number;
};

type CompanyIcpScreenVerdict = {
  verdict?: unknown;
  score?: unknown;
  confidence?: unknown;
  reason?: unknown;
  matched_on?: unknown;
  gaps?: unknown;
};

type CompanyIcpScreenResult = {
  passes: boolean;
  verdict: string;
  score: number | null;
  confidence: number;
  reason: string;
};

function parseContactPersonaScreenResponse(text: string): ContactPersonaScreenVerdict[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  return Array.isArray(parsed) ? (parsed as ContactPersonaScreenVerdict[]) : [];
}

function parseCompanyIcpScreenResponse(text: string): CompanyIcpScreenVerdict | null {
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (!objectMatch) return null;
  const parsed = JSON.parse(objectMatch[0]) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as CompanyIcpScreenVerdict)
    : null;
}

function formatIcpForCompanyScreen(icp: AcquisitionIcp): string {
  const list = (values: string[] | null | undefined) =>
    values?.map((value) => value.trim()).filter(Boolean).join(', ') || 'Not specified';
  return [
    `ICP name: ${icp.name || 'Unnamed ICP'}`,
    `Company type: ${icp.company_type || 'Not specified'}`,
    `Platform category: ${icp.platform_category || 'Not specified'}`,
    `Therapeutic areas: ${list(icp.therapeutic_areas)}`,
    `Modalities: ${list(icp.modalities)}`,
    `Development stages: ${list(icp.development_stages)}`,
    `Company sizes: ${list(icp.company_sizes)}`,
    `Funding stages: ${list(icp.funding_stages)}`,
    `Target customers: ${list(icp.target_customers)}`,
    `Buyer types: ${list(icp.buyer_types)}`,
  ].join('\n');
}

function formatCompanyEvidenceForScreen(evidence: unknown): string {
  const record = evidence && typeof evidence === 'object' ? evidence as Record<string, unknown> : {};
  const stringValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return 'Unknown';
  };
  const arrayValue = (...keys: string[]) => {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        const cleaned = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
        if (cleaned.length > 0) return cleaned.slice(0, 12).join(', ');
      }
    }
    return 'Unknown';
  };

  return [
    `Name: ${stringValue('name', 'company_name', 'organization_name')}`,
    `Domain: ${stringValue('primary_domain', 'domain', 'website_url', 'website')}`,
    `Description: ${stringValue('short_description', 'description', 'company_description', 'seo_description')}`,
    `Industry: ${stringValue('industry', 'company_industry')}`,
    `Keywords: ${arrayValue('keywords', 'industries', 'specialties')}`,
    `Raw evidence: ${JSON.stringify(record).slice(0, 2500)}`,
  ].join('\n');
}

function numericScore(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n > 1 ? n : n * 100));
}

async function screenCompanyAgainstIcp(params: {
  evidence: unknown;
  company: DiscoveredCompany;
  icp: AcquisitionIcp;
  job: DataAcquisitionJob;
  meter: Meter;
  metadata: Record<string, unknown>;
}): Promise<CompanyIcpScreenResult> {
  const { evidence, company, icp, job, meter, metadata } = params;
  const hardRejectReason = apolloOrganizationHardRejectReason(
    evidence as { name?: string | null; short_description?: string | null; industry?: string | null },
    icp,
  );
  if (hardRejectReason) {
    return {
      passes: false,
      verdict: 'reject',
      score: 0,
      confidence: 1,
      reason: hardRejectReason,
    };
  }

  const prompt = `You screen a company before the system spends money buying contacts.

Decide whether this company is likely a high-fit account for the ICP. Use judgment, not keyword overlap.
Accept only if the company itself plausibly matches the ICP account profile. Reject if it is merely adjacent, a service/provider when the ICP targets biopharma buyers, an association/media/payer/pet/vet company, or if evidence is too thin/contradictory.

Special handling:
- Hospitals, CROs, CDMOs, universities, and research institutes can be qualified only when the ICP company type/buying context targets them.
- Universities may be qualified for tools/research ICPs when the evidence points to researchers/labs; university administration is not enough.
- Supply/service vendors are not biopharma companies just because they mention oncology or clinical trials.

ICP:
${formatIcpForCompanyScreen(icp)}

COMPANY EVIDENCE:
${formatCompanyEvidenceForScreen(evidence)}

Return ONLY valid JSON:
{
  "verdict": "qualified" | "reject",
  "score": <integer 0-100, expected company fit>,
  "confidence": <number 0-1>,
  "reason": "<one concise sentence>",
  "matched_on": ["specific fit evidence"],
  "gaps": ["specific mismatch or missing evidence"]
}`;

  try {
    const completion = await completeLlm({
      feature: 'company_fit_scoring',
      prompt,
      maxTokens: 900,
      temperature: 0,
    });

    await recordLlmUsageEvent({
      userId: job.user_id,
      provider: completion.provider,
      feature: 'company_pre_purchase_screen',
      route: 'lib/data-acquisition/job-runner#screenCompanyAgainstIcp',
      model: completion.model,
      usage: completion.usage,
      metadata: {
        job_id: job.id,
        request_type: job.request_type,
        company: company.name,
        domain: company.domain,
      },
    });

    await meter('llm_fit_screen', 1, {
      ...metadata,
      entity_type: 'company',
      company: company.name,
      domain: company.domain,
      reason: 'pre_purchase_company_icp_screen',
    }, completion.provider);

    const parsed = parseCompanyIcpScreenResponse(completion.text);
    const verdict = typeof parsed?.verdict === 'string' ? parsed.verdict.toLowerCase() : 'reject';
    const score = numericScore(parsed?.score);
    const confidence =
      typeof parsed?.confidence === 'number' && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    const reason =
      typeof parsed?.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 500)
        : 'LLM did not provide a usable company-screen reason.';
    const passes = verdict === 'qualified' && (score ?? 0) >= 70 && confidence >= 0.55;

    return {
      passes,
      verdict,
      score,
      confidence,
      reason,
    };
  } catch (error) {
    console.warn(
      '[data-acquisition] company ICP screen failed closed:',
      error instanceof Error ? error.message : error,
    );
    return {
      passes: false,
      verdict: 'reject',
      score: null,
      confidence: 1,
      reason: 'company_icp_screen_unavailable',
    };
  }
}

async function screenPeopleAgainstPersonas(params: {
  people: DiscoveredPerson[];
  personas: AcquisitionPersona[];
  job: DataAcquisitionJob;
  meter: Meter;
  metadata: Record<string, unknown>;
}): Promise<ContactPersonaScreenResult> {
  const { people, personas, job, meter, metadata } = params;
  if (people.length === 0 || personas.length === 0) {
    return { people, rejected: 0 };
  }

  const kept: DiscoveredPerson[] = [];
  let rejected = 0;
  const batchSize = 20;
  const personaBlock = personas.map(formatPersonaForContactScreen).join('\n\n---\n\n');

  for (let start = 0; start < people.length; start += batchSize) {
    const batch = people.slice(start, start + batchSize);
    const contactBlock = batch
      .map((person, offset) => formatPersonForContactScreen(person, offset))
      .join('\n\n');

    const prompt = `You screen visible Apollo people-search results before paid enrichment.

Use judgment to decide whether each contact's visible title plausibly matches at least one buyer persona.
Do not use a fixed keyword rule. Reason from the life-sciences meaning of the title, function, seniority, and persona.

Important taxonomy guidance:
- Partnerships includes alliance management, external partnerships, public-private partnerships, ecosystem partnerships, global health partnerships, and collaboration ownership.
- Business Development includes licensing, dealmaking, partnering strategy, external growth, and customer-facing strategic opportunities.
- Strategy & Corporate Development is corporate strategy, portfolio strategy, M&A, strategic planning, and corporate development when partnerships/dealmaking are not the primary role.
- Manufacturing & CMC includes CMC, technical operations, process development, manufacturing, quality manufacturing, supply operations, and product supply. Supply chain can match Manufacturing & CMC only when the title points to manufacturing, technical operations, product supply, or CMC ownership; purely commercial supply chain is usually not a CMC buyer.

Reject only when the visible title is clearly outside all personas. If the title is plausibly relevant or ambiguous, keep it so enrichment can inspect richer evidence.

BUYER PERSONAS:
${personaBlock}

CONTACTS:
${contactBlock}

Return ONLY valid JSON:
[
  {
    "contact_index": 0,
    "verdict": "keep" | "reject",
    "confidence": 0.0,
    "reason": "brief reason"
  }
]`;

    try {
      const completion = await completeLlm({
        feature: 'intent_scoring',
        prompt,
        maxTokens: 1200,
      });

      await recordLlmUsageEvent({
        userId: job.user_id,
        provider: completion.provider,
        feature: 'contact_persona_pre_enrichment_screen',
        route: 'lib/data-acquisition/job-runner#screenPeopleAgainstPersonas',
        model: completion.model,
        usage: completion.usage,
        metadata: {
          job_id: job.id,
          request_type: job.request_type,
          batch_size: batch.length,
          persona_count: personas.length,
        },
      });

      await meter('llm_fit_screen', batch.length, {
        ...metadata,
        entity_type: 'contact',
        reason: 'pre_enrichment_persona_screen',
      }, completion.provider);

      const verdicts = parseContactPersonaScreenResponse(completion.text);
      const byIndex = new Map<number, ContactPersonaScreenVerdict>();
      for (const verdict of verdicts) {
        const index = typeof verdict.contact_index === 'number' ? verdict.contact_index : null;
        if (index != null && index >= 0 && index < batch.length) {
          byIndex.set(index, verdict);
        }
      }

      for (let index = 0; index < batch.length; index += 1) {
        const verdict = byIndex.get(index);
        const decision = typeof verdict?.verdict === 'string' ? verdict.verdict.toLowerCase() : 'keep';
        const confidence =
          typeof verdict?.confidence === 'number' && Number.isFinite(verdict.confidence)
            ? verdict.confidence
            : 0;

        if (decision === 'reject' && confidence >= 0.7) {
          rejected += 1;
          await meter('low_fit_company_rejected', 1, {
            ...metadata,
            entity_type: 'contact',
            person: batch[index].full_name,
            title: batch[index].job_title,
            company: batch[index].company_name,
            reason:
              typeof verdict?.reason === 'string' && verdict.reason.trim()
                ? verdict.reason.trim().slice(0, 500)
                : 'Rejected by pre-enrichment persona screen',
          }, 'arcova');
          continue;
        }

        kept.push(batch[index]);
      }
    } catch (error) {
      console.warn(
        '[data-acquisition] contact persona screen failed closed:',
        error instanceof Error ? error.message : error,
      );
      rejected += batch.length;
      for (const person of batch) {
        await meter('low_fit_company_rejected', 1, {
          ...metadata,
          entity_type: 'contact',
          person: person.full_name,
          title: person.job_title,
          company: person.company_name,
          reason: 'contact_persona_screen_unavailable',
        }, 'arcova');
      }
    }
  }

  return { people: kept, rejected };
}

function personaScreenNote(requested: number, kept: number, rejected: number): string | null {
  if (rejected <= 0) return null;
  if (kept === 0) {
    return `We found ${requested} possible contacts, but the persona-fit screen rejected all of them before paid enrichment.`;
  }
  return `We found ${requested} possible contacts and screened out ${rejected} before paid enrichment because their visible titles did not match the requested persona.`;
}

/**
 * Plain-language partial-fulfillment note. Deliberately never mentions credit
 * units: costs are internal-only (admin data-costs route).
 */
function shortfallNote(
  kind: CapKind,
  delivered: number,
  requested: number,
  unit: 'contacts' | 'companies',
): string {
  const reason =
    kind === 'monthly'
      ? "you've reached your plan's usage limit this month"
      : 'this job reached its size limit';
  return `We sourced ${delivered} of the ${requested} requested ${unit} because ${reason}.`;
}

// ─── Dedup keys ───────────────────────────────────────────────────────────────

function normalizeKey(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * LinkedIn identity key. CRITICAL: do NOT use `normalizeKey` on LinkedIn URLs —
 * it strips the path (`/company/<slug>` or `/in/<slug>`), collapsing EVERY
 * LinkedIn URL to a bare `linkedin.com`. That made every company/contact with a
 * LinkedIn falsely dedup against every other (expand_companies skipped all
 * candidates as "already owned"). Keep the slug; the host+path is the identity.
 * Returns '' for a path-less `linkedin.com` (no slug = no identity to dedup on).
 */
function normalizeLinkedinKey(value: string | null | undefined): string {
  const v = (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
  return v.includes('/') ? v : '';
}

function companyKeys(company: Pick<DiscoveredCompany, 'domain' | 'linkedin_url' | 'name'>): string[] {
  const li = normalizeLinkedinKey(company.linkedin_url);
  return [
    company.domain ? `domain:${normalizeKey(company.domain)}` : '',
    li ? `linkedin:${li}` : '',
    company.name ? `name:${normalizeKey(company.name)}` : '',
  ].filter(Boolean);
}

function existingCompanyKeys(company: ExistingCompany): string[] {
  const li = normalizeLinkedinKey(company.linkedin_url);
  return [
    company.domain ? `domain:${normalizeKey(company.domain)}` : '',
    company.website ? `domain:${normalizeKey(company.website)}` : '',
    li ? `linkedin:${li}` : '',
    company.company_name ? `name:${normalizeKey(company.company_name)}` : '',
  ].filter(Boolean);
}

function contactKey(person: DiscoveredPerson): string {
  // Apollo person id first: people-search (api_search) returns obfuscated rows
  // (no email/linkedin, first-name-only), so name/email keys can't dedup them —
  // but the id is stable and always present, and existing Apollo-sourced
  // contacts carry it on apollo_person_raw.
  return (
    (person.source_id && `apollo:${normalizeKey(person.source_id)}`) ||
    (normalizeLinkedinKey(person.linkedin_url) && `linkedin:${normalizeLinkedinKey(person.linkedin_url)}`) ||
    (person.email && `email:${normalizeKey(person.email)}`) ||
    `name_company:${normalizeKey(person.full_name)}:${normalizeKey(person.company_name)}`
  );
}

function existingContactKeys(contact: ExistingContact): string[] {
  const fullName =
    contact.full_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    null;
  const apolloId = apolloPersonIdOf(contact.apollo_person_raw);
  const li = normalizeLinkedinKey(contact.linkedin_url);
  return [
    apolloId ? `apollo:${normalizeKey(apolloId)}` : '',
    li ? `linkedin:${li}` : '',
    contact.email ? `email:${normalizeKey(contact.email)}` : '',
    fullName && contact.company_name
      ? `name_company:${normalizeKey(fullName)}:${normalizeKey(contact.company_name)}`
      : '',
  ].filter(Boolean);
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin
    .from('data_acquisition_jobs')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw new Error(error.message);
}

// ─── Pre-flight contact gap helpers ──────────────────────────────────────────

/**
 * Owned contacts at specific companies, keyed by company_id and by normalized
 * company_domain. Used by the pre-flight gap check (skip companies whose
 * requested coverage already exists) and to build the per-company Apollo
 * exclusion lists. The "how many do we want" number is NOT computed here: it
 * comes from the job's requested quantity (which itself derives from the
 * coverage plan / persona definitions upstream).
 */
async function loadOwnedContactsForCompanies(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyIds: string[],
  domains: string[],
): Promise<{ byCompanyId: Map<string, OwnedContactRef[]>; byDomain: Map<string, OwnedContactRef[]> }> {
  const byCompanyId = new Map<string, OwnedContactRef[]>();
  const byDomain = new Map<string, OwnedContactRef[]>();
  const seenIds = new Set<string>();

  const ingest = (rows: OwnedContactRef[] | null | undefined) => {
    for (const row of rows ?? []) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      if (row.company_id) {
        if (!byCompanyId.has(row.company_id)) byCompanyId.set(row.company_id, []);
        byCompanyId.get(row.company_id)!.push(row);
      }
      const domainKey = normalizeKey(row.company_domain);
      if (domainKey) {
        if (!byDomain.has(domainKey)) byDomain.set(domainKey, []);
        byDomain.get(domainKey)!.push(row);
      }
    }
  };

  const select = 'id, email, linkedin_url, company_id, company_domain';
  if (companyIds.length > 0) {
    const { data, error } = await admin
      .from('contacts')
      .select(select)
      .eq('user_id', userId)
      .in('company_id', companyIds);
    if (error) throw new Error(error.message);
    ingest((data ?? []) as OwnedContactRef[]);
  }
  const cleanDomains = [...new Set(domains.map((d) => normalizeKey(d)).filter(Boolean))];
  if (cleanDomains.length > 0) {
    const { data, error } = await admin
      .from('contacts')
      .select(select)
      .eq('user_id', userId)
      .in('company_domain', cleanDomains);
    if (error) throw new Error(error.message);
    ingest((data ?? []) as OwnedContactRef[]);
  }

  return { byCompanyId, byDomain };
}

function ownedContactsAt(
  owned: { byCompanyId: Map<string, OwnedContactRef[]>; byDomain: Map<string, OwnedContactRef[]> },
  companyId: string | null,
  domain: string | null,
): OwnedContactRef[] {
  const merged = new Map<string, OwnedContactRef>();
  if (companyId) for (const c of owned.byCompanyId.get(companyId) ?? []) merged.set(c.id, c);
  const domainKey = normalizeKey(domain);
  if (domainKey) for (const c of owned.byDomain.get(domainKey) ?? []) merged.set(c.id, c);
  return [...merged.values()];
}

/** Exclusion lists for one Apollo people call, capped at MAX_EXCLUSIONS_PER_CALL entries total. */
function exclusionListsFor(contacts: OwnedContactRef[]): {
  excludeEmails: string[];
  excludeLinkedinUrls: string[];
} {
  const excludeEmails: string[] = [];
  const excludeLinkedinUrls: string[] = [];
  let total = 0;
  for (const contact of contacts) {
    if (total >= MAX_EXCLUSIONS_PER_CALL) break;
    if (contact.linkedin_url?.trim()) {
      excludeLinkedinUrls.push(contact.linkedin_url.trim());
      total += 1;
      if (total >= MAX_EXCLUSIONS_PER_CALL) break;
    }
    if (contact.email?.trim()) {
      excludeEmails.push(contact.email.trim());
      total += 1;
    }
  }
  // If a company somehow exceeds the cap we truncate here; the whole-book
  // post-fetch dedup below remains in place as the second line of defense.
  return { excludeEmails, excludeLinkedinUrls };
}

// ─── Shared pipeline tail ─────────────────────────────────────────────────────

function rawUploadFromPerson(userId: string, batchId: string, person: DiscoveredPerson, jobId: string) {
  const rawData = {
    full_name: person.full_name,
    first_name: person.first_name,
    last_name: person.last_name,
    company_name: person.company_name,
    company_domain: person.company_domain || '',
    company_linkedin_url: person.company_linkedin_url || '',
    job_title: person.job_title || '',
    email: person.email || '',
    linkedin_url: person.linkedin_url || '',
    location: person.location || '',
    source: 'arcova_data_acquisition',
    data_acquisition_job_id: jobId,
    apollo_person_raw: person.raw,
  };

  return {
    user_id: userId,
    batch_id: batchId,
    raw_data: rawData,
    full_name: person.full_name,
    email: person.email,
    linkedin_url: person.linkedin_url,
    company_name: person.company_name,
    status: 'enriching',
  };
}

async function ingestPeopleAndRunImportPipeline(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  uniquePeople: DiscoveredPerson[],
  usageMeta: Record<string, unknown>,
  meter: Meter,
  completionNote: string | null,
): Promise<void> {
  const rawRows = uniquePeople.map((person) =>
    rawUploadFromPerson(job.user_id, job.upload_batch_id!, person, job.id),
  );
  const { data: insertedRows, error: insertError } =
    rawRows.length > 0
      ? await admin
          .from('raw_uploads')
          .insert(rawRows)
          .select('id, full_name, email, linkedin_url, company_name, raw_data')
      : { data: [], error: null };

  if (insertError) throw new Error(insertError.message);

  await admin
    .from('upload_batches')
    .update({
      total_rows: rawRows.length,
      status: rawRows.length > 0 ? 'processing' : 'complete',
      completed_at: rawRows.length > 0 ? null : new Date().toISOString(),
    })
    .eq('id', job.upload_batch_id);

  const queuedRows: QueuedRow[] = (insertedRows || []).map((row) => ({
    id: row.id as string,
    full_name: row.full_name as string | null,
    email: row.email as string | null,
    linkedin_url: row.linkedin_url as string | null,
    company_name: row.company_name as string | null,
    raw_data: row.raw_data as Record<string, unknown>,
  }));

  if (queuedRows.length === 0) {
    const metadata = await buildCoverageWritebackMetadata(admin, job);
    await updateJob(job.id, {
      status: 'complete',
      completed_at: new Date().toISOString(),
      completion_note: completionNote,
      metadata,
    });
    return;
  }

  await updateJob(job.id, { status: 'enriching' });

  if (rawRows.length > 0) {
    await meter('apollo_person_enrichment', rawRows.length, { batchId: job.upload_batch_id, ...usageMeta });
  }

  const chunkSize = Math.max(1, Math.ceil(queuedRows.length / IMPORT_PROGRESS_CHUNKS));
  let importPhaseStarted = false;

  const onProgress: ImportProgressCallback = async (event) => {
    if (job.request_type !== 'expand_companies' && event.type === 'imported_company') return;
    await meter(
      event.type,
      event.quantity,
      { batchId: job.upload_batch_id, ...usageMeta, ...event.metadata },
      'arcova',
    );
  };

  for (let i = 0; i < queuedRows.length; i += chunkSize) {
    const chunk = queuedRows.slice(i, i + chunkSize);
    await processQueuedRowsInBackground({
      queuedRows: chunk,
      batchId: job.upload_batch_id!,
      userId: job.user_id,
      autoEnrich: true,
      onBeforeIngest: async () => {
        if (!importPhaseStarted) {
          importPhaseStarted = true;
          await updateJob(job.id, { status: 'importing' });
        }
      },
      onProgress,
    });
  }

  const metadata = await buildCoverageWritebackMetadata(admin, job);
  await updateJob(job.id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    completion_note: completionNote,
    metadata,
  });
}

/** Terminal completion when nothing was purchased (coverage already owned, or a cap blocked the run). */
async function completeJobWithoutPurchase(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  note: string,
): Promise<void> {
  await admin
    .from('upload_batches')
    .update({ total_rows: 0, status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', job.upload_batch_id);
  const metadata = await buildCoverageWritebackMetadata(admin, job);
  await updateJob(job.id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
    completion_note: note,
    metadata,
  });
}

async function buildCoverageWritebackMetadata(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
): Promise<Record<string, unknown>> {
  // The receipt is an ICP coverage snapshot; without an ICP there is nothing
  // meaningful to snapshot (an unscoped query would just record zeros).
  if (!job.icp_id) return job.metadata ?? {};

  const [{ data: currentJob }, { data: companies }] = await Promise.all([
    admin
      .from('data_acquisition_jobs')
      .select('metadata, imported_company_count, imported_contact_count, skipped_existing_count, skipped_duplicate_count')
      .eq('id', job.id)
      .maybeSingle(),
    admin
      .from('user_companies')
      .select('company_id')
      .eq('user_id', job.user_id)
      .eq('matched_icp_id', job.icp_id),
  ]);

  const companyIds = ((companies ?? []) as Array<{ company_id?: unknown }>)
    .map((row) => row.company_id)
    .filter((value): value is string => typeof value === 'string');

  let contactCount = 0;
  if (companyIds.length > 0) {
    const { count } = await admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id)
      .in('company_id', companyIds);
    contactCount = count ?? 0;
  }

  const existingMetadata =
    currentJob?.metadata && typeof currentJob.metadata === 'object'
      ? (currentJob.metadata as Record<string, unknown>)
      : (job.metadata ?? {});
  const counters = (currentJob ?? {}) as {
    imported_company_count?: number | null;
    imported_contact_count?: number | null;
    skipped_existing_count?: number | null;
    skipped_duplicate_count?: number | null;
  };

  return {
    ...existingMetadata,
    coverage_writeback: {
      written_at: new Date().toISOString(),
      icp_id: job.icp_id,
      current_company_count: companyIds.length,
      current_contact_count: contactCount,
      imported_company_count: counters.imported_company_count ?? 0,
      imported_contact_count: counters.imported_contact_count ?? 0,
      skipped_count: (counters.skipped_existing_count ?? 0) + (counters.skipped_duplicate_count ?? 0),
    },
  };
}

function getCompanyContext(job: DataAcquisitionJob): CompanyContext | null {
  const company = job.metadata?.company;
  if (!company || typeof company !== 'object') return null;
  const record = company as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  return {
    id,
    company_name: typeof record.company_name === 'string' ? record.company_name : null,
    domain: typeof record.domain === 'string' ? record.domain : null,
    website: typeof record.website === 'string' ? record.website : null,
    linkedin_url: typeof record.linkedin_url === 'string' ? record.linkedin_url : null,
    matched_icp_id: typeof record.matched_icp_id === 'string' ? record.matched_icp_id : null,
  };
}

function discoveredCompanyFromContext(company: CompanyContext): DiscoveredCompany {
  const domain = normalizeKey(company.domain || company.website);
  const name = company.company_name || domain || 'Selected company';

  return {
    source: 'apollo',
    source_id: null,
    name,
    domain: domain || null,
    linkedin_url: company.linkedin_url || null,
    employee_count: null,
    raw: {
      name,
      primary_domain: domain || null,
      website_url: company.website || company.domain || null,
      linkedin_url: company.linkedin_url || null,
    },
  };
}

// ─── Screened-organizations cache ────────────────────────────────────────────

type ScreenCache = {
  /** 'qualified' | 'rejected:*' | null (never screened for this user+ICP). */
  lookup: (company: DiscoveredCompany) => string | null;
  store: (company: DiscoveredCompany, verdict: string) => Promise<void>;
};

const COMPANY_SCREEN_VERSION = 'icp_llm_screen_v3';

/**
 * Loads the (user, ICP) screening history so every Apollo org is screened at
 * most once per ICP across all jobs: previously rejected orgs are skipped for
 * free, previously qualified ones short-circuit to qualified.
 */
async function loadScreenCache(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  icpId: string,
): Promise<ScreenCache> {
  const byOrgId = new Map<string, string>();
  const byDomain = new Map<string, string>();

  const { data, error } = await admin
    .from('screened_organizations')
    .select('apollo_org_id, domain, verdict')
    .eq('user_id', userId)
    .eq('icp_id', icpId);
  if (error) {
    // Cache is an optimization: if the table is missing (migration not yet
    // applied) screening still works, it just re-screens.
    console.warn('[data-acquisition] screened_organizations unavailable:', error.message);
  }
  for (const row of (data ?? []) as Array<{ apollo_org_id: string | null; domain: string | null; verdict: string }>) {
    if (row.apollo_org_id) byOrgId.set(row.apollo_org_id, row.verdict);
    const domainKey = normalizeKey(row.domain);
    if (domainKey) byDomain.set(domainKey, row.verdict);
  }

  return {
    lookup(company) {
      if (company.source_id && byOrgId.has(company.source_id)) return byOrgId.get(company.source_id)!;
      const domainKey = normalizeKey(company.domain);
      if (domainKey && byDomain.has(domainKey)) return byDomain.get(domainKey)!;
      return null;
    },
    async store(company, verdict) {
      if (company.source_id) byOrgId.set(company.source_id, verdict);
      const domainKey = normalizeKey(company.domain);
      if (domainKey) byDomain.set(domainKey, verdict);
      const matchColumn = company.source_id ? 'apollo_org_id' : 'domain';
      const matchValue = company.source_id || domainKey;
      if (matchValue) {
        await admin.from('screened_organizations')
          .delete()
          .eq('user_id', userId)
          .eq('icp_id', icpId)
          .eq(matchColumn, matchValue);
      }
      const { error: insertError } = await admin.from('screened_organizations').insert({
        user_id: userId,
        icp_id: icpId,
        apollo_org_id: company.source_id,
        domain: domainKey || null,
        verdict,
      });
      // A concurrent job can still win the delete/insert race. The in-memory
      // maps stay authoritative for this run.
      if (insertError && insertError.code !== '23505') {
        console.warn('[data-acquisition] screened_organizations insert failed:', insertError.message);
      }
    },
  };
}

// ─── FIFO queue (one running job per user) ───────────────────────────────────

/**
 * Atomically claims a job for execution (queued/failed -> discovering).
 * Returns false when another process already claimed it: this is the
 * double-start guard between the end-of-job queue advancer and the poll-time
 * recovery kick in GET /api/data-acquisition/jobs.
 */
async function claimJobForRun(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('data_acquisition_jobs')
    .update({
      status: 'discovering',
      started_at: new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .in('status', ['queued', 'failed'])
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * Starts the user's oldest queued job if nothing is currently running.
 * Called when a job reaches a terminal state (and by the polling safety net
 * via runDataAcquisitionJob, whose atomic claim prevents double-starts).
 */
async function advanceQueueForUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { count } = await admin
    .from('data_acquisition_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', [...ACTIVE_JOB_STATUSES]);
  if ((count ?? 0) > 0) return;

  const { data: next } = await admin
    .from('data_acquisition_jobs')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'queued')
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextId = (next as { id?: string } | null)?.id;
  if (!nextId) return;

  await runDataAcquisitionJob(nextId);
}

/**
 * Serverless recovery for the narrow failure window where the import pipeline
 * completed its upload batch but the invocation ended before the acquisition
 * job and credit transaction were finalized. Safe to call repeatedly.
 */
export async function finalizeCompletedDataAcquisitionJob(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: jobData, error: jobError } = await admin
    .from('data_acquisition_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError || !jobData) return false;

  const job = jobData as DataAcquisitionJob;
  if (!ACTIVE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_JOB_STATUSES)[number])) {
    return false;
  }
  if (!job.upload_batch_id) return false;

  const { data: batch } = await admin
    .from('upload_batches')
    .select('status')
    .eq('id', job.upload_batch_id)
    .maybeSingle<{ status: string | null }>();
  if (batch?.status !== 'complete') return false;

  const metadata = await buildCoverageWritebackMetadata(admin, job);
  const completedAt = new Date().toISOString();
  const { data: finalized, error: finalizeError } = await admin
    .from('data_acquisition_jobs')
    .update({
      status: 'complete',
      completed_at: completedAt,
      metadata,
      updated_at: completedAt,
    })
    .eq('id', job.id)
    .in('status', [...ACTIVE_JOB_STATUSES])
    .select('imported_contact_count');
  if (finalizeError || (finalized ?? []).length === 0) return false;

  const delivered = Math.max(
    0,
    Number((finalized?.[0] as { imported_contact_count?: number | null })?.imported_contact_count ?? 0),
  );
  const transactionId = typeof job.metadata?.customer_credit_transaction_id === 'string'
    ? job.metadata.customer_credit_transaction_id
    : null;
  await settleCredits(transactionId, delivered * 4);

  const usageOperationId = typeof job.metadata?.customer_usage_operation_id === 'string'
    ? job.metadata.customer_usage_operation_id
    : null;
  if (job.org_id && usageOperationId) {
    await settleUsage({
      orgId: job.org_id,
      action: 'net_new_enriched_lead',
      operationKey: usageOperationId,
      quantity: delivered,
    });
  }

  await advanceQueueForUser(job.user_id);
  return true;
}

// ─── Job execution ────────────────────────────────────────────────────────────

export async function runDataAcquisitionJob(jobId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: jobData, error: jobError } = await admin
    .from('data_acquisition_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !jobData) {
    throw new Error(jobError?.message || `Data acquisition job ${jobId} not found`);
  }

  const job = jobData as DataAcquisitionJob;
  if (!job.upload_batch_id) {
    throw new Error(`Data acquisition job ${jobId} is missing upload_batch_id`);
  }

  const claimed = await claimJobForRun(admin, job.id);
  if (!claimed) return;

  try {
    await executeClaimedJob(admin, job);
    const transactionId = typeof job.metadata?.customer_credit_transaction_id === 'string'
      ? job.metadata.customer_credit_transaction_id
      : null;
    const { data: completed } = await admin.from('data_acquisition_jobs')
      .select('imported_contact_count')
      .eq('id', job.id)
      .maybeSingle<{ imported_contact_count: number | null }>();
    const delivered = Math.max(0, Number(completed?.imported_contact_count ?? 0));
    await settleCredits(transactionId, delivered * 4);
    const usageOperationId = typeof job.metadata?.customer_usage_operation_id === 'string'
      ? job.metadata.customer_usage_operation_id
      : null;
    if (job.org_id && usageOperationId) {
      await settleUsage({
        orgId: job.org_id,
        action: 'net_new_enriched_lead',
        operationKey: usageOperationId,
        quantity: delivered,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown data acquisition failure';
    await updateJob(job.id, { status: 'failed', error: message, completed_at: new Date().toISOString() });
    await admin
      .from('upload_batches')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', job.upload_batch_id);
    const transactionId = typeof job.metadata?.customer_credit_transaction_id === 'string'
      ? job.metadata.customer_credit_transaction_id
      : null;
    await refundCredits(transactionId).catch(() => {});
    const usageOperationId = typeof job.metadata?.customer_usage_operation_id === 'string'
      ? job.metadata.customer_usage_operation_id
      : null;
    if (job.org_id && usageOperationId) {
      await settleUsage({
        orgId: job.org_id,
        action: 'net_new_enriched_lead',
        operationKey: usageOperationId,
        quantity: 0,
      }).catch(() => {});
    }
    throw error;
  } finally {
    // Sequential per-user queue: whatever happened to this job, start the
    // oldest queued one next. Never let advancement errors mask job errors.
    try {
      await advanceQueueForUser(job.user_id);
    } catch (advanceError) {
      console.error('[data-acquisition] queue advancement failed', advanceError);
    }
  }
}

async function executeClaimedJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
): Promise<void> {
  // Service-role client bypasses RLS, so scope the ICP explicitly to what job.user_id may
  // see (company-wide + their own personal). Personas are fetched by the ICP itself
  // (org-scoped) since a company ICP's personas belong to its creator, not the buyer.
  const jobOrgId = await orgIdForUser(admin, job.user_id);
  const [{ data: icpData, error: icpError }, { data: personaData, error: personaError }] = await Promise.all([
    scopeIcpsToUser(
      admin
        .from('icps')
        .select(
          'id, name, company_type, platform_category, therapeutic_areas, modalities, development_stages, company_sizes, funding_stages, target_customers, buyer_types',
        ),
      jobOrgId,
      job.user_id,
    )
      .eq('id', job.icp_id)
      .maybeSingle(),
    (jobOrgId
      ? admin
          .from('personas')
          .select('id, name, functions, seniority_levels, job_titles')
          .eq('org_id', jobOrgId)
          .eq('icp_id', job.icp_id)
      : admin
          .from('personas')
          .select('id, name, functions, seniority_levels, job_titles')
          .eq('user_id', job.user_id)
          .eq('icp_id', job.icp_id)),
  ]);

  if (icpError || !icpData) throw new Error(icpError?.message || 'ICP not found');
  if (personaError) throw new Error(personaError.message);

  const icp = icpData as AcquisitionIcp;
  const personas = (personaData || []) as AcquisitionPersona[];

  const guard = await buildCreditGuard(admin, job);
  const meter = makeMeter(admin, job, guard);

  // A queued job may start after earlier jobs already exhausted the month.
  if (guard.capReached() === 'monthly') {
    const requested =
      job.request_type === 'expand_companies'
        ? Math.max(1, job.target_company_count || 50)
        : Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
    const unit = job.request_type === 'expand_companies' ? 'companies' : 'contacts';
    await completeJobWithoutPurchase(admin, job, shortfallNote('monthly', 0, requested, unit));
    return;
  }

  if (job.request_type === 'contacts_at_company') {
    await runContactsAtCompanyJob(admin, job, personas, guard, meter);
    return;
  }

  if (job.request_type === 'better_contacts' || job.request_type === 'more_contacts_at_accounts') {
    await runContactsAtAccountsJob(admin, job, personas, guard, meter);
    return;
  }

  if (job.request_type !== 'expand_companies') {
    throw new Error(`Unsupported data acquisition request type: ${job.request_type}`);
  }

  await runExpandCompaniesJob(admin, job, icp, personas, guard, meter);
}

// ─── contacts_at_company ─────────────────────────────────────────────────────

async function runContactsAtCompanyJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  personas: AcquisitionPersona[],
  guard: CreditGuard,
  meter: Meter,
): Promise<void> {
  const companyContext = getCompanyContext(job);
  if (!companyContext) {
    throw new Error('contacts_at_company job is missing company context');
  }

  const companyFit = await loadCompanyFitForPurchase(admin, job.user_id, companyContext.id, job.icp_id);
  if (companyFit == null || companyFit < SOURCE_COMPANY_MIN) {
    await completeJobWithoutPurchase(
      admin,
      job,
      lowCompanyFitPurchaseNote(companyContext.company_name, companyFit),
    );
    return;
  }

  // `target_contact_count` is NET-NEW for this path: the agent asks "how many
  // MORE contacts to add" and the confirm dialog shows the number as net-new
  // leads, so source exactly this many NEW people. Owned contacts are loaded
  // only to exclude them from the Apollo search below — never subtracted from
  // the target. (Subtracting silently under-sourced once an account already had
  // contacts: "1 more" at a company with 1 owned produced gap=0 and delivered
  // nothing.) An exhausted company that returns no new people is handled
  // gracefully downstream (empty result -> full refund).
  const requested = Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
  const company = discoveredCompanyFromContext(companyContext);

  const owned = await loadOwnedContactsForCompanies(
    admin,
    job.user_id,
    [companyContext.id],
    company.domain ? [company.domain] : [],
  );
  const ownedHere = ownedContactsAt(owned, companyContext.id, company.domain);
  const gap = requested;

  const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
  const target: PeopleSearchTarget = {
    company,
    contactsTarget: gap,
    ...exclusionListsFor(ownedHere),
  };

  const { people, stoppedByGuard } = await discoverApolloPeopleForCompanies({
    targets: [target],
    recipe: peopleRecipe,
    shouldContinue: async () => guard.capReached() === null,
    onSearchResult: async (newCount, excludedCount, c) => {
      await meter('apollo_people_search_result', newCount, {
        company: c.name,
        domain: c.domain,
        companyId: companyContext.id,
      });
      await meter('duplicate_contact_skipped', excludedCount, {
        company: c.name,
        domain: c.domain,
        companyId: companyContext.id,
        reason: 'already_owned_excluded',
      });
    },
  });

  const uniquePeople = await dedupAgainstWholeBook(admin, job, people, gap, meter, {
    companyId: companyContext.id,
  });
  const personaScreen = await screenPeopleAgainstPersonas({
    people: uniquePeople,
    personas,
    job,
    meter,
    metadata: { companyId: companyContext.id },
  });

  const capKind = stoppedByGuard ? guard.capReached() : null;
  const note =
    capKind
      ? shortfallNote(capKind, personaScreen.people.length, gap, 'contacts')
      : personaScreenNote(uniquePeople.length, personaScreen.people.length, personaScreen.rejected);

  await updateJob(job.id, { status: 'processing' });
  await ingestPeopleAndRunImportPipeline(admin, job, personaScreen.people, { companyId: companyContext.id }, meter, note);
}

// ─── more_contacts_at_accounts (and legacy better_contacts rows) ─────────────

async function runContactsAtAccountsJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  personas: AcquisitionPersona[],
  guard: CreditGuard,
  meter: Meter,
): Promise<void> {
  const requestType = job.request_type as 'better_contacts' | 'more_contacts_at_accounts';
  const requestedTotal = Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
  const maxAccounts = Math.min(100, Math.max(1, Math.ceil(requestedTotal / DEFAULT_CONTACTS_PER_COMPANY)));
  const perCompany = Math.max(1, Math.ceil(requestedTotal / maxAccounts));

  const prioritizedRows = await loadPrioritizedCompaniesForIcpAccounts(
    admin,
    job.user_id,
    job.icp_id,
    requestType,
    500,
  );

  if (prioritizedRows.length === 0) {
    await completeJobWithoutPurchase(
      admin,
      job,
      `We did not source contacts because this ICP has no accounts at or above the ${Math.round(SOURCE_COMPANY_MIN * 100)}% company-fit purchase threshold.`,
    );
    return;
  }

  const owned = await loadOwnedContactsForCompanies(
    admin,
    job.user_id,
    prioritizedRows.map((r) => r.id),
    prioritizedRows.map((r) => r.domain || r.website || '').filter(Boolean),
  );

  // Pre-flight gap check per account: skip fully-covered accounts before any
  // Apollo call; fetch only the gap at the rest.
  const targets: PeopleSearchTarget[] = [];
  let candidatesExamined = 0;
  for (const row of prioritizedRows) {
    if (targets.length >= maxAccounts) break;
    if (candidatesExamined >= maxAccounts * 5) break;
    const discovered = discoveredCompanyFromDbRow(row);
    if (!discovered) continue;
    candidatesExamined += 1;

    const ownedHere = ownedContactsAt(owned, row.id, discovered.domain);
    const gap = perCompany - ownedHere.length;
    if (gap <= 0) {
      await meter('skipped_existing', 1, {
        company: discovered.name,
        domain: discovered.domain,
        companyId: row.id,
        existingContacts: ownedHere.length,
        requestedContacts: perCompany,
        requestType,
      });
      continue;
    }

    targets.push({
      company: discovered,
      contactsTarget: gap,
      ...exclusionListsFor(ownedHere),
    });
  }

  if (targets.length === 0) {
    await completeJobWithoutPurchase(
      admin,
      job,
      'Your accounts in this ICP already have the requested contact coverage, so nothing new was sourced.',
    );
    return;
  }

  const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
  const { people, stoppedByGuard } = await discoverApolloPeopleForCompanies({
    targets,
    recipe: peopleRecipe,
    shouldContinue: async () => guard.capReached() === null,
    onSearchResult: async (newCount, excludedCount, c) => {
      await meter('apollo_people_search_result', newCount, {
        company: c.name,
        domain: c.domain,
        requestType,
      });
      await meter('duplicate_contact_skipped', excludedCount, {
        company: c.name,
        domain: c.domain,
        requestType,
        reason: 'already_owned_excluded',
      });
    },
  });

  const uniquePeople = await dedupAgainstWholeBook(admin, job, people, requestedTotal, meter, { requestType });
  const personaScreen = await screenPeopleAgainstPersonas({
    people: uniquePeople,
    personas,
    job,
    meter,
    metadata: { requestType },
  });

  const capKind = stoppedByGuard ? guard.capReached() : null;
  const note =
    capKind
      ? shortfallNote(capKind, personaScreen.people.length, requestedTotal, 'contacts')
      : personaScreenNote(uniquePeople.length, personaScreen.people.length, personaScreen.rejected);

  await updateJob(job.id, { status: 'processing' });
  await ingestPeopleAndRunImportPipeline(admin, job, personaScreen.people, { requestType }, meter, note);
}

// ─── expand_companies ────────────────────────────────────────────────────────

async function runExpandCompaniesJob(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  icp: AcquisitionIcp,
  personas: AcquisitionPersona[],
  guard: CreditGuard,
  meter: Meter,
): Promise<void> {
  const companyRecipes = buildApolloCompanySearchRecipes(icp, job.request_type);
  const targetCompanyCount = Math.max(1, job.target_company_count || 50);
  const maxScreenedCompanies = Math.max(
    targetCompanyCount,
    job.max_screened_companies || targetCompanyCount * 6,
  );
  // Company search is cheap; matching-person discovery is the scarce step.
  // Keep a small bench of qualified companies so a valid but contact-poor
  // account does not turn the entire purchase into an empty/refunded result.
  const discoveryCompanyTarget = Math.min(
    maxScreenedCompanies,
    Math.max(targetCompanyCount, targetCompanyCount * 3),
  );

  // Owned-company keys, loaded once. 10k+ entries are fine in memory; checking
  // this set is the FIRST step for every Apollo result so duplicates cost
  // nothing (no keyword screen, no metered screening event).
  const { data: existingOwned } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', job.user_id);
  const existingOwnedIds = (existingOwned ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string');
  const { data: existingCompanies } = existingOwnedIds.length > 0
    ? await admin
        .from('companies')
        .select('company_name, domain, website, linkedin_url')
        .in('id', existingOwnedIds)
    : { data: [] as ExistingCompany[] };
  const existingCompanyKeySet = new Set(
    ((existingCompanies || []) as ExistingCompany[]).flatMap(existingCompanyKeys),
  );

  const screenCache = await loadScreenCache(admin, job.user_id, job.icp_id);
  let screenedCount = 0;
  const acceptedCompanyKeys = new Set<string>();

  const evaluateCompany = async (
    company: DiscoveredCompany,
    recipe: { name: string },
    provider: 'apollo' | 'web_search',
  ) => {
    const keys = companyKeys(company);
    if (keys.some((key) => existingCompanyKeySet.has(key) || acceptedCompanyKeys.has(key))) {
      await meter('skipped_existing', 1, {
        company: company.name,
        domain: company.domain,
        reason: 'already_owned_or_selected',
        provider,
      });
      return 'skip' as const;
    }

    const cachedVerdict = screenCache.lookup(company);
    if (cachedVerdict === `qualified:${COMPANY_SCREEN_VERSION}`) {
      keys.forEach((key) => acceptedCompanyKeys.add(key));
      await meter('qualified_company', 1, {
        company: company.name,
        domain: company.domain,
        cached: true,
        provider,
      });
      return 'qualified' as const;
    }
    if (cachedVerdict?.startsWith(`rejected:${COMPANY_SCREEN_VERSION}:`)) {
      return 'skip' as const;
    }

    if (provider === 'apollo' && screenedCount >= maxScreenedCompanies) return 'skip' as const;
    screenedCount += 1;

    if (provider === 'apollo') {
      await meter('apollo_company_search_result', 1, {
        company: company.name,
        domain: company.domain,
        recipe: recipe.name,
        provider,
      });
    } else {
      await meter('llm_fit_screen', 1, {
        company: company.name,
        domain: company.domain,
        recipe: recipe.name,
        provider,
        reason: 'web_discovery_fallback',
      }, 'anthropic_search');
    }

    let evidence = company.raw;
    if (provider === 'apollo' && company.domain) {
      try {
        const enriched = await enrichOrganizationWithApollo({
          company_domain: company.domain,
          company_name: company.name,
          company_linkedin_url: company.linkedin_url,
        });
        await meter('apollo_company_enrichment', 1, {
          company: company.name,
          domain: company.domain,
          reason: 'icp_screen_evidence',
        });
        evidence = {
          ...evidence,
          ...(enriched.raw_company || {}),
          name: enriched.company_name || evidence.name,
          short_description: enriched.company_description || evidence.short_description,
          industry: enriched.company_industry || evidence.industry,
        };
      } catch (error) {
        console.warn(
          '[data-acquisition] Apollo company screen enrichment failed:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    const screen = await screenCompanyAgainstIcp({
      evidence,
      company,
      icp,
      job,
      meter,
      metadata: {
        recipe: recipe.name,
        provider,
      },
    });

    await screenCache.store(
      company,
      screen.passes
        ? `qualified:${COMPANY_SCREEN_VERSION}`
        : `rejected:${COMPANY_SCREEN_VERSION}:${screen.reason}`,
    );
    if (!screen.passes) {
      await meter('low_fit_company_rejected', 1, {
        company: company.name,
        domain: company.domain,
        provider,
        recipe: recipe.name,
        verdict: screen.verdict,
        score: screen.score,
        confidence: screen.confidence,
        reason: screen.reason,
      }, 'arcova');
      return 'skip' as const;
    }

    keys.forEach((key) => acceptedCompanyKeys.add(key));
    await meter('qualified_company', 1, {
      company: company.name,
      domain: company.domain,
      provider,
      score: screen.score,
      confidence: screen.confidence,
      reason: screen.reason,
    });
    return 'qualified' as const;
  };

  const discovery = await discoverApolloCompanies({
    recipes: companyRecipes,
    targetCompanyCount: discoveryCompanyTarget,
    maxPagesPerRecipe: 20,
    shouldContinue: async () => guard.capReached() === null && screenedCount < maxScreenedCompanies,
    // Evaluation order per org: (1) owned/selected dedup, free; (2) versioned
    // screen cache, free; (3) metered evidence screen with Apollo enrichment
    // when the search row is too sparse to make a defensible decision.
    evaluate: async (company, recipe) => evaluateCompany(company, recipe, 'apollo'),
  });

  const qualifiedCompanies = [...discovery.companies];
  if (
    qualifiedCompanies.length < discoveryCompanyTarget &&
    guard.capReached() === null &&
    process.env.ANTHROPIC_API_KEY
  ) {
    const fallbackTarget = discoveryCompanyTarget - qualifiedCompanies.length;
    try {
      const fallbackCompanies = await discoverCompaniesWithWebSearch({
        icp,
        targetCompanyCount: fallbackTarget,
      });
      for (const company of fallbackCompanies) {
        if (qualifiedCompanies.length >= discoveryCompanyTarget) break;
        if (guard.capReached() !== null) break;
        const verdict = await evaluateCompany(company, { name: 'web_search_fallback' }, 'web_search');
        if (verdict === 'qualified') qualifiedCompanies.push(company);
      }
      if (fallbackCompanies.length > 0) {
        await updateJob(job.id, {
          source_strategy: 'apollo_then_web_search',
          metadata: {
            ...(job.metadata ?? {}),
            secondary_source: {
              provider: 'anthropic_web_search',
              attempted_at: new Date().toISOString(),
              candidate_count: fallbackCompanies.length,
              accepted_count: qualifiedCompanies.filter((company) => company.source === 'web_search').length,
            },
          },
        });
      }
    } catch (error) {
      console.warn('[data-acquisition] web discovery fallback failed:', error);
    }
  }
  const companyPhaseCapKind = discovery.stoppedByGuard ? guard.capReached() : null;

  if (qualifiedCompanies.length === 0) {
    if (companyPhaseCapKind) {
      await completeJobWithoutPurchase(
        admin,
        job,
        shortfallNote(companyPhaseCapKind, 0, targetCompanyCount, 'companies'),
      );
      return;
    }
    throw new Error(
      'No new companies passed deduplication and ICP evidence screening. Widen the ICP or try again later.',
    );
  }

  await updateJob(job.id, { status: 'processing' });

  const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
  const targetContactCount =
    job.target_contact_count || qualifiedCompanies.length * DEFAULT_CONTACTS_PER_COMPANY;
  const contactsPerCompany = Math.max(
    1,
    Math.ceil(targetContactCount / targetCompanyCount),
  );

  // These companies are new by construction (owned dupes were skipped above),
  // so there is no pre-flight gap or exclusion list to build for them.
  const { people, stoppedByGuard: peoplePhaseCapped } = await discoverApolloPeopleForCompanies({
    targets: qualifiedCompanies.map((company) => ({ company, contactsTarget: contactsPerCompany })),
    recipe: peopleRecipe,
    shouldContinue: async () => guard.capReached() === null,
    onSearchResult: async (newCount, excludedCount, c) => {
      await meter('apollo_people_search_result', newCount, { company: c.name, domain: c.domain });
      await meter('duplicate_contact_skipped', excludedCount, {
        company: c.name,
        domain: c.domain,
        reason: 'already_owned_excluded',
      });
    },
  });

  const uniquePeople = await dedupAgainstWholeBook(admin, job, people, targetContactCount, meter, {});
  const personaScreen = await screenPeopleAgainstPersonas({
    people: uniquePeople,
    personas,
    job,
    meter,
    metadata: {},
  });

  let note: string | null = null;
  if (companyPhaseCapKind && qualifiedCompanies.length < targetCompanyCount) {
    note = shortfallNote(companyPhaseCapKind, qualifiedCompanies.length, targetCompanyCount, 'companies');
  } else if (peoplePhaseCapped && guard.capReached()) {
    note = shortfallNote(guard.capReached()!, personaScreen.people.length, targetContactCount, 'contacts');
  } else {
    note = personaScreenNote(uniquePeople.length, personaScreen.people.length, personaScreen.rejected);
  }

  await ingestPeopleAndRunImportPipeline(admin, job, personaScreen.people, {}, meter, note);
}

// ─── Whole-book post-fetch dedup (second line of defense) ────────────────────

/**
 * The per-company exclusion lists should prevent owned contacts from coming
 * back at all, but this whole-book key check stays in place as the safety net
 * (name+company matches, truncated exclusion lists, contacts without a stored
 * email/linkedin, etc.).
 */
async function dedupAgainstWholeBook(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  people: DiscoveredPerson[],
  limit: number,
  meter: Meter,
  metadata: Record<string, unknown>,
): Promise<DiscoveredPerson[]> {
  const { data: existingContacts } = await admin
    .from('contacts')
    .select('full_name, first_name, last_name, email, linkedin_url, company_name, company_domain, apollo_person_raw')
    .eq('user_id', job.user_id);
  const existingContactKeySet = new Set(
    ((existingContacts || []) as ExistingContact[]).flatMap(existingContactKeys),
  );

  const uniquePeople: DiscoveredPerson[] = [];
  const seenContactKeys = new Set<string>();
  for (const person of people) {
    const key = contactKey(person);
    if (existingContactKeySet.has(key) || seenContactKeys.has(key)) {
      await meter('duplicate_contact_skipped', 1, {
        person: person.full_name,
        company: person.company_name,
        ...metadata,
      });
      continue;
    }
    seenContactKeys.add(key);
    uniquePeople.push(person);
    if (uniquePeople.length >= limit) break;
  }
  return uniquePeople;
}
