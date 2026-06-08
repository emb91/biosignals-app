/**
 * Company-only enrichment pipeline.
 *
 * Unlike `runContactResolutionPipelineForContact` (which enriches a contact AND
 * their current company as a side-effect), this path enriches a `companies` row
 * directly, without depending on a linked contact's profile resolution
 * succeeding.
 *
 * Why we need this: companies created from `job_change_monitor` (or any other
 * contact-driven import) start as bare stubs ({ company_name, source }).
 * Today, firmographics only land if the contact's Apify profile enrichment
 * succeeds (gated at lib/enrichment-pipeline.ts:1169 on
 * `resolved.currentCompanyLinkedinUrl`). When the contact's LinkedIn
 * resolution is blocked, the company is orphaned forever and the
 * "Enrichment in progress" banner sticks.
 *
 * This path:
 *   1. Marks the row `enrichment_refresh_status='running'`
 *   2. Apollo organization enrich (domain | name) → firmographics + LinkedIn URL
 *   3. Apify LinkedIn company scrape (when a URL is resolved)
 *   4. Merge + persist canonical fields on `companies`, set `last_enriched_at`
 *   5. Optionally run the company monitor (funding / taxonomy / narrative);
 *      monitor failures (e.g. Anthropic credit-balance) are non-fatal and
 *      don't flip the row to `failed` — firmographic enrichment is the
 *      authoritative success signal here.
 *   6. Flip to `succeeded` (or `failed` with the error string)
 *
 * Used by:
 *   - POST /api/companies/[id]/enrich (Refresh button on Accounts side panel)
 *   - lib/signals/run-job-change-monitor (auto-enrich newly created stubs)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  scrapeLinkedInCompany,
  extractApifyFirmographics,
  normalizeLinkedInCompanyUrl,
  type ApifyFirmographics,
} from '@/lib/my-company-enrichment';
import { runCompanyMonitor } from '@/lib/company-monitor';
import { employeeCountToSizeBucket } from '@/lib/arcova-taxonomy';
import {
  resolveCompanyIdentity,
  type CompanyIdentityContext,
} from '@/lib/company-identity-resolver';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

/**
 * Condense the raw LinkedIn "About" text into a clean 1–2 sentence summary
 * for the side-panel "Profile summary". Without this, the panel shows the full
 * raw dump (including LinkedIn boilerplate like adverse-event / recruitment-scam
 * notices). Uses completeLlm — Anthropic-direct preferred, OpenRouter fallback —
 * so it works even when Anthropic credits are dry. Non-fatal: returns null on
 * any failure (the panel falls back to the raw description).
 */
async function summariseCompanyBio(description: string): Promise<string | null> {
  if (!description.trim()) return null;
  try {
    const result = await completeLlm({
      feature: 'company_bio_summarization',
      maxTokens: 160,
      prompt:
        'Summarise what this company does in 1–2 plain sentences (max ~40 words) for a B2B ' +
        'sales context. Be factual and specific — name the category, products, or focus. ' +
        'Ignore any boilerplate (adverse-event reporting, recruitment-scam warnings, social ' +
        'links). No preamble.\n\n' +
        description,
    });
    await recordLlmUsageEvent({
      provider: result.provider,
      feature: 'company_bio_summarization',
      route: 'lib/company-enrichment#summariseCompanyBio',
      model: result.model,
      usage: result.usage,
    }).catch(() => undefined);
    const sentence = result.text.trim().replace(/^[-•*\d.)]\s*/, '');
    return sentence || null;
  } catch (err) {
    console.warn(
      '[company-enrichment] bio summarisation failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export type CompanyEnrichmentResult = {
  company_id: string;
  status: 'succeeded' | 'failed';
  error: string | null;
  fields_updated: string[];
};

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function pickString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function pickNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function pickStringArray(...values: Array<string[] | null | undefined>): string[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

type CompanyRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  website: string | null;
  description: string | null;
  bio_summary: string | null;
  tagline: string | null;
  logo_url: string | null;
  follower_count: number | null;
  industry: string | null;
  employee_count: number | null;
  employee_range: string | null;
  founded_year: number | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  headquarters_country: string | null;
  specialties: string[] | null;
};

const COMPANY_SELECT_COLUMNS = [
  'id',
  'company_name',
  'domain',
  'linkedin_url',
  'website',
  'description',
  'bio_summary',
  'tagline',
  'logo_url',
  'follower_count',
  'industry',
  'employee_count',
  'employee_range',
  'founded_year',
  'headquarters_city',
  'headquarters_state',
  'headquarters_country',
  'specialties',
].join(', ');

/**
 * Set the enrichment_refresh_status to `running` and stamp the started_at
 * timestamp. Used at the start of an enrichment run; callers that fire the
 * job asynchronously should call this first (synchronously) so the UI flips
 * to "in progress" immediately rather than waiting on the async work.
 */
export async function markCompanyEnrichmentRunning(
  supabase: SupabaseClient,
  companyId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('companies')
    .update({
      enrichment_refresh_status: 'running',
      enrichment_refresh_started_at: now,
      enrichment_refresh_last_error: null,
      updated_at: now,
    })
    .eq('id', companyId);
}

export async function runCompanyEnrichmentById(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyEnrichmentResult> {
  // 1. Load the company row.
  const { data: companyData, error: loadError } = await supabase
    .from('companies')
    .select(COMPANY_SELECT_COLUMNS)
    .eq('id', companyId)
    .maybeSingle();

  if (loadError || !companyData) {
    const message = loadError?.message || 'Company not found';
    await failCompanyEnrichment(supabase, companyId, message);
    return { company_id: companyId, status: 'failed', error: message, fields_updated: [] };
  }
  const company = companyData as unknown as CompanyRow;

  // Ensure the row is marked running (idempotent — markCompanyEnrichmentRunning
  // may have already done this synchronously before fire-and-forget).
  await markCompanyEnrichmentRunning(supabase, companyId);

  try {
    // 2. Resolve the company's true identity BEFORE writing anything.
    // Apollo's domain-enrich is a fuzzy match — asking for `moderna.com`
    // returns "Moderna Housewares" (modernahousewares.com), a different
    // company with a different domain. The resolver (mirrors the SEC CIK
    // tiered pattern) validates the domain match, falls back to a name
    // search + Haiku disambiguation, and returns an authoritative
    // domain/LinkedIn or an honest "couldn't resolve" reason.
    const contactContext = await loadContactContext(supabase, companyId);
    const identity = await resolveCompanyIdentity({
      companyName: company.company_name,
      domain: company.domain,
      context: contactContext,
    });

    if (!identity.resolved) {
      const reason = identity.reason || 'Could not identify this company.';
      await failCompanyEnrichment(supabase, companyId, reason);
      return { company_id: companyId, status: 'failed', error: reason, fields_updated: [] };
    }

    const apollo = identity.apollo;

    // 3. The resolver gives us an AUTHORITATIVE LinkedIn URL (it validated the
    // identity), so prefer it over whatever stale value was on the row.
    const linkedinUrl =
      normalizeLinkedInCompanyUrl(identity.linkedinUrl) ??
      normalizeLinkedInCompanyUrl(company.linkedin_url);

    // 4. Apify LinkedIn scrape (sequential — needs the URL).
    let apifyRaw: Record<string, unknown> | null = null;
    let apifyFirmographics: ApifyFirmographics = extractApifyFirmographics(null);
    if (linkedinUrl) {
      apifyRaw = await scrapeLinkedInCompany(linkedinUrl).catch((err: unknown) => {
        console.warn(
          `[company-enrichment] Apify failed for ${companyId} (${company.company_name}):`,
          err instanceof Error ? err.message : err,
        );
        return null;
      });
      apifyFirmographics = extractApifyFirmographics(apifyRaw);
    }

    // 5. Merge canonical firmographics.
    // DOMAIN + LINKEDIN are AUTHORITATIVE from the resolver — it validated the
    // identity (domain-match or name+LLM disambiguation), so it's allowed to
    // CORRECT a wrong stub domain (e.g. moderna.com → modernatx.com). That's
    // the whole point: the stub guessed wrong and we now know better.
    //   company_name stays STICKY (existing wins) — the resolver confirmed it's
    // the same company, and the user may have curated the display name.
    //   Firmographics (employees, industry, HQ, …) take fresh values.
    const resolvedDomain =
      identity.domain ??
      normalizeDomain(company.domain) ??
      normalizeDomain(typeof apollo.company_domain === 'string' ? apollo.company_domain : null);
    const employeeCount = pickNumber(
      typeof apollo.company_employee_count === 'number' ? apollo.company_employee_count : null,
      apifyFirmographics.employee_count,
      company.employee_count,
    );
    const employeeRange = pickString(apifyFirmographics.employee_range, company.employee_range);

    // Clean profile summary from the raw LinkedIn About (OpenRouter-capable,
    // so it works even with no Anthropic credits). Falls back to the existing
    // bio_summary if we couldn't generate a fresh one.
    const rawDescription = pickString(apifyFirmographics.description, company.description);
    const bioSummary =
      (rawDescription ? await summariseCompanyBio(rawDescription) : null) ?? company.bio_summary;

    const payload: Record<string, unknown> = {
      domain: resolvedDomain,
      bio_summary: bioSummary,
      company_name: pickString(
        company.company_name,
        typeof apollo.company_name === 'string' ? apollo.company_name : null,
      ),
      linkedin_url: pickString(
        linkedinUrl,
        apifyFirmographics.linkedin_url,
        company.linkedin_url,
      ),
      description: pickString(apifyFirmographics.description, company.description),
      tagline: pickString(apifyFirmographics.tagline, company.tagline),
      logo_url: pickString(apifyFirmographics.logo_url, company.logo_url),
      follower_count: pickNumber(apifyFirmographics.follower_count, company.follower_count),
      industry: pickString(
        typeof apollo.company_industry === 'string' ? apollo.company_industry : null,
        apifyFirmographics.industry,
        company.industry,
      ),
      employee_count: employeeCount,
      employee_range: employeeRange,
      company_size_bucket: employeeCountToSizeBucket(employeeCount ?? null, employeeRange ?? null)[0] ?? null,
      founded_year: pickNumber(
        typeof apollo.company_founded_year === 'number' ? apollo.company_founded_year : null,
        apifyFirmographics.founded_year,
        company.founded_year,
      ),
      headquarters_city: pickString(
        typeof apollo.company_hq_city === 'string' ? apollo.company_hq_city : null,
        apifyFirmographics.hq_city,
        company.headquarters_city,
      ),
      headquarters_state: pickString(
        typeof apollo.company_hq_state === 'string' ? apollo.company_hq_state : null,
        apifyFirmographics.hq_state,
        company.headquarters_state,
      ),
      headquarters_country: pickString(
        typeof apollo.company_hq_country === 'string' ? apollo.company_hq_country : null,
        apifyFirmographics.hq_country,
        company.headquarters_country,
      ),
      specialties: pickStringArray(apifyFirmographics.specialties, company.specialties),
      // NOTE: raw Apollo/Apify blobs are NOT persisted on `companies` —
      // those columns live on `contacts` and are owned by the contact
      // resolution pipeline. Company-only enrichment writes only the
      // canonical extracted fields above. If we ever need the raw blobs
      // server-side from a company context, add JSONB columns to
      // companies in a follow-up migration.
      last_enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Drop keys whose value is null AND was already null on the row — keeps the
    // UPDATE small and avoids accidentally clobbering values we couldn't fetch
    // this run.
    const fieldsUpdated: string[] = [];
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined) {
        fieldsUpdated.push(key);
      }
    }

    const { error: updateError } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', companyId);

    if (updateError) {
      throw new Error(`Failed to persist enrichment payload: ${updateError.message}`);
    }

    // 6. Best-effort company monitor — funding / taxonomy / narrative.
    // Anthropic-direct LLM call sites; failures here (e.g. credit-balance)
    // are non-fatal because the canonical firmographic enrichment above
    // already succeeded. The monitor surfaces its own errors on the
    // funding_resolution_last_error column.
    try {
      const apolloFirmographics = (apollo as unknown as Record<string, unknown>) ?? null;
      await runCompanyMonitor(supabase as unknown as Parameters<typeof runCompanyMonitor>[0], {
        company_id: companyId,
        company_name: payload.company_name as string,
        domain: payload.domain as string | null,
        apollo_funding_stage:
          (typeof apollo.company_funding_stage === 'string' ? apollo.company_funding_stage : null) ?? null,
        apollo_total_funding_usd:
          (typeof apollo.company_total_funding_usd === 'number' ? apollo.company_total_funding_usd : null) ?? null,
        apollo_latest_funding_date:
          (typeof apollo.company_latest_funding_date === 'string' ? apollo.company_latest_funding_date : null) ?? null,
        apify_company_firmographics: apifyRaw,
        apollo_company_firmographics: apolloFirmographics,
        apollo_organization_raw:
          (apollo.raw_company as Record<string, unknown> | null) ?? null,
      });
    } catch (monitorErr) {
      console.warn(
        `[company-enrichment] runCompanyMonitor failed (non-fatal) for ${companyId}:`,
        monitorErr instanceof Error ? monitorErr.message : monitorErr,
      );
    }

    // 7. Honor a user cancellation. The DELETE /enrich endpoint flips the row
    // to `cancelled` while we were working (we can't truly abort an in-flight
    // scrape, but we can decline to overwrite the user's stop). The firmographics
    // we already wrote stay — they're valid — but we leave the status as
    // `cancelled` rather than flipping it to `succeeded`.
    const { data: cancelCheck } = await supabase
      .from('companies')
      .select('enrichment_refresh_status')
      .eq('id', companyId)
      .maybeSingle();
    if ((cancelCheck as { enrichment_refresh_status?: string | null } | null)?.enrichment_refresh_status === 'cancelled') {
      return {
        company_id: companyId,
        status: 'failed', // not 'succeeded' — the run was cancelled
        error: 'Enrichment was cancelled.',
        fields_updated: fieldsUpdated,
      };
    }

    // Mark succeeded. We only reach here when the identity resolver confirmed
    // the company (step 2 returns early on an unresolved match), so we always
    // have authoritative Apollo firmographics by this point — Apify is a bonus
    // layer on top.
    const finishedAt = new Date().toISOString();
    await supabase
      .from('companies')
      .update({
        enrichment_refresh_status: 'succeeded',
        enrichment_refresh_finished_at: finishedAt,
        enrichment_refresh_last_error: null,
        updated_at: finishedAt,
      })
      .eq('id', companyId);

    return {
      company_id: companyId,
      status: 'succeeded',
      error: null,
      fields_updated: fieldsUpdated,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failCompanyEnrichment(supabase, companyId, message);
    return { company_id: companyId, status: 'failed', error: message, fields_updated: [] };
  }
}

/**
 * Pull one linked contact's name/title/headline to give the identity resolver
 * disambiguation context (e.g. "Chong Ma, VP Research works here" helps pick
 * biotech Moderna over Moderna Housewares). Best-effort — returns null if no
 * contact or the query fails.
 */
async function loadContactContext(
  supabase: SupabaseClient,
  companyId: string,
): Promise<CompanyIdentityContext | null> {
  try {
    const { data } = await supabase
      .from('contacts')
      .select('full_name, job_title, headline')
      .eq('company_id', companyId)
      .not('full_name', 'is', null)
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { full_name?: string | null; job_title?: string | null; headline?: string | null };
    if (!row.full_name && !row.job_title && !row.headline) return null;
    return {
      contactName: row.full_name ?? null,
      contactTitle: row.job_title ?? null,
      contactHeadline: row.headline ?? null,
    };
  } catch {
    return null;
  }
}

async function failCompanyEnrichment(
  supabase: SupabaseClient,
  companyId: string,
  message: string,
): Promise<void> {
  const finishedAt = new Date().toISOString();
  await supabase
    .from('companies')
    .update({
      enrichment_refresh_status: 'failed',
      enrichment_refresh_finished_at: finishedAt,
      enrichment_refresh_last_error: message.slice(0, 2000),
      updated_at: finishedAt,
    })
    .eq('id', companyId);
}
