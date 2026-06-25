import { NextResponse } from 'next/server';
import { getOrgContext, scopeIcpsToUser } from '@/lib/org-context';
import { ROUTES, withQuery } from '@/lib/routes';
import { createAdminClient } from '@/lib/supabase-admin';
import { listOrgContactAccesses } from '@/lib/org-contact-access';

type EnrichmentJob = {
  id: string;
  kind: 'icp' | 'lead';
  status: 'running' | 'failed';
  title: string;
  subtitle: string | null;
  href: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
};

function getContactName(row: Record<string, unknown>): string {
  const fullName = typeof row.full_name === 'string' ? row.full_name.trim() : '';
  if (fullName) return fullName;

  const firstName = typeof row.first_name === 'string' ? row.first_name.trim() : '';
  const lastName = typeof row.last_name === 'string' ? row.last_name.trim() : '';
  const joined = [firstName, lastName].filter(Boolean).join(' ').trim();

  return joined || 'Imported contact';
}

function getCompanyName(row: Record<string, unknown>): string | null {
  const resolvedCompany =
    typeof row.resolved_current_company_name === 'string'
      ? row.resolved_current_company_name.trim()
      : '';
  if (resolvedCompany) return resolvedCompany;

  const company = typeof row.company_name === 'string' ? row.company_name.trim() : '';
  return company || null;
}

function sortJobs(a: EnrichmentJob, b: EnrichmentJob): number {
  const aTime = new Date(a.started_at || a.finished_at || 0).getTime();
  const bTime = new Date(b.started_at || b.finished_at || 0).getTime();
  return bTime - aTime;
}

function chunkValues<T>(values: T[], size: number = 500): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

export async function GET() {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const contactAccesses = await listOrgContactAccesses({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      admin,
    });
    const contactIds = contactAccesses.map((access) => access.contactId);
    const icpResult = await scopeIcpsToUser(
      ctx.supabase
        .from('icps')
        .select('id, name, reenrichment_status, reenrichment_last_error, reenrichment_started_at, reenrichment_finished_at'),
      ctx.orgId,
      ctx.user.id,
    ).in('reenrichment_status', ['running', 'failed']);

    if (icpResult.error) throw icpResult.error;

    const contactRows: Array<Record<string, unknown>> = [];
    for (const contactIdChunk of chunkValues(contactIds)) {
      const { data, error } = await admin
        .from('contacts')
        .select('id, full_name, first_name, last_name, company_name, resolved_current_company_name, enrichment_refresh_status, enrichment_refresh_last_error, enrichment_refresh_started_at, enrichment_refresh_finished_at')
        .in('id', contactIdChunk)
        .in('enrichment_refresh_status', ['running', 'failed']);
      if (error) throw error;
      contactRows.push(...((data || []) as Array<Record<string, unknown>>));
    }

    const icpJobs: EnrichmentJob[] = ((icpResult.data || []) as Array<Record<string, unknown>>).map((row) => {
      const status = row.reenrichment_status === 'failed' ? 'failed' : 'running';
      const id = String(row.id);

      return {
        id: `icp:${id}`,
        kind: 'icp',
        status,
        title: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Untitled ICP',
        subtitle: 'ICP re-enrichment',
        href: ROUTES.setup.icps,
        started_at: typeof row.reenrichment_started_at === 'string' ? row.reenrichment_started_at : null,
        finished_at: typeof row.reenrichment_finished_at === 'string' ? row.reenrichment_finished_at : null,
        last_error: typeof row.reenrichment_last_error === 'string' ? row.reenrichment_last_error : null,
      };
    });

    const leadJobs: EnrichmentJob[] = contactRows.map((row) => {
      const status = row.enrichment_refresh_status === 'failed' ? 'failed' : 'running';
      const id = String(row.id);

      return {
        id: `lead:${id}`,
        kind: 'lead',
        status,
        title: getContactName(row),
        subtitle: getCompanyName(row),
        href: withQuery(ROUTES.contacts, `lead=${encodeURIComponent(id)}`),
        started_at: typeof row.enrichment_refresh_started_at === 'string' ? row.enrichment_refresh_started_at : null,
        finished_at: typeof row.enrichment_refresh_finished_at === 'string' ? row.enrichment_refresh_finished_at : null,
        last_error: typeof row.enrichment_refresh_last_error === 'string' ? row.enrichment_refresh_last_error : null,
      };
    });

    const jobs = [...icpJobs, ...leadJobs].sort(sortJobs);

    return NextResponse.json({
      data: jobs,
      hasRunning: jobs.some((job) => job.status === 'running'),
    });
  } catch (error) {
    console.error('Error loading enrichment jobs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
