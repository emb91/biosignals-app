import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type HubspotSyncLogLastPullBatch = {
  total_rows: number;
  duplicate_rows: number;
  failed_rows: number;
  processed_rows: number;
};

type HubspotSyncLogResponse = {
  synced_at: string | null;
  auto_pull_at: string | null;
  auto_pull_count: number | null;
  contacts_synced: number | null;
  contacts_errors: number | null;
  contacts_skipped: number | null;
  skipped_contacts: unknown[];
  last_error_details: string[];
  last_pull_batch: HubspotSyncLogLastPullBatch | null;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: log, error: logError }, { data: pullBatchRow }] = await Promise.all([
    supabase
      .from('hubspot_sync_log')
      .select(
        'synced_at, auto_pull_at, auto_pull_count, contacts_synced, contacts_errors, contacts_skipped, skipped_contacts, last_error_details',
      )
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('upload_batches')
      .select('total_rows, duplicate_rows, failed_rows, processed_rows')
      .eq('user_id', user.id)
      .ilike('filename', 'hubspot-auto-%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  const last_pull_batch: HubspotSyncLogLastPullBatch | null = pullBatchRow
    ? {
        total_rows: pullBatchRow.total_rows ?? 0,
        duplicate_rows: pullBatchRow.duplicate_rows ?? 0,
        failed_rows: pullBatchRow.failed_rows ?? 0,
        processed_rows: pullBatchRow.processed_rows ?? 0,
      }
    : null;

  if (!log && !last_pull_batch) {
    return NextResponse.json({ data: null });
  }

  const base = log ?? {
    synced_at: null,
    auto_pull_at: null,
    auto_pull_count: null,
    contacts_synced: null,
    contacts_errors: null,
    contacts_skipped: null,
    skipped_contacts: null as unknown[] | null,
    last_error_details: null as unknown[] | null,
  };

  const skippedRaw = base.skipped_contacts;
  const skipped_contacts = Array.isArray(skippedRaw) ? skippedRaw : [];
  const errorRaw = base.last_error_details;
  const last_error_details = Array.isArray(errorRaw)
    ? errorRaw.filter((item): item is string => typeof item === 'string')
    : [];

  const payload: HubspotSyncLogResponse = {
    synced_at: base.synced_at ?? null,
    auto_pull_at: base.auto_pull_at ?? null,
    auto_pull_count: base.auto_pull_count ?? null,
    contacts_synced: base.contacts_synced ?? null,
    contacts_errors: base.contacts_errors ?? null,
    contacts_skipped: base.contacts_skipped ?? null,
    skipped_contacts,
    last_error_details,
    last_pull_batch,
  };

  return NextResponse.json({ data: payload });
}
