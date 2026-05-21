/**
 * run-job-change-monitor
 *
 * Lightweight contact job-change monitor.  Periodically re-scrapes LinkedIn
 * profiles via the HarvestAPI Apify actor and emits contact-scoped signals
 * when the person's role or company has changed since the last check.
 *
 * Deliberately avoids Apollo enrichment, LLM bio generation, and phone
 * enrichment — those are handled by the full runContactResolutionPipeline.
 * This monitor only cares about: "did the job change?"
 *
 * Signal types emitted (scope: 'contact'):
 *   recently_changed_company  — moved to a different employer
 *   recently_promoted         — seniority rank increased
 *   new_internal_role         — same employer, different role family
 *   title_change              — same employer, different title
 *   new_to_role               — first-time check; relevant stakeholder detected
 *
 * Cron cadence: daily (see /api/cron/contact-job-change).
 */

import { createAdminClient } from '@/lib/supabase-admin';
import { emitExternalContactSignalsFromEnrichment } from '@/lib/signals/readiness-external-contacts';
import { recomputeContactReadiness } from '@/lib/signals/readiness-service';
import { fetchWithRetry } from '@/lib/signals/fetch-with-retry';
import { persistRunHistory } from '@/lib/signals/run-history';

// ── Constants ──────────────────────────────────────────────────────────────

const HARVESTAPI_ACTOR = 'harvestapi~linkedin-profile-scraper';
const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;

// ── Types ──────────────────────────────────────────────────────────────────

type ContactRecord = {
  id: string;
  user_id: string;
  company_id: string | null;
  full_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
  resolved_current_job_title: string | null;
  seniority_level: string | null;
  business_area: string | null;
  profile_enrichment_status: string | null;
};

export type JobChangeMonitorResult = {
  processed: number;
  no_linkedin: number;
  no_change: number;
  signals_emitted: number;
  failed: number;
  emitted_signal_types: string[];
  recomputed_contacts: string[];
  failures: { contact_id: string; error: string }[];
};

// ── Apify scraper ──────────────────────────────────────────────────────────

async function scrapeLinkedInProfile(
  linkedinUrl: string
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetchWithRetry(
      `https://api.apify.com/v2/acts/${HARVESTAPI_ACTOR}/run-sync-get-dataset-items`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          queries: [linkedinUrl],
          profileScraperMode: 'Profile details no email ($4 per 1k)',
        }),
        timeoutMs: 90_000,
        maxRetries: 1,
        label: 'job-change-monitor/linkedin-profile',
      }
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    const payload = (await response.json()) as unknown;
    const item = Array.isArray(payload) ? payload[0] : payload;
    return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Profile parsing ────────────────────────────────────────────────────────

type CurrentEmployment = {
  companyName: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
};

/** Infer a rough seniority bucket from title text alone (no LLM). */
function inferSeniorityLevel(title: string | null): string | null {
  if (!title) return null;
  const t = title.toLowerCase();
  if (/\b(ceo|cfo|coo|cto|cmo|chief|president)\b/.test(t)) return 'c_suite';
  if (/\b(svp|vice president|vp)\b/.test(t)) return 'vp';
  if (/\b(director|head of|head,)\b/.test(t)) return 'director';
  if (/\b(senior manager|manager|lead)\b/.test(t)) return 'manager';
  if (/\b(senior|principal|sr\.)\b/.test(t)) return 'senior_ic';
  if (/\b(associate|specialist|analyst|coordinator)\b/.test(t)) return 'individual_contributor';
  return null;
}

function extractCurrentEmployment(
  profile: Record<string, unknown> | null
): CurrentEmployment {
  if (!profile) return { companyName: null, jobTitle: null, seniorityLevel: null };

  // harvestapi dedicates a `currentPosition` array for the active role
  const currentPositions = Array.isArray(profile.currentPosition)
    ? (profile.currentPosition as Record<string, unknown>[])
    : [];
  if (currentPositions.length > 0) {
    const pos = currentPositions[0];
    const title = typeof pos.title === 'string' ? pos.title.trim() || null : null;
    const company = typeof pos.companyName === 'string' ? pos.companyName.trim() || null : null;
    return { companyName: company, jobTitle: title, seniorityLevel: inferSeniorityLevel(title) };
  }

  // Fallback: scan experience array for current role
  const experience = (
    Array.isArray(profile.experience)
      ? profile.experience
      : Array.isArray(profile.experiences)
      ? profile.experiences
      : Array.isArray(profile.positions)
      ? profile.positions
      : []
  ) as Record<string, unknown>[];

  for (const exp of experience) {
    const endDate = exp.endDate as Record<string, unknown> | string | null | undefined;
    const endText =
      typeof endDate === 'string'
        ? endDate
        : typeof endDate === 'object' && endDate !== null && typeof endDate.text === 'string'
        ? endDate.text
        : '';
    const isCurrent =
      exp.current === true || /^present$/i.test(endText.trim());

    if (isCurrent) {
      const title = typeof exp.title === 'string' ? exp.title.trim() || null : null;
      const company = typeof exp.companyName === 'string' ? exp.companyName.trim() || null : null;
      return { companyName: company, jobTitle: title, seniorityLevel: inferSeniorityLevel(title) };
    }
  }

  // If nothing is marked current, use the first entry as best guess
  const first = experience[0];
  if (first) {
    const title = typeof first.title === 'string' ? first.title.trim() || null : null;
    const company = typeof first.companyName === 'string' ? first.companyName.trim() || null : null;
    return { companyName: company, jobTitle: title, seniorityLevel: inferSeniorityLevel(title) };
  }

  return { companyName: null, jobTitle: null, seniorityLevel: null };
}

// ── Company ID resolution ──────────────────────────────────────────────────

/**
 * Try to resolve a Supabase company_id for the scraped company name.
 * Looks in user_companies → companies by case-insensitive name match.
 * Falls back to the contact's existing company_id if no match is found —
 * that still allows title/promotion signals to fire.
 */
async function resolveCompanyId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyName: string | null,
  fallbackCompanyId: string | null
): Promise<string | null> {
  if (!companyName) return fallbackCompanyId;

  const { data } = await admin
    .from('user_companies')
    .select('company_id, companies!inner(company_name)')
    .eq('user_id', userId)
    .ilike('companies.company_name', companyName.trim())
    .limit(1)
    .maybeSingle();

  if (data && typeof data.company_id === 'string') return data.company_id;
  return fallbackCompanyId;
}

// ── Main monitor ───────────────────────────────────────────────────────────

export type JobChangeMonitorInput = {
  userId: string;
  contactIds?: string[];
  limit?: number;
};

export async function runJobChangeMonitor(
  input: JobChangeMonitorInput
): Promise<JobChangeMonitorResult> {
  const admin = createAdminClient();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_BATCH, 1), MAX_BATCH);

  const contactIds = Array.isArray(input.contactIds)
    ? input.contactIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : [];

  const query = admin
    .from('contacts')
    .select(
      'id, user_id, company_id, full_name, linkedin_url, email, ' +
      'resolved_current_company_name, resolved_current_company_domain, ' +
      'resolved_current_job_title, seniority_level, business_area, profile_enrichment_status'
    )
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .not('linkedin_url', 'is', null)
    .order('job_change_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (contactIds.length > 0) query.in('id', contactIds);

  const { data: contacts, error: fetchError } = await query;
  if (fetchError) throw new Error(`[job-change-monitor] fetch contacts: ${fetchError.message}`);

  let processed = 0;
  let noLinkedin = 0;
  let noChange = 0;
  let signalsEmitted = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedContacts: string[] = [];
  const failures: { contact_id: string; error: string }[] = [];

  for (const row of (contacts ?? []) as unknown as ContactRecord[]) {
    if (!row.linkedin_url) {
      noLinkedin++;
      continue;
    }

    try {
      // 1. Scrape current LinkedIn profile
      const profile = await scrapeLinkedInProfile(row.linkedin_url);
      const scraped = extractCurrentEmployment(profile);

      // 2. Resolve company_id for the scraped company
      const newCompanyId = await resolveCompanyId(
        admin,
        row.user_id,
        scraped.companyName,
        row.company_id
      );

      const eventAt = new Date().toISOString();
      const previouslyEnriched =
        row.profile_enrichment_status === 'completed' ||
        row.profile_enrichment_status === 'ambiguous';

      // 3. Emit signals by comparing previous vs scraped state
      const signalResult = await emitExternalContactSignalsFromEnrichment(
        admin as unknown as Parameters<typeof emitExternalContactSignalsFromEnrichment>[0],
        {
          previous: {
            userId: row.user_id,
            contactId: row.id,
            companyId: row.company_id,
            fullName: row.full_name,
            linkedinUrl: row.linkedin_url,
            email: row.email,
            companyName: row.resolved_current_company_name,
            companyDomain: row.resolved_current_company_domain,
            jobTitle: row.resolved_current_job_title,
            seniorityLevel: row.seniority_level,
            businessArea: row.business_area,
            previouslyEnriched,
          },
          current: {
            companyId: newCompanyId,
            fullName: row.full_name,
            linkedinUrl: row.linkedin_url,
            email: row.email,
            companyName: scraped.companyName,
            companyDomain: null, // not available from profile scrape alone
            jobTitle: scraped.jobTitle,
            seniorityLevel: scraped.seniorityLevel,
            businessArea: null, // lightweight path — no LLM derivation
            sourceProvider: 'apify_job_change_monitor',
            eventAt,
          },
        }
      );

      // 4. Update stored job/company fields and mark checked timestamp
      await admin
        .from('contacts')
        .update({
          ...(scraped.jobTitle
            ? { resolved_current_job_title: scraped.jobTitle }
            : {}),
          ...(scraped.companyName
            ? { resolved_current_company_name: scraped.companyName }
            : {}),
          ...(newCompanyId !== row.company_id && newCompanyId
            ? { company_id: newCompanyId }
            : {}),
          job_change_checked_at: eventAt,
        })
        .eq('id', row.id);

      // 5. Recompute contact readiness (non-fatal)
      await recomputeContactReadiness(
        admin as unknown as Parameters<typeof recomputeContactReadiness>[0],
        { userId: row.user_id, contactId: row.id }
      ).catch((e) =>
        console.warn('[job-change-monitor] contact readiness recompute skipped:', e)
      );

      if (signalResult.emittedSignalTypes.length > 0) {
        signalsEmitted += signalResult.emittedSignalTypes.length;
        for (const st of signalResult.emittedSignalTypes) emittedSignalTypes.add(st);
        recomputedContacts.push(row.id);
      } else {
        noChange++;
      }
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[job-change-monitor] contact ${row.id} failed:`, msg);
      failed++;
      failures.push({ contact_id: row.id, error: msg });
    }
  }

  return {
    processed,
    no_linkedin: noLinkedin,
    no_change: noChange,
    signals_emitted: signalsEmitted,
    failed,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_contacts: recomputedContacts,
    failures,
  };
}
