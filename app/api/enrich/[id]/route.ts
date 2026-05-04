import { after, NextResponse } from 'next/server';
import { runContactResolutionPipelineForContact } from '@/lib/contact-resolution-pipeline';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

type ContactJobRow = {
  id: string;
  enrichment_refresh_status?: string | null;
  linkedin_resolution_status: string | null;
  profile_enrichment_status: string | null;
};

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';

  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  return [candidate.message, candidate.details, candidate.hint]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' | ');
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const message = getErrorMessage(error);
  return message.includes('column') && message.includes('does not exist') && message.includes(columnName);
}

const CONTACT_REFRESH_JOB_COLUMNS = [
  'enrichment_refresh_status',
  'enrichment_refresh_last_error',
  'enrichment_refresh_started_at',
  'enrichment_refresh_finished_at',
];

function isMissingContactRefreshJobColumnError(error: unknown): boolean {
  return CONTACT_REFRESH_JOB_COLUMNS.some((columnName) => isMissingColumnError(error, columnName));
}

function isLeadEnrichmentRunning(row: ContactJobRow | null): boolean {
  if (!row) return false;

  if ((row.enrichment_refresh_status || '') === 'running') {
    return true;
  }

  return (
    ['pending', 'processing'].includes(row.linkedin_resolution_status || '') ||
    ['pending', 'processing'].includes(row.profile_enrichment_status || '')
  );
}

function applyStatusMatch<TQuery extends {
  eq: (column: string, value: string) => TQuery;
  is: (column: string, value: null) => TQuery;
}>(
  query: TQuery,
  column: string,
  value: string | null | undefined,
): TQuery {
  if (value == null) {
    return query.is(column, null);
  }

  return query.eq(column, value);
}

async function loadContactJobRow(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  id: string,
): Promise<ContactJobRow | null> {
  const currentResult = await admin
    .from('contacts')
    .select('id, enrichment_refresh_status, linkedin_resolution_status, profile_enrichment_status')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();

  if (currentResult.error && isMissingColumnError(currentResult.error, 'enrichment_refresh_status')) {
    const legacyResult = await admin
      .from('contacts')
      .select('id, linkedin_resolution_status, profile_enrichment_status')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle();

    if (legacyResult.error) {
      throw legacyResult.error;
    }

    return (legacyResult.data as ContactJobRow | null) ?? null;
  }

  if (currentResult.error) {
    throw currentResult.error;
  }

  return (currentResult.data as ContactJobRow | null) ?? null;
}

async function claimLeadRefreshWithoutDedicatedJobStatus(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    userId: string;
    id: string;
    now: string;
  },
): Promise<'claimed' | 'already_running' | 'not_found'> {
  const current = await loadContactJobRow(admin, params.userId, params.id);

  if (!current) {
    return 'not_found';
  }

  if (isLeadEnrichmentRunning(current)) {
    return 'already_running';
  }

  let claimQuery = admin
    .from('contacts')
    .update({
      linkedin_resolution_status: 'processing',
      linkedin_resolution_started_at: params.now,
      linkedin_resolution_completed_at: null,
      linkedin_resolution_last_error: null,
      profile_enrichment_status: 'pending',
      profile_enrichment_started_at: null,
      profile_enrichment_completed_at: null,
      profile_enrichment_last_error: null,
      updated_at: params.now,
    })
    .eq('user_id', params.userId)
    .eq('id', params.id);

  claimQuery = applyStatusMatch(
    claimQuery,
    'linkedin_resolution_status',
    current.linkedin_resolution_status,
  );
  claimQuery = applyStatusMatch(
    claimQuery,
    'profile_enrichment_status',
    current.profile_enrichment_status,
  );

  const { data, error } = await claimQuery.select('id');

  if (error) {
    throw error;
  }

  if ((data || []).length > 0) {
    return 'claimed';
  }

  const latest = await loadContactJobRow(admin, params.userId, params.id);
  if (!latest) {
    return 'not_found';
  }

  if (isLeadEnrichmentRunning(latest)) {
    return 'already_running';
  }

  throw new Error('Unable to claim lead enrichment job');
}

async function claimLeadRefreshJob(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    userId: string;
    id: string;
    now: string;
  },
): Promise<'claimed' | 'already_running' | 'not_found'> {
  const current = await loadContactJobRow(admin, params.userId, params.id);

  if (!current) {
    return 'not_found';
  }

  if ((current.enrichment_refresh_status || '') === 'running' || isLeadEnrichmentRunning(current)) {
    return 'already_running';
  }

  let claimQuery = admin
    .from('contacts')
    .update({
      linkedin_resolution_status: 'processing',
      linkedin_resolution_started_at: params.now,
      linkedin_resolution_completed_at: null,
      linkedin_resolution_last_error: null,
      profile_enrichment_status: 'pending',
      profile_enrichment_started_at: null,
      profile_enrichment_completed_at: null,
      profile_enrichment_last_error: null,
      enrichment_refresh_status: 'running',
      enrichment_refresh_last_error: null,
      enrichment_refresh_started_at: params.now,
      enrichment_refresh_finished_at: null,
      updated_at: params.now,
    })
    .eq('user_id', params.userId)
    .eq('id', params.id);

  claimQuery = applyStatusMatch(
    claimQuery,
    'enrichment_refresh_status',
    current.enrichment_refresh_status,
  );

  const claimResult = await claimQuery.select(
    'id, enrichment_refresh_status, linkedin_resolution_status, profile_enrichment_status',
  );

  if (claimResult.error && isMissingContactRefreshJobColumnError(claimResult.error)) {
    return claimLeadRefreshWithoutDedicatedJobStatus(admin, params);
  }

  if (claimResult.error) {
    throw claimResult.error;
  }

  if ((claimResult.data || []).length > 0) {
    return 'claimed';
  }

  const latest = await loadContactJobRow(admin, params.userId, params.id);
  if (!latest) {
    return 'not_found';
  }

  if ((latest.enrichment_refresh_status || '') === 'running' || isLeadEnrichmentRunning(latest)) {
    return 'already_running';
  }

  throw new Error('Unable to claim lead enrichment job');
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const claimState = await claimLeadRefreshJob(admin, {
      userId: user.id,
      id,
      now,
    });

    if (claimState === 'claimed') {
      const backgroundTask = () =>
        runContactResolutionPipelineForContact(admin, {
          contactId: id,
          userId: user.id,
        });

      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          void backgroundTask();
        }, 0);
      } else {
        after(backgroundTask);
      }

      return NextResponse.json(
        {
          ok: true,
          alreadyRunning: false,
        },
        { status: 202 },
      );
    }

    if (claimState === 'not_found') {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        alreadyRunning: true,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error('Error in enrich POST:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
