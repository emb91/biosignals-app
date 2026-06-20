import { createAdminClient } from '@/lib/supabase-admin';
import * as Sentry from '@sentry/nextjs';

type CronHandler = (request: Request) => Promise<Response>;

export function observeCron(jobName: string, handler: CronHandler): CronHandler {
  return async (request: Request) => {
    const expected = process.env.CRON_SECRET;
    if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
      return handler(request);
    }

    const startedAt = Date.now();
    const admin = createAdminClient();
    let runId: string | null = null;
    try {
      const { data } = await admin
        .from('cron_run_history')
        .insert({
          job_name: jobName,
          invocation_id:
            request.headers.get('x-vercel-id') ??
            request.headers.get('x-request-id') ??
            crypto.randomUUID(),
        })
        .select('id')
        .maybeSingle<{ id: string }>();
      runId = data?.id ?? null;
    } catch {
      // Observability must not prevent the scheduled job from running.
    }

    try {
      const response = await handler(request);
      const summary = await response.clone().json().catch(() => ({}));
      const logicalFailure = responseContainsFailure(summary);
      const succeeded = response.ok && !logicalFailure;
      await finishRun(runId, {
        status: succeeded ? 'succeeded' : 'failed',
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        summary: sanitizeSummary(summary),
        error: succeeded ? null : responseError(summary) ?? 'Cron response contained failures',
      });
      if (!succeeded) {
        Sentry.captureMessage(`Cron ${jobName} returned HTTP ${response.status}`, {
          level: 'error',
          tags: { job: jobName },
          extra: { status: response.status, summary: sanitizeSummary(summary) },
        });
      }
      return response;
    } catch (error) {
      await finishRun(runId, {
        status: 'failed',
        http_status: 500,
        duration_ms: Date.now() - startedAt,
        summary: {},
        error: error instanceof Error ? error.message.slice(0, 1_000) : 'Unknown cron error',
      });
      Sentry.captureException(error, { tags: { job: jobName } });
      throw error;
    }
  };
}

async function finishRun(
  runId: string | null,
  values: {
    status: 'succeeded' | 'failed';
    http_status: number;
    duration_ms: number;
    summary: Record<string, unknown>;
    error: string | null;
  },
) {
  if (!runId) return;
  try {
    await createAdminClient()
      .from('cron_run_history')
      .update({ ...values, finished_at: new Date().toISOString() })
      .eq('id', runId);
  } catch {
    // Best effort only.
  }
}

function sanitizeSummary(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const blocked = /email|phone|name|token|secret|payload|contact|person/i;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blocked.test(key))
      .slice(0, 30)
      .map(([key, item]) => [key, sanitizeValue(item)]),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value === 'string' ? value.slice(0, 300) : value;
  }
  if (Array.isArray(value)) return { count: value.length };
  return '[object]';
}

function responseError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === 'string' ? error.slice(0, 1_000) : null;
}

function responseContainsFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (row.ok === false || row.success === false) return true;
  if (typeof row.failed === 'number' && row.failed > 0) return true;
  if (Array.isArray(row.failures) && row.failures.length > 0) return true;
  if (Array.isArray(row.results)) {
    return row.results.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        ('error' in item || (item as Record<string, unknown>).ok === false),
    );
  }
  return typeof row.error === 'string' && row.error.length > 0;
}
