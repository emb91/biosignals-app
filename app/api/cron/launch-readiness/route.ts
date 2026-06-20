import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { observeCron } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runCron(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const [operations, backups] = await Promise.all([
    admin.rpc('launch_operational_readiness_report'),
    admin.rpc('backup_readiness_report'),
  ]);
  if (operations.error || backups.error) {
    Sentry.captureException(operations.error ?? backups.error, {
      tags: { job: 'launch-readiness' },
    });
    return NextResponse.json({ error: 'readiness report failed' }, { status: 500 });
  }

  const report = operations.data as {
    ready?: boolean;
    checks?: Record<string, number>;
  };
  const backupReport = backups.data as {
    ready?: boolean;
    missingBaselines?: number;
    staleRollingBackups?: number;
    failed24h?: number;
  };
  if (!report.ready || !backupReport.ready) {
    const failing = Object.entries(report.checks ?? {})
      .filter(([, count]) => Number(count) > 0)
      .map(([name, count]) => `${name}=${count}`)
      .join(', ');
    const backupFailure = !backupReport.ready
      ? `backups=${JSON.stringify(backupReport)}`
      : '';
    Sentry.captureMessage(`Arcova launch health check failed: ${[failing, backupFailure].filter(Boolean).join(', ') || 'unknown check'}`, {
      level: 'error',
      tags: { job: 'launch-readiness' },
      extra: { checks: report.checks, backups: backupReport },
    });
    return NextResponse.json(
      { ok: false, checks: report.checks, backups: backupReport },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, checks: report.checks, backups: backupReport });
}

export const GET = observeCron('launch-readiness', runCron);
