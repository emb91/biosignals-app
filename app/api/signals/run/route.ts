import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runExternalContactMonitor } from '@/lib/signals/run-external-contact-monitor';
import { runExternalCompanyMonitor } from '@/lib/signals/run-external-company-monitor';

type RunSignalsBody = {
  contact_ids?: string[];
  company_ids?: string[];
  limit?: number;
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

    const body = (await request.json().catch(() => ({}))) as RunSignalsBody;
    const [contactResult, companyResult] = await Promise.all([
      runExternalContactMonitor({
        userId: user.id,
        contactIds: body.contact_ids,
        limit: body.limit,
      }),
      runExternalCompanyMonitor({
        userId: user.id,
        companyIds: body.company_ids,
        limit: body.limit,
      }),
    ]);

    const result = {
      contact_processed: contactResult.processed,
      contact_skipped_running: contactResult.skipped_running,
      company_processed: companyResult.processed,
      processed: contactResult.processed + companyResult.processed,
      skipped_running: contactResult.skipped_running,
      failed: contactResult.failed + companyResult.failed,
      emitted_signal_types: [...new Set([...contactResult.emitted_signal_types, ...companyResult.emitted_signal_types])],
      recomputed_companies: [...new Set([...contactResult.recomputed_companies, ...companyResult.recomputed_companies])],
      failures: [
        ...contactResult.failures.map((failure) => ({
          entity_type: 'contact',
          entity_id: failure.contact_id,
          error: failure.error,
        })),
        ...companyResult.failures.map((failure) => ({
          entity_type: 'company',
          entity_id: failure.company_id,
          error: failure.error,
        })),
      ],
    };

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('[signals/run] error:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
