import { createAdminClient } from '@/lib/supabase-admin';
import { runCompanyMonitor } from '@/lib/company-monitor';
import { emitExternalCompanySignalsFromMonitor } from '@/lib/signals/readiness-external-companies';

type CompanyRow = {
  id: string;
  company_name: string | null;
  domain?: string | null;
  website?: string | null;
};

export type ExternalCompanyMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
};

export type ExternalCompanyMonitorResult = {
  processed: number;
  failed: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

export async function runExternalCompanyMonitor(
  input: ExternalCompanyMonitorInput,
): Promise<ExternalCompanyMonitorResult> {
  const admin = createAdminClient();

  const query = admin
    .from('companies')
    .select('id, company_name, domain, website')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .order('funding_checked_at', { ascending: true, nullsFirst: true });

  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];

  if (companyIds.length > 0) {
    query.in('id', companyIds);
  } else {
    query.limit(Math.min(Math.max(input.limit ?? 25, 1), 100));
  }

  const { data: companies, error: companiesError } = await query;
  if (companiesError) {
    throw new Error(companiesError.message);
  }

  let processed = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) {
      continue;
    }

    try {
      const monitorResult = await runCompanyMonitor(
        admin as unknown as Parameters<typeof runCompanyMonitor>[0],
        {
          company_id: row.id,
          company_name: companyName,
          domain: row.domain ?? null,
          website: row.website ?? null,
        },
      );

      const signalResult = await emitExternalCompanySignalsFromMonitor(
        admin as unknown as Parameters<typeof emitExternalCompanySignalsFromMonitor>[0],
        {
          baseline: {
            userId: input.userId,
            companyId: row.id,
            companyName,
            domain: row.domain ?? null,
          },
          monitorResult,
        },
      );

      processed += 1;
      for (const signalType of signalResult.emittedSignalTypes ?? []) emittedSignalTypes.add(signalType);
      for (const companyId of signalResult.recomputedCompanies ?? []) recomputedCompanyIds.add(companyId);
    } catch (error) {
      failed += 1;
      failures.push({ company_id: row.id, error: messageFromUnknown(error) });
    }
  }

  return {
    processed,
    failed,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
