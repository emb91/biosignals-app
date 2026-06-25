import { createAdminClient } from '@/lib/supabase-admin';
import { runContactResolutionPipelineForContact } from '@/lib/enrichment-pipeline';

type ContactRow = {
  id: string;
  enrichment_refresh_status?: string | null;
  linkedin_resolution_status?: string | null;
  profile_enrichment_status?: string | null;
};

export type ExternalContactMonitorInput = {
  userId: string;
  contactIds?: string[];
  limit?: number;
};

export type ExternalContactMonitorResult = {
  processed: number;
  skipped_running: number;
  failed: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ contact_id: string; error: string }>;
};

function emptyExternalContactMonitorResult(): ExternalContactMonitorResult {
  return {
    processed: 0,
    skipped_running: 0,
    failed: 0,
    emitted_signal_types: [],
    recomputed_companies: [],
    failures: [],
  };
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

function isRunning(row: ContactRow): boolean {
  if ((row.enrichment_refresh_status || '') === 'running') return true;
  return (
    ['pending', 'processing'].includes(row.linkedin_resolution_status || '') ||
    ['pending', 'processing'].includes(row.profile_enrichment_status || '')
  );
}

export async function runExternalContactMonitor(
  input: ExternalContactMonitorInput,
): Promise<ExternalContactMonitorResult> {
  const admin = createAdminClient();
  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', input.userId).maybeSingle<{ org_id: string }>();
  if (!member?.org_id) {
    console.warn(`[external-contact-monitor] skipping user ${input.userId}: workspace not found`);
    return emptyExternalContactMonitorResult();
  }

  const query = admin
    .from('contacts')
    .select('id, enrichment_refresh_status, linkedin_resolution_status, profile_enrichment_status')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .order('last_enriched_at', { ascending: true, nullsFirst: true });

  const contactIds = Array.isArray(input.contactIds)
    ? input.contactIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];

  if (contactIds.length > 0) {
    query.in('id', contactIds);
  } else {
    query.limit(Math.min(Math.max(input.limit ?? 25, 1), 100));
  }

  const { data: contacts, error: contactsError } = await query;
  if (contactsError) {
    throw new Error(contactsError.message);
  }

  let processed = 0;
  let skippedRunning = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ contact_id: string; error: string }> = [];

  for (const row of (contacts ?? []) as ContactRow[]) {
    if (isRunning(row)) {
      skippedRunning += 1;
      continue;
    }

    try {
      const result = await runContactResolutionPipelineForContact(
        admin as unknown as Parameters<typeof runContactResolutionPipelineForContact>[0],
        {
          contactId: row.id,
          userId: input.userId,
          emitExternalSignals: true,
        },
      );

      processed += 1;
      for (const signalType of result.emittedSignalTypes ?? []) emittedSignalTypes.add(signalType);
      for (const companyId of result.recomputedCompanyIds ?? []) recomputedCompanyIds.add(companyId);
    } catch (error) {
      failed += 1;
      failures.push({ contact_id: row.id, error: messageFromUnknown(error) });
    }
  }

  return {
    processed,
    skipped_running: skippedRunning,
    failed,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
