import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';
import { refreshMonitoringUniverse } from '@/lib/billing/monitoring';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const [operations, evidence, backups] = await Promise.all([
    admin.rpc('launch_operational_readiness_report'),
    admin.rpc('paid_launch_evidence_report'),
    admin.rpc('backup_readiness_report'),
  ]);
  if (operations.error || evidence.error || backups.error) {
    console.error(
      '[admin/launch-readiness] report failed:',
      operations.error ?? evidence.error ?? backups.error,
    );
    return NextResponse.json({ error: 'Could not generate launch report' }, { status: 500 });
  }

  return NextResponse.json(
    {
      ...(operations.data as Record<string, unknown>),
      paidLaunchEvidence: evidence.data,
      backups: backups.data,
    },
    {
    headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function POST() {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: organizations, error } = await admin
    .from('organizations')
    .select('id, name')
    .is('archived_at', null);
  if (error) {
    return NextResponse.json({ error: 'Could not load workspaces' }, { status: 500 });
  }

  const results = [];
  for (const organization of organizations ?? []) {
    try {
      results.push({
        orgId: organization.id,
        name: organization.name,
        ...(await refreshMonitoringUniverse(organization.id)),
      });
    } catch (reason) {
      results.push({
        orgId: organization.id,
        name: organization.name,
        error: reason instanceof Error ? reason.message : 'Refresh failed',
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
