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
import {
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';
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
 * Resolve (or create) a Supabase company_id for the scraped company name.
 *
 * Order of attempts:
 *   1. Fast path — scraped name matches the contact's currently-recorded
 *      company name (case-insensitive). Return existing company_id.
 *   2. Existing link in user_companies for this user. Return its company_id.
 *   3. Existing canonical company globally (any user). Link the user via
 *      user_companies upsert, then return its id.
 *   4. Brand-new company. Insert a minimal companies stub + user_companies
 *      link, return the new id.
 *
 * If anything errors during creation, falls back to the existing company_id
 * so the rest of the monitor still emits title/promotion signals.
 */
async function resolveOrCreateCompanyId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyName: string | null,
  fallbackCompanyId: string | null,
  currentCompanyName: string | null,
): Promise<string | null> {
  if (!companyName) return fallbackCompanyId;
  const trimmed = companyName.trim();
  if (!trimmed) return fallbackCompanyId;

  // 1. Fast path — scrape matches the contact's currently-recorded company.
  if (
    currentCompanyName &&
    currentCompanyName.trim().toLowerCase() === trimmed.toLowerCase()
  ) {
    return fallbackCompanyId;
  }

  // 2. Already linked under user_companies.
  const { data: linkedRow } = await admin
    .from('user_companies')
    .select('company_id, companies!inner(company_name)')
    .eq('user_id', userId)
    .ilike('companies.company_name', trimmed)
    .limit(1)
    .maybeSingle();
  if (linkedRow && typeof linkedRow.company_id === 'string') {
    return linkedRow.company_id;
  }

  // 3. Canonical company exists globally (other user's import); just link it.
  const { data: existingCompany } = await admin
    .from('companies')
    .select('id')
    .ilike('company_name', trimmed)
    .limit(1)
    .maybeSingle();
  if (existingCompany && typeof existingCompany.id === 'string') {
    await admin
      .from('user_companies')
      .upsert(
        {
          user_id: userId,
          company_id: existingCompany.id,
          source: 'job_change_monitor',
          archived_at: null,
        },
        { onConflict: 'user_id,company_id' },
      );
    return existingCompany.id;
  }

  // 4. Create a fresh stub. Minimal fields — enrichment fills the rest later.
  const { data: created, error: insertErr } = await admin
    .from('companies')
    .insert({ company_name: trimmed, source: 'job_change_monitor' })
    .select('id')
    .single();
  if (insertErr || !created || typeof created.id !== 'string') {
    console.warn(
      `[job-change-monitor] failed to create company stub for "${trimmed}":`,
      insertErr,
    );
    return fallbackCompanyId;
  }

  await admin
    .from('user_companies')
    .upsert(
      {
        user_id: userId,
        company_id: created.id,
        source: 'job_change_monitor',
        archived_at: null,
      },
      { onConflict: 'user_id,company_id' },
    );

  return created.id;
}

// ── Closed-deal detach ────────────────────────────────────────────────────

/**
 * When a `recently_changed_company` signal fires, the contact's existing
 * HubSpot deal links (closed-won / closed-lost) at the OLD company become
 * stale — the person isn't a customer of that account anymore, they've
 * moved on. Mark those links so the dual-lookup in resolveContactHubSpotStates
 * skips them and the CRM badge / priority cap stop applying.
 *
 * Uses the same dual-lookup (arcova_contact_id AND hubspot_contact_email)
 * as /api/leads so we catch links matched by either path.
 */
async function detachClosedDealLinks(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  contactId: string,
  contactEmail: string | null,
): Promise<number> {
  try {
    const emailNorm = contactEmail?.trim().toLowerCase() || null;

    // 1. Find every deal link tied to this contact (id or email).
    const [byId, byEmail] = await Promise.all([
      admin
        .from('crm_deal_contact_links')
        .select('id, hubspot_deal_id, raw_payload')
        .eq('user_id', userId)
        .eq('arcova_contact_id', contactId),
      emailNorm
        ? admin
            .from('crm_deal_contact_links')
            .select('id, hubspot_deal_id, raw_payload')
            .eq('user_id', userId)
            .eq('hubspot_contact_email', emailNorm)
        : Promise.resolve({ data: [] as Array<{ id: string; hubspot_deal_id: unknown; raw_payload: unknown }>, error: null }),
    ]);

    type LinkRow = { id: string; hubspot_deal_id: unknown; raw_payload: unknown };
    const allLinks = new Map<string, LinkRow>();
    for (const row of (byId.data ?? []) as LinkRow[]) allLinks.set(row.id, row);
    for (const row of (byEmail.data ?? []) as LinkRow[]) allLinks.set(row.id, row);
    if (allLinks.size === 0) return 0;

    // 2. Find which of those deals are closed (won OR lost).
    const dealIds = [
      ...new Set(
        [...allLinks.values()]
          .map((l) => (l.hubspot_deal_id != null ? String(l.hubspot_deal_id) : null))
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (!dealIds.length) return 0;

    const { data: dealRows } = await admin
      .from('crm_deals')
      .select('hubspot_deal_id, deal_stage')
      .eq('user_id', userId)
      .in('hubspot_deal_id', dealIds);

    const closedDealIds = new Set<string>();
    for (const row of (dealRows ?? []) as Array<{ hubspot_deal_id: unknown; deal_stage: string | null }>) {
      const stage = (row.deal_stage || '').trim().toLowerCase();
      if (stage === 'closedwon' || stage === 'closedlost') {
        closedDealIds.add(String(row.hubspot_deal_id));
      }
    }
    if (closedDealIds.size === 0) return 0;

    // 3. Mark each matching link as detached (additive raw_payload update so
    //    we don't clobber existing payload fields).
    let updated = 0;
    for (const link of allLinks.values()) {
      const dealId = link.hubspot_deal_id != null ? String(link.hubspot_deal_id) : null;
      if (!dealId || !closedDealIds.has(dealId)) continue;
      const payload = (link.raw_payload ?? {}) as Record<string, unknown>;
      if (payload.detached_due_to_job_change === true) continue;
      const nextPayload = {
        ...payload,
        detached_due_to_job_change: true,
        detached_at: new Date().toISOString(),
      };
      const { error: updErr } = await admin
        .from('crm_deal_contact_links')
        .update({ raw_payload: nextPayload })
        .eq('id', link.id);
      if (!updErr) updated++;
    }
    return updated;
  } catch (err) {
    console.warn('[job-change-monitor] detachClosedDealLinks failed:', err);
    return 0;
  }
}

// ── Prior-relationship signal ─────────────────────────────────────────────

const PRIOR_RELATIONSHIP_SOURCE = 'job_change_monitor/prior_relationship';

type PriorRelationshipTier =
  | 'prior_customer_relationship'
  | 'prior_active_deal_relationship'
  | 'prior_pipeline_relationship';

/**
 * Before the job-change monitor detaches a contact's closed deal links, inspect
 * the prior engagement level at the OLD company and emit a tiered positive
 * readiness signal scoped to the NEW company.
 *
 * Example: Kumar was closed-won at Enzene. He moves to Illumina. This emits
 * `prior_customer_relationship` against Illumina — surfacing the warm-start
 * relationship context without needing any manual tagging.
 *
 * Tiers (highest wins):
 *   closed-won  → prior_customer_relationship   (strong, 365d)
 *   active deal → prior_active_deal_relationship (medium, 180d)
 *   closed-lost → prior_pipeline_relationship    (weak, 90d)
 *
 * Called BEFORE detachClosedDealLinks so the links are still un-flagged.
 */
async function emitPriorRelationshipSignal(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  contactId: string,
  contactEmail: string | null,
  newCompanyId: string,
  eventAt: string,
): Promise<PriorRelationshipTier | null> {
  try {
    const emailNorm = contactEmail?.trim().toLowerCase() || null;

    // 1. Gather all non-detached deal links for this contact.
    const [byId, byEmail] = await Promise.all([
      admin
        .from('crm_deal_contact_links')
        .select('hubspot_deal_id, raw_payload')
        .eq('user_id', userId)
        .eq('arcova_contact_id', contactId),
      emailNorm
        ? admin
            .from('crm_deal_contact_links')
            .select('hubspot_deal_id, raw_payload')
            .eq('user_id', userId)
            .eq('hubspot_contact_email', emailNorm)
        : Promise.resolve({
            data: [] as Array<{ hubspot_deal_id: unknown; raw_payload: unknown }>,
            error: null,
          }),
    ]);

    type LinkRow = { hubspot_deal_id: unknown; raw_payload: unknown };
    const activeDealIds = new Set<string>();
    for (const row of [...(byId.data ?? []), ...(byEmail.data ?? [])] as LinkRow[]) {
      const payload = (row.raw_payload ?? {}) as Record<string, unknown>;
      if (payload.detached_due_to_job_change === true) continue; // already detached
      if (row.hubspot_deal_id != null) activeDealIds.add(String(row.hubspot_deal_id));
    }
    if (activeDealIds.size === 0) return null;

    // 2. Look up deal stages.
    const { data: dealRows } = await admin
      .from('crm_deals')
      .select('deal_stage')
      .eq('user_id', userId)
      .in('hubspot_deal_id', [...activeDealIds]);

    if (!dealRows || dealRows.length === 0) return null;

    // 3. Determine the best (highest-tier) prior engagement level.
    // Score each deal stage: closedwon=3, active=2, closedlost=1, unknown=0
    let bestScore = 0;
    for (const row of dealRows as Array<{ deal_stage: string | null }>) {
      const stage = (row.deal_stage ?? '').trim().toLowerCase();
      if (stage === 'closedwon') { bestScore = 3; break; }
      if (stage !== 'closedlost' && stage !== '' && bestScore < 2) bestScore = 2;
      else if (stage === 'closedlost' && bestScore < 1) bestScore = 1;
    }
    const bestTier: PriorRelationshipTier | null =
      bestScore === 3 ? 'prior_customer_relationship'
      : bestScore === 2 ? 'prior_active_deal_relationship'
      : bestScore === 1 ? 'prior_pipeline_relationship'
      : null;
    if (!bestTier) return null;

    // 4. Emit via the readiness-service pipeline.
    const sourceEventId = `${PRIOR_RELATIONSHIP_SOURCE}:${contactId}:${newCompanyId}:${eventAt}`;

    const tierMeta: Record<PriorRelationshipTier, { title: string; summary: string }> = {
      prior_customer_relationship: {
        title: 'Prior customer relationship — moved to new company',
        summary:
          'This contact was previously associated with a closed-won deal. They have now moved to a new company, creating a warm-start re-engagement opportunity.',
      },
      prior_active_deal_relationship: {
        title: 'Prior active deal — moved to new company',
        summary:
          'This contact was previously associated with an active deal in the pipeline. They have now moved to a new company.',
      },
      prior_pipeline_relationship: {
        title: 'Prior pipeline relationship — moved to new company',
        summary:
          'This contact was previously in the pipeline at their prior company. They have now moved to a new company.',
      },
    };

    const { title, summary } = tierMeta[bestTier];

    const ingestResult = await ingestSignalSourceEvent(
      admin as unknown as Parameters<typeof ingestSignalSourceEvent>[0],
      {
        userId,
        entityScope: 'contact',
        companyId: newCompanyId,
        contactId,
        source: PRIOR_RELATIONSHIP_SOURCE,
        sourceEventType: bestTier,
        sourceEventId,
        sourceUrl: null,
        title,
        summary,
        excerpt: summary,
        eventAt,
        metadata: { new_company_id: newCompanyId, prior_deal_tier: bestTier },
      },
    );

    const rawEvent = {
      id: ingestResult.sourceEventId,
      userId,
      entityId: contactId,
      entityScope: 'contact' as const,
      source: PRIOR_RELATIONSHIP_SOURCE,
      sourceUrl: null,
      sourceEventType: bestTier,
      sourceEventId,
      title,
      summary,
      excerpt: summary,
      eventAt,
      observedAt: new Date().toISOString(),
      metadata: { new_company_id: newCompanyId, prior_deal_tier: bestTier },
    };

    await normalizeSignalSourceEvent(
      admin as unknown as Parameters<typeof normalizeSignalSourceEvent>[0],
      {
        userId,
        rawEvent,
        signalKeys: [bestTier],
        companyId: newCompanyId,
        contactId,
      },
    );

    // Recompute the new company's readiness to pick up this signal immediately.
    await recomputeAccountReadiness(
      admin as unknown as Parameters<typeof recomputeAccountReadiness>[0],
      { userId, companyId: newCompanyId },
    ).catch((e) =>
      console.warn('[job-change-monitor] prior-relationship account readiness recompute skipped:', e),
    );

    return bestTier;
  } catch (err) {
    console.warn('[job-change-monitor] emitPriorRelationshipSignal failed:', err);
    return null;
  }
}

// ── Key-contact-departed signal ───────────────────────────────────────────

/**
 * Emits a `key_contact_departed` signal scoped to the OLD company (the company
 * the contact just left) and recomputes that company's account readiness.
 *
 * This surfaces the account as needing a new contact so the user doesn't lose
 * coverage after the departure is detected.
 */
async function emitKeyContactDepartedSignal(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  contactId: string,
  contactName: string | null,
  oldCompanyId: string,
  newCompanyName: string | null,
  eventAt: string,
): Promise<boolean> {
  try {
    const sourceEventId = `job_change_monitor/key_contact_departed:${contactId}:${oldCompanyId}:${eventAt}`;
    const title = 'Key contact departed';
    const summary = `${contactName ?? 'A contact'} has moved on from this company${newCompanyName ? ` to ${newCompanyName}` : ''}. Find a replacement contact to maintain account coverage.`;

    const ingestResult = await ingestSignalSourceEvent(
      admin as unknown as Parameters<typeof ingestSignalSourceEvent>[0],
      {
        userId,
        entityScope: 'company',
        companyId: oldCompanyId,
        contactId,
        source: 'job_change_monitor/key_contact_departed',
        sourceEventType: 'key_contact_departed',
        sourceEventId,
        sourceUrl: null,
        title,
        summary,
        excerpt: summary,
        eventAt,
        metadata: {
          departed_contact_id: contactId,
          departed_contact_name: contactName,
          new_company_name: newCompanyName,
        },
      },
    );

    const rawEvent = {
      id: ingestResult.sourceEventId,
      userId,
      entityId: oldCompanyId,
      entityScope: 'company' as const,
      source: 'job_change_monitor/key_contact_departed',
      sourceUrl: null,
      sourceEventType: 'key_contact_departed',
      sourceEventId,
      title,
      summary,
      excerpt: summary,
      eventAt,
      observedAt: new Date().toISOString(),
      metadata: {
        departed_contact_id: contactId,
        departed_contact_name: contactName,
        new_company_name: newCompanyName,
      },
    };

    await normalizeSignalSourceEvent(
      admin as unknown as Parameters<typeof normalizeSignalSourceEvent>[0],
      {
        userId,
        rawEvent,
        signalKeys: ['key_contact_departed'],
        companyId: oldCompanyId,
        contactId,
      },
    );

    await recomputeAccountReadiness(
      admin as unknown as Parameters<typeof recomputeAccountReadiness>[0],
      { userId, companyId: oldCompanyId },
    ).catch((e) =>
      console.warn('[job-change-monitor] key_contact_departed account readiness recompute skipped:', e),
    );

    return true;
  } catch (err) {
    console.warn('[job-change-monitor] emitKeyContactDepartedSignal failed:', err);
    return false;
  }
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

      // 2. Resolve (or create) company_id for the scraped company. If the
      // scrape detects a new employer the user hasn't imported yet, we
      // auto-create a minimal stub so Kumar properly migrates off the old
      // (e.g. closed-won) account.
      const newCompanyId = await resolveOrCreateCompanyId(
        admin,
        row.user_id,
        scraped.companyName,
        row.company_id,
        row.resolved_current_company_name,
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

      // 4. Update stored job/company fields and mark checked timestamp.
      //    seniority_level is written here so ICP buyer-function mapping stays
      //    current without waiting for the full enrichment queue to run.
      await admin
        .from('contacts')
        .update({
          ...(scraped.jobTitle
            ? { resolved_current_job_title: scraped.jobTitle }
            : {}),
          ...(scraped.companyName
            ? { resolved_current_company_name: scraped.companyName }
            : {}),
          ...(scraped.seniorityLevel
            ? { seniority_level: scraped.seniorityLevel }
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

      // 6. If the contact changed company:
      //    a. Detach them from any closed-won / closed-lost deal links at the
      //       OLD employer so the stale CRM context (Won badge, customer/
      //       dormant priority cap) stops applying.
      //    b. Queue a full contact re-enrichment (Apollo + LinkedIn + LLM
      //       classification + fit + company monitor for the new stub). Mark
      //       the contact 'requested' — the contact-enrichment-queue cron
      //       picks it up and runs runContactResolutionPipelineForContact
      //       which also enriches the new company stub as a side effect.
      //    c. Promotion / internal role / title change keep the contact's
      //       employer; their Apollo + CRM data is still valid, so no heavy
      //       re-enrichment needed. recomputeContactReadiness (step 5) is
      //       sufficient for those.
      if (signalResult.emittedSignalTypes.includes('recently_changed_company')) {
        // 6a. Emit a tiered prior-relationship signal at the NEW company BEFORE
        //     detaching the deal links, so we can still read the pre-detach stages.
        if (newCompanyId) {
          const priorTier = await emitPriorRelationshipSignal(
            admin,
            row.user_id,
            row.id,
            row.email,
            newCompanyId,
            eventAt,
          );
          if (priorTier) {
            signalsEmitted++;
            emittedSignalTypes.add(priorTier);
          }
        }

        // 6b. Emit key_contact_departed at the old company so its readiness is
        //     recomputed and the account surfaces as needing a new contact.
        if (row.company_id && row.company_id !== newCompanyId) {
          await emitKeyContactDepartedSignal(
            admin,
            row.user_id,
            row.id,
            row.full_name,
            row.company_id,
            scraped.companyName,
            eventAt,
          );
        }

        // 6c. Detach closed deal links at the old employer.
        const detached = await detachClosedDealLinks(
          admin,
          row.user_id,
          row.id,
          row.email,
        );
        if (detached > 0) {
          console.info(
            `[job-change-monitor] detached ${detached} closed deal link(s) for contact ${row.id}`,
          );
        }

        // 6d. Queue a full contact re-enrichment at high priority (1) so the
        //     enrichment queue processes this before routine manual refreshes (0).
        const { error: queueErr } = await admin
          .from('contacts')
          .update({
            enrichment_refresh_status: 'requested',
            enrichment_refresh_priority: 1,
            enrichment_refresh_last_error: null,
            updated_at: eventAt,
          })
          .eq('id', row.id);
        if (queueErr) {
          console.warn(
            `[job-change-monitor] failed to queue re-enrichment for contact ${row.id}:`,
            queueErr,
          );
        }
      }

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
