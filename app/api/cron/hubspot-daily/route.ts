/**
 * Daily HubSpot auto-sync — runs on a Vercel cron schedule.
 *
 * For every user who has HubSpot connected it will:
 *   1. PUSH: upsert all scored Arcova contacts back to HubSpot (idempotent).
 *   2. PULL: fetch HubSpot contacts that haven't been enriched yet (arcova_enriched_at
 *      is unset), create an import batch, and kick off background enrichment.
 *
 * Protected by CRON_SECRET — Vercel automatically passes this as
 * `Authorization: Bearer <CRON_SECRET>` when invoking cron routes.
 */
import { after, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { nango, HUBSPOT_INTEGRATION_ID } from '@/lib/nango';
import {
  ensureArcovaHubSpotProperties,
  batchUpsertContacts,
  getContactAssociatedCompanyIds,
  batchUpdateCompanies,
  batchReadContactsByEmail,
  fetchUnenrichedHubSpotContacts,
} from '@/lib/hubspot';
import { processQueuedRowsInBackground, type QueuedRow } from '@/lib/import-queue';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPRIORITIZE_COMPANY_BELOW = 0.45;
const SOURCE_COMPANY_MIN = 0.5;
const SOURCE_CONTACT_MAX = 0.65;

function computeAction(companyFit: number | null, contactFit: number | null): string {
  if (companyFit === null || companyFit < DEPRIORITIZE_COMPANY_BELOW) return 'Deprioritise';
  if (companyFit >= SOURCE_COMPANY_MIN && (contactFit === null || contactFit < SOURCE_CONTACT_MAX)) {
    return 'Source contact';
  }
  return 'Monitor';
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '';
  return (Math.round(n * 1000) / 1000).toString();
}

function fmtList(arr: string[] | null | undefined): string {
  if (!arr?.length) return '';
  return arr.join('; ');
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
): Promise<{ contacts: { upserted: number; errors: number }; companies: { updated: number; errors: number } }> {
  const { data: leads } = await admin
    .from('contacts')
    .select(`
      id, email, first_name, last_name, job_title, seniority_level, business_area,
      contact_fit_score, overall_fit_score, contact_bio, linkedin_url,
      companies(
        company_name, company_fit_score, modalities, therapeutic_areas, development_stages,
        company_type, platform_category, bio_summary, industry, employee_count,
        founded_year, headquarters_city, headquarters_country, linkedin_url,
        funding_stage, funding_status_label, total_funding_usd
      )
    `)
    .eq('user_id', userId)
    .not('overall_fit_score', 'is', null);

  if (!leads?.length) return { contacts: { upserted: 0, errors: 0 }, companies: { updated: 0, errors: 0 } };

  await ensureArcovaHubSpotProperties(accessToken);

  const enrichedAt = new Date().toISOString().slice(0, 10);

  const upserts: Array<{ email: string; properties: Record<string, string> }> = [];

  for (const lead of leads) {
    if (!lead.email?.trim()) continue;

    const co = lead.companies as any;
    const companyFit = co?.company_fit_score ?? null;
    const contactFit = typeof lead.contact_fit_score === 'number' ? lead.contact_fit_score : null;
    const overallFit = lead.overall_fit_score ?? null;
    const action = computeAction(companyFit, contactFit);

    const props: Record<string, string> = {
      arcova_action: action,
      arcova_enriched_at: enrichedAt,
    };

    if (overallFit !== null) props.arcova_overall_fit_score = fmt(overallFit);
    if (contactFit !== null) props.arcova_contact_fit_score = fmt(contactFit);
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

    upserts.push({ email: lead.email!.toLowerCase(), properties: props });
  }

  if (!upserts.length) return { contacts: { upserted: 0, errors: 0 }, companies: { updated: 0, errors: 0 } };

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
    const companyFit = co?.company_fit_score ?? null;
    if (companyFit !== null) props.arcova_company_fit_score = fmt(companyFit);
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
    : { updated: 0, errors: 0 };

  return { contacts: contactResult, companies: companyResult };
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

export async function GET(request: Request) {
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
    error?: string;
  }> = [];

  for (const conn of connections) {
    try {
      const accessToken = await nango.getToken(
        HUBSPOT_INTEGRATION_ID,
        conn.nango_connection_id
      ) as string;

      // 1. Push enriched contacts back to HubSpot
      const pushResult = await pushUserToHubSpot(conn.user_id, accessToken, admin);

      // 2. Pull new contacts from HubSpot
      const pullResult = await pullNewFromHubSpot(conn.user_id, accessToken, admin);

      // Update sync log
      await admin.from('hubspot_sync_log').upsert({
        user_id: conn.user_id,
        synced_at: new Date().toISOString(),
        contacts_synced: pushResult.contacts.upserted,
        contacts_errors: pushResult.contacts.errors,
        contacts_skipped: 0,
        skipped_contacts: [],
        auto_pull_count: pullResult.pulled,
        auto_pull_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      results.push({
        userId: conn.user_id,
        pushed: { contacts: pushResult.contacts.upserted, companies: pushResult.companies.updated ?? 0 },
        pulled: pullResult.pulled,
      });

      console.log(`[cron] user=${conn.user_id} pushed=${pushResult.contacts.upserted} pulled=${pullResult.pulled}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron] Failed for user ${conn.user_id}:`, message);
      results.push({ userId: conn.user_id, error: message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
