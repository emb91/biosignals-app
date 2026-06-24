/**
 * Daily HubSpot auto-sync — runs on a Vercel cron schedule.
 *
 * For every user who has HubSpot connected it will:
 *   1. PUSH: upsert all scored Arcova contacts back to HubSpot (idempotent).
 *   2. PULL: fetch HubSpot contacts that haven't been enriched yet (arcova_enriched_at
 *      is unset), create an import batch, and kick off background enrichment.
 *   3. READINESS: poll changed HubSpot contacts and deals, mirror them locally,
 *      emit CRM signal events, and recompute readiness for resolved Arcova companies.
 *
 * Protected by CRON_SECRET — Vercel automatically passes this as
 * `Authorization: Bearer <CRON_SECRET>` when invoking cron routes.
 */
import { after, NextResponse } from 'next/server';
import { observeCron } from '@/lib/cron-observability';
import { createAdminClient } from '@/lib/supabase-admin';
import { getNangoAccessToken, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import { looksLikeEmail } from '@/lib/contact-emails';
import {
  ensureArcovaHubSpotProperties,
  batchUpsertContacts,
  getContactAssociatedCompanyIds,
  batchUpdateCompanies,
  batchReadContactsByEmail,
  fetchUnenrichedHubSpotContacts,
} from '@/lib/hubspot';
import { processQueuedRowsInBackground, type QueuedRow } from '@/lib/import-queue';
import { getActionFromScores, effectiveReadiness, formatLeadActionLabel } from '@/lib/lead-action';
import { resolveEffectivePriority } from '@/lib/effective-priority';
import { syncHubSpotContactsIntoReadiness } from '@/lib/signals/readiness-hubspot-contacts';
import { syncHubSpotDealsIntoReadiness } from '@/lib/signals/readiness-hubspot-deals';
import { denormalizeCrmSuppressionState } from '@/lib/crm-suppression-denormalize';
import { ensureBaselineSnapshot } from '@/lib/backup/hubspot-snapshot';

// ── Constants ─────────────────────────────────────────────────────────────────

function computeAction(
  companyFit: number | null,
  contactFit: number | null,
  readiness: number | null,
  isSuppressed: boolean,
): string {
  return formatLeadActionLabel(
    getActionFromScores(
      companyFit,
      contactFit,
      readiness,
      isSuppressed ? 'dormant' : null,
    ),
  );
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return (Math.round(n * 1000) / 1000).toString();
}

function fmtList(arr: string[] | null | undefined): string {
  if (!arr?.length) return '';
  return arr.join('; ');
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

// ── Auth guard ────────────────────────────────────────────────────────────────

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const auth = request.headers.get('authorization') ?? '';
  return auth === `Bearer ${cronSecret}`;
}

// ── Push: Arcova → HubSpot ────────────────────────────────────────────────────

async function pushUserToHubSpot(
  userId: string,
  accessToken: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<{
  contacts: { upserted: number; errors: number; errorDetails: string[] };
  companies: { updated: number; errors: number; errorDetails: string[] };
  skippedContacts: Array<{ name: string; company: string | null; reason: string }>;
}> {
  const { data: leads } = await admin
    .from('contacts')
    .select(`
      id, email, first_name, last_name, job_title, seniority_level, business_area,
      contact_fit_score, readiness_score, priority_score, crm_is_suppressed,
      overall_fit_score, contact_bio, linkedin_url,
      company_id,
      companies(
        id, domain,
        company_name, modalities, therapeutic_areas, development_stages,
        company_type, platform_category, bio_summary, industry, employee_count,
        founded_year, headquarters_city, headquarters_country, linkedin_url,
        funding_stage, funding_status_label, total_funding_usd
      )
    `)
    .eq('user_id', userId)
    .not('overall_fit_score', 'is', null);

  if (!leads?.length) {
    return {
      contacts: { upserted: 0, errors: 0, errorDetails: [] },
      companies: { updated: 0, errors: 0, errorDetails: [] },
      skippedContacts: [],
    };
  }

  await ensureArcovaHubSpotProperties(accessToken);

  // Company-level scores live in the org-scoped account layer, exposed through
  // accounts_view for the derived priority score used by HubSpot.
  const leadCompanyIds = [
    ...new Set(
      leads
        .map((l) => (l as { company_id?: string | null }).company_id)
        .filter((v): v is string => typeof v === 'string' && Boolean(v)),
    ),
  ];
  const companyScoreById = new Map<
    string,
    { fit: number | null; readiness: number | null; priority: number | null; crmIsSuppressed: boolean }
  >();
  if (leadCompanyIds.length > 0) {
    const { data: accountRows } = await admin
      .from('accounts_view')
      .select('id, company_fit_score, readiness_score, priority_score, crm_is_suppressed')
      .eq('user_id', userId)
      .in('id', leadCompanyIds);
    for (const r of (accountRows ?? []) as Array<{
      id: string;
      company_fit_score: number | null;
      readiness_score: number | null;
      priority_score: number | null;
      crm_is_suppressed: boolean | null;
    }>) {
      companyScoreById.set(r.id, {
        fit: r.company_fit_score,
        readiness: r.readiness_score,
        priority: r.priority_score,
        crmIsSuppressed: r.crm_is_suppressed === true,
      });
    }
  }

  const enrichedAt = new Date().toISOString().slice(0, 10);

  const upserts: Array<{ email: string; properties: Record<string, string> }> = [];
  const skippedContacts: Array<{ name: string; company: string | null; reason: string }> = [];

  for (const lead of leads) {
    const trimmedEmail = lead.email?.trim() ?? '';
    const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
    const companyName = (lead.companies as any)?.company_name ?? null;
    if (!trimmedEmail) {
      skippedContacts.push({ name, company: companyName, reason: 'No email address' });
      continue;
    }
    if (!looksLikeEmail(trimmedEmail)) {
      skippedContacts.push({
        name,
        company: companyName,
        reason: 'Email looks invalid. Update it to something like name@company.com.',
      });
      continue;
    }

    const co = lead.companies as any;
    const coScores = (lead as { company_id?: string | null }).company_id
      ? companyScoreById.get((lead as { company_id?: string | null }).company_id!)
      : undefined;
    const companyFit = coScores?.fit ?? null;
    const contactFit = typeof lead.contact_fit_score === 'number' ? lead.contact_fit_score : null;
    const contactReadiness = typeof lead.readiness_score === 'number' ? lead.readiness_score : null;
    const overallFit = lead.overall_fit_score ?? null;
    const intrinsicReadiness = effectiveReadiness(coScores?.readiness ?? null, contactReadiness);
    const contactPriority = resolveEffectivePriority({
      intrinsicPriority: typeof lead.priority_score === 'number' ? lead.priority_score : null,
      companyFit,
      contactFit,
      intrinsicReadiness,
      crmIsSuppressed: lead.crm_is_suppressed === true,
    });
    const action = computeAction(
      companyFit,
      contactFit,
      contactPriority.effectiveReadiness,
      contactPriority.isSuppressed,
    );

    const props: Record<string, string> = {
      arcova_action: action,
      arcova_enriched_at: enrichedAt,
      arcova_contact_id: lead.id,
    };

    if (overallFit !== null) props.arcova_overall_fit_score = fmt(overallFit);
    if (contactFit !== null) props.arcova_contact_fit_score = fmt(contactFit);
    if (contactReadiness !== null) props.arcova_contact_readiness_score = fmt(contactReadiness);
    if (contactPriority.effectivePriority !== null) {
      props.arcova_contact_priority_score = fmt(contactPriority.effectivePriority);
    }
    if (lead.seniority_level) props.arcova_seniority = lead.seniority_level;
    if (lead.business_area) props.arcova_function = lead.business_area;
    props.arcova_enriched_email = lead.email!;

    const personSummary = Array.isArray(lead.contact_bio)
      ? (lead.contact_bio as string[]).filter(Boolean).join(' ')
      : (lead.contact_bio as string | null) ?? '';
    if (personSummary) props.arcova_person_summary = personSummary;
    if (lead.linkedin_url) props.arcova_linkedin_url = lead.linkedin_url;
    if (lead.linkedin_url) props.hs_linkedin_url = lead.linkedin_url;
    if (lead.job_title) props.jobtitle = lead.job_title;
    if (co?.id) props.arcova_company_id = co.id;
    if (co?.company_name) props.arcova_company_name = co.company_name;
    if (co?.domain) props.arcova_company_domain = co.domain;

    upserts.push({ email: lead.email!.toLowerCase(), properties: props });
  }

  if (!upserts.length) {
    return {
      contacts: { upserted: 0, errors: 0, errorDetails: [] },
      companies: { updated: 0, errors: 0, errorDetails: [] },
      skippedContacts,
    };
  }

  const contactResult = await batchUpsertContacts(accessToken, upserts);

  // Company updates
  const emails = upserts.map((u) => u.email);
  const hubspotContacts = await batchReadContactsByEmail(accessToken, emails);

  const emailToLead = new Map(leads.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l]));
  const hubspotContactToLead = new Map(
    hubspotContacts
      .map((c) => {
        const email = c.properties.email?.toLowerCase();
        const lead = email ? emailToLead.get(email) : undefined;
        return lead ? ([c.id, lead] as const) : null;
      })
      .filter((x): x is [string, (typeof leads)[number]] => x !== null)
  );

  const matchedIds = [...hubspotContactToLead.keys()];
  const contactToCompany = await getContactAssociatedCompanyIds(accessToken, matchedIds);
  const companyUpdates: Array<{ id: string; properties: Record<string, string> }> = [];
  const seenCompanyIds = new Set<string>();

  for (const [contactId, companyId] of contactToCompany.entries()) {
    if (seenCompanyIds.has(companyId)) continue;
    seenCompanyIds.add(companyId);

    const lead = hubspotContactToLead.get(contactId);
    if (!lead) continue;
    const co = lead.companies as any;
    if (!co) continue;

    const props: Record<string, string> = {};
    const coScores = co?.id ? companyScoreById.get(co.id) : undefined;
    const companyPriority = resolveEffectivePriority({
      intrinsicPriority: coScores?.priority ?? null,
      companyFit: coScores?.fit ?? null,
      intrinsicReadiness: coScores?.readiness ?? 0,
      crmIsSuppressed: coScores?.crmIsSuppressed ?? false,
    });
    if (coScores?.fit != null) props.arcova_company_fit_score = fmt(coScores.fit);
    if (coScores?.readiness != null) props.arcova_company_readiness_score = fmt(coScores.readiness);
    if (companyPriority.effectivePriority != null) {
      props.arcova_company_priority_score = fmt(companyPriority.effectivePriority);
    }
    if (co.modalities?.length) props.arcova_modalities = fmtList(co.modalities);
    if (co.therapeutic_areas?.length) props.arcova_therapeutic_areas = fmtList(co.therapeutic_areas);
    if (co.development_stages?.length) props.arcova_development_stages = fmtList(co.development_stages);
    if (co.company_type) props.arcova_company_type = co.company_type;
    if (co.platform_category) props.arcova_platform_category = co.platform_category;
    if (co.bio_summary) props.arcova_bio_summary = co.bio_summary;
    if (co.industry) props.arcova_industry = co.industry;
    if (co.employee_count != null) props.arcova_employee_count = String(co.employee_count);
    if (co.founded_year != null) props.arcova_founded_year = String(co.founded_year);
    const hq = [co.headquarters_city, co.headquarters_country].filter(Boolean).join(', ');
    if (hq) props.arcova_headquarters = hq;
    if (co.linkedin_url) props.arcova_linkedin_url = co.linkedin_url;
    if (co.funding_stage) props.arcova_funding_stage = co.funding_stage;
    if (co.funding_status_label) props.arcova_funding_status = co.funding_status_label;
    if (co.total_funding_usd != null) props.arcova_total_funding_usd = String(co.total_funding_usd);

    if (Object.keys(props).length > 0) companyUpdates.push({ id: companyId, properties: props });
  }

  const companyResult = companyUpdates.length > 0
    ? await batchUpdateCompanies(accessToken, companyUpdates)
    : { updated: 0, errors: 0, errorDetails: [] };

  return { contacts: contactResult, companies: companyResult, skippedContacts };
}

// ── Pull: HubSpot → Arcova ────────────────────────────────────────────────────

async function pullNewFromHubSpot(
  userId: string,
  accessToken: string,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ pulled: number; batchId: string | null }> {
  const contacts = await fetchUnenrichedHubSpotContacts(accessToken);
  if (!contacts.length) return { pulled: 0, batchId: null };

  const filename = `hubspot-auto-${new Date().toISOString().slice(0, 10)}.csv`;

  const { data: batch, error: batchError } = await admin
    .from('upload_batches')
    .insert({ user_id: userId, filename, total_rows: contacts.length, status: 'processing' })
    .select('id')
    .single();

  if (batchError || !batch) {
    console.error(`[cron] Failed to create batch for user ${userId}:`, batchError);
    return { pulled: 0, batchId: null };
  }

  const batchId = batch.id as string;

  const insertPayload = contacts.map((c) => {
    const p = c.properties;
    const location = [p.city, p.country].filter(Boolean).join(', ');
    const fullName = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
    return {
      user_id: userId,
      batch_id: batchId,
      full_name: fullName || null,
      email: p.email || null,
      linkedin_url: p.hs_linkedin_url || null,
      company_name: p.company || null,
      status: 'pending',
      raw_data: {
        first_name: p.firstname || '',
        last_name: p.lastname || '',
        full_name: fullName,
        email: p.email || '',
        job_title: p.jobtitle || '',
        company_name: p.company || '',
        company_domain: p.website || '',
        linkedin_url: p.hs_linkedin_url || '',
        location,
        // Phones — picked up downstream by import-queue and stacked into
        // contact_phones via ensureImportPhoneEntry.
        phone: p.phone || '',
        mobile_phone: p.mobilephone || '',
      },
    };
  });

  const { data: insertedRows, error: insertError } = await admin
    .from('raw_uploads')
    .insert(insertPayload)
    .select('id, full_name, email, linkedin_url, company_name, raw_data');

  if (insertError || !insertedRows) {
    console.error(`[cron] Failed to insert raw_uploads for user ${userId}:`, insertError);
    return { pulled: 0, batchId: null };
  }

  // Deduplicate against existing contacts
  const { data: existingContacts } = await admin
    .from('contacts')
    .select('linkedin_url, email, first_name, last_name, company_name')
    .eq('user_id', userId);

  const normalize = (v: string | null | undefined) => (v || '').trim().toLowerCase();

  const duplicateIds: string[] = [];
  const rowsToEnrich = insertedRows.filter((row) => {
    const raw = row.raw_data as Record<string, unknown>;
    const rowEmail = normalize(row.email as string);
    const rowLinkedin = normalize(row.linkedin_url as string);
    const rowFirst = normalize(raw.first_name as string);
    const rowLast = normalize(raw.last_name as string);
    const rowCompany = normalize(row.company_name as string);

    const isDupe = (existingContacts || []).some((c: any) => {
      if (rowLinkedin && c.linkedin_url && normalize(c.linkedin_url) === rowLinkedin) return true;
      if (rowEmail && c.email && normalize(c.email) === rowEmail) return true;
      if (rowFirst && rowLast && rowCompany && c.first_name && c.last_name && c.company_name &&
          normalize(c.first_name) === rowFirst && normalize(c.last_name) === rowLast &&
          normalize(c.company_name) === rowCompany) return true;
      return false;
    });

    if (isDupe) { duplicateIds.push(row.id as string); return false; }
    return true;
  });

  if (duplicateIds.length > 0) {
    await admin.from('raw_uploads').update({ status: 'duplicate' }).in('id', duplicateIds);
  }

  const pendingIds = rowsToEnrich.map((r) => r.id as string);
  if (pendingIds.length > 0) {
    await admin.from('raw_uploads').update({ status: 'enriching' }).in('id', pendingIds);
  }

  await admin
    .from('upload_batches')
    .update({ duplicate_rows: duplicateIds.length })
    .eq('id', batchId);

  if (rowsToEnrich.length === 0) {
    await admin
      .from('upload_batches')
      .update({ status: 'complete', processed_rows: duplicateIds.length })
      .eq('id', batchId);
    return { pulled: contacts.length, batchId };
  }

  const queuedRows: QueuedRow[] = rowsToEnrich.map((row) => ({
    id: row.id as string,
    full_name: row.full_name as string | null,
    email: row.email as string | null,
    linkedin_url: row.linkedin_url as string | null,
    company_name: row.company_name as string | null,
    raw_data: row.raw_data as Record<string, unknown>,
  }));

  // Kick off enrichment in the background (non-blocking)
  after(() => processQueuedRowsInBackground({ queuedRows, batchId, userId }));

  return { pulled: rowsToEnrich.length, batchId };
}

// ── Cron handler ──────────────────────────────────────────────────────────────

async function runCron(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get all HubSpot-connected users
  const { data: connections, error: connError } = await admin
    .from('nango_connections')
    .select('user_id, nango_connection_id')
    .eq('integration_id', HUBSPOT_INTEGRATION_ID);

  if (connError || !connections?.length) {
    return NextResponse.json({ ok: true, message: 'No HubSpot connections found', processed: 0 });
  }

  const results: Array<{
    userId: string;
    pushed?: { contacts: number; companies: number };
    pulled?: number;
    deals?: {
      fetched: number;
      mirrored: number;
      emittedEvents: number;
      recomputedCompanies: number;
      skippedUnresolvedCompanies: number;
      checkpoint: string | null;
    };
    contactSignals?: {
      fetched: number;
      mirrored: number;
      emittedEvents: number;
      recomputedCompanies: number;
      contextOnlyEvents: number;
      skippedUnresolvedCompanies: number;
      checkpoint: string | null;
    };
    error?: string;
  }> = [];

  for (const conn of connections) {
    try {
      const accessToken = await getNangoAccessToken(
        HUBSPOT_INTEGRATION_ID,
        conn.nango_connection_id
      );

      // 0. SAFETY GATE: ensure an immutable baseline backup exists before any write to HubSpot.
      // Reads (pull / readiness below) are safe regardless; only the push is gated.
      const baseline = await ensureBaselineSnapshot(admin, { userId: conn.user_id, accessToken });

      // 1. Push enriched contacts back to HubSpot (skipped if the baseline couldn't be secured)
      const pushResult = baseline.ok
        ? await pushUserToHubSpot(conn.user_id, accessToken, admin)
        : { contacts: { upserted: 0, errors: 0, errorDetails: [`push skipped — ${baseline.reason}`] }, companies: { updated: 0, errors: 0, errorDetails: [] }, skippedContacts: [] };

      // 2. Pull new contacts from HubSpot
      const pullResult = await pullNewFromHubSpot(conn.user_id, accessToken, admin);

      // 3. Poll HubSpot contacts and emit readiness events
      const contactSignalResult = await syncHubSpotContactsIntoReadiness(admin, {
        userId: conn.user_id,
        accessToken,
      });

      // 4. Poll HubSpot deals and emit readiness events
      const dealResult = await syncHubSpotDealsIntoReadiness(admin, {
        userId: conn.user_id,
        nangoConnectionId: conn.nango_connection_id,
      });

      // 5. Refresh the CRM suppression sort key (closed-won/lost → bottom of the
      // contacts + accounts lists). Also re-evaluates cooldown expiry daily.
      await denormalizeCrmSuppressionState(admin, conn.user_id);

      const now = new Date().toISOString();
      await Promise.all([
        admin.from('hubspot_sync_log').upsert({
          user_id: conn.user_id,
          synced_at: now,
          contacts_synced: pushResult.contacts.upserted,
          contacts_errors: pushResult.contacts.errors,
          contacts_skipped: pushResult.skippedContacts.length,
          skipped_contacts: pushResult.skippedContacts,
          last_error_details: pushResult.contacts.errorDetails,
          auto_pull_count: pullResult.pulled,
          auto_pull_at: now,
        }, { onConflict: 'user_id' }),
        admin.from('hubspot_sync_events').insert({
          user_id: conn.user_id,
          event_type: 'full',
          created_at: now,
          contacts_synced: pushResult.contacts.upserted,
          contacts_errors: pushResult.contacts.errors,
          contacts_skipped: pushResult.skippedContacts.length,
          skipped_contacts: pushResult.skippedContacts,
          error_details: pushResult.contacts.errorDetails,
          companies_updated: pushResult.companies.updated ?? 0,
          pull_count: pullResult.pulled,
          crm_contacts_fetched: contactSignalResult.fetchedContacts,
          crm_contacts_mirrored: contactSignalResult.mirroredContacts,
          contact_events_emitted: contactSignalResult.emittedEvents,
          contact_context_only_events: contactSignalResult.contextOnlyEvents,
          crm_recomputed_companies: contactSignalResult.recomputedCompanies + dealResult.recomputedCompanies,
          crm_unresolved_count: contactSignalResult.skippedUnresolvedCompanies + dealResult.skippedUnresolvedCompanies,
          contact_signal_types: contactSignalResult.emittedSignalTypes,
          contact_context_signal_types: contactSignalResult.contextOnlySignalTypes,
          deal_signal_types: dealResult.emittedSignalTypes,
          deals_fetched: dealResult.fetchedDeals,
          deals_mirrored: dealResult.mirroredDeals,
          deal_events_emitted: dealResult.emittedEvents,
        }),
      ]);

      results.push({
        userId: conn.user_id,
        pushed: { contacts: pushResult.contacts.upserted, companies: pushResult.companies.updated ?? 0 },
        pulled: pullResult.pulled,
        contactSignals: {
          fetched: contactSignalResult.fetchedContacts,
          mirrored: contactSignalResult.mirroredContacts,
          emittedEvents: contactSignalResult.emittedEvents,
          recomputedCompanies: contactSignalResult.recomputedCompanies,
          contextOnlyEvents: contactSignalResult.contextOnlyEvents,
          skippedUnresolvedCompanies: contactSignalResult.skippedUnresolvedCompanies,
          checkpoint: contactSignalResult.checkpoint,
        },
        deals: {
          fetched: dealResult.fetchedDeals,
          mirrored: dealResult.mirroredDeals,
          emittedEvents: dealResult.emittedEvents,
          recomputedCompanies: dealResult.recomputedCompanies,
          skippedUnresolvedCompanies: dealResult.skippedUnresolvedCompanies,
          checkpoint: dealResult.checkpoint,
        },
      });

      console.log(
        `[cron] user=${conn.user_id} pushed=${pushResult.contacts.upserted} pulled=${pullResult.pulled} crm_contacts=${contactSignalResult.fetchedContacts}/${contactSignalResult.emittedEvents} deals_fetched=${dealResult.fetchedDeals} deal_events=${dealResult.emittedEvents}`
      );
    } catch (err) {
      const message = messageFromUnknown(err);
      console.error(`[cron] Failed for user ${conn.user_id}:`, message);
      results.push({ userId: conn.user_id, error: message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

export const GET = observeCron('hubspot-daily', runCron);
