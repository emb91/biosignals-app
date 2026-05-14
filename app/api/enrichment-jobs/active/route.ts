import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { ROUTES, withQuery } from '@/lib/routes';

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

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [icpResult, contactResult] = await Promise.all([
      supabase
        .from('icps')
        .select('id, name, reenrichment_status, reenrichment_last_error, reenrichment_started_at, reenrichment_finished_at')
        .eq('user_id', user.id)
        .in('reenrichment_status', ['running', 'failed']),
      supabase
        .from('contacts')
        .select('id, full_name, first_name, last_name, company_name, resolved_current_company_name, enrichment_refresh_status, enrichment_refresh_last_error, enrichment_refresh_started_at, enrichment_refresh_finished_at')
        .eq('user_id', user.id)
        .in('enrichment_refresh_status', ['running', 'failed']),
    ]);

    if (icpResult.error) throw icpResult.error;
    if (contactResult.error) throw contactResult.error;

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

    const leadJobs: EnrichmentJob[] = ((contactResult.data || []) as Array<Record<string, unknown>>).map((row) => {
      const status = row.enrichment_refresh_status === 'failed' ? 'failed' : 'running';
      const id = String(row.id);

      return {
        id: `lead:${id}`,
        kind: 'lead',
        status,
        title: getContactName(row),
        subtitle: getCompanyName(row),
        href: withQuery(ROUTES.leads.contacts, `lead=${encodeURIComponent(id)}`),
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
