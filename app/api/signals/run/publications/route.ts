export const maxDuration = 300;

/**
 * Manual trigger for the publications signal pipeline.
 *
 * Searches PubMed (NCBI E-utilities) for papers published in the last
 * `lookback_days` (default 30) that:
 *   (a) list one of the user's companies as an author affiliation, OR
 *   (b) include one of the user's contacts as a named author, cross-checked
 *       against the contact's company affiliation to reduce false positives.
 *
 * Emits:
 *   `publication`        for company affiliation matches (scope: company)
 *   `new_paper_published` for contact author matches     (scope: contact)
 *
 * Unlike press releases, there's no sync step — each run queries PubMed live.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { persistRunHistory } from '@/lib/signals/run-history';
import { runPublicationsMonitor } from '@/lib/signals/run-publications-monitor';

type RunPublicationsBody = {
  company_ids?: string[];
  contact_ids?: string[];
  lookback_days?: number;
  max_per_company?: number;
  max_per_contact?: number;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return 'Internal server error';
}

export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as RunPublicationsBody;
    const lookbackDays = typeof body.lookback_days === 'number' ? Math.max(1, body.lookback_days) : 30;
    const maxPerCompany = typeof body.max_per_company === 'number' ? body.max_per_company : 20;
    const maxPerContact = typeof body.max_per_contact === 'number' ? body.max_per_contact : 10;
    const requestedCompanyIds = Array.isArray(body.company_ids)
      ? body.company_ids.filter((v): v is string => typeof v === 'string' && Boolean(v))
      : [];
    const requestedContactIds = Array.isArray(body.contact_ids)
      ? body.contact_ids.filter((v): v is string => typeof v === 'string' && Boolean(v))
      : [];

    const admin = createAdminClient();

    const result = await runPublicationsMonitor({
      userId: user.id,
      companyIds: requestedCompanyIds.length > 0 ? requestedCompanyIds : undefined,
      contactIds: requestedContactIds.length > 0 ? requestedContactIds : undefined,
      lookbackDays,
      maxPerCompany,
      maxPerContact,
    });

    // Record to signals_run_history (company scope covers companies;
    // contact signals are tracked in the emitted_signal_types array).
    await persistRunHistory(admin, {
      userId: user.id,
      signalKey: 'publications_all',
      runner: 'publications',
      scope: 'company',
      status: result.companies_failed + result.contacts_failed > 0 ? 'failed' : 'success',
      processed: result.companies_processed + result.contacts_processed,
      failed: result.companies_failed + result.contacts_failed,
      emittedSignalTypes: result.emitted_signal_types,
      recomputedCompanies: result.recomputed_companies,
      failures: result.failures.map((f) => ({
        entity_type: f.entity_type,
        entity_id: f.entity_id,
        error: f.error,
      })),
      companyIds: requestedCompanyIds,
      contactIds: requestedContactIds,
      trigger: 'button',
    });

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('[signals/run/publications] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
