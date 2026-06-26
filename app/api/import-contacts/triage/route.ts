import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { refundCredits, reserveCredits, settleCredits } from '@/lib/billing/credits';
import { triageContacts, TRIAGE_VERSION } from '@/lib/triage';
import { withTriageReason } from '@/lib/triage-result';
import { WORKSPACE_REQUIRED_ERROR } from '@/lib/org-context';

export async function POST(request: Request) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as {
    rawUploadIds?: unknown;
    confirm?: boolean;
    operationId?: string;
  };
  const ids = Array.isArray(body.rawUploadIds)
    ? [...new Set(body.rawUploadIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (!ids.length) return NextResponse.json({ error: 'rawUploadIds required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', user.id).maybeSingle<{ org_id: string }>();
  if (!member?.org_id) return NextResponse.json(WORKSPACE_REQUIRED_ERROR, { status: 409 });

  const { data: rows, error } = await admin.from('raw_uploads')
    .select('id, job_title, company_name, email, raw_data')
    .eq('user_id', user.id)
    .eq('org_id', member.org_id)
    .in('id', ids)
    .eq('status', 'awaiting_triage');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ error: 'No records are awaiting triage' }, { status: 404 });
  const estimate = { eligibleRecords: rows.length, estimatedCredits: rows.length * 0.1 };
  if (!body.confirm) return NextResponse.json({ preflight: estimate });

  const reservation = await reserveCredits({
    orgId: member.org_id,
    userId: user.id,
    action: 'import_triage_overflow',
    credits: 0.1,
    quantity: rows.length,
    idempotencyKey: `import-triage-overflow:${body.operationId?.trim() || crypto.randomUUID()}`,
  });
  if (!reservation.ok) return NextResponse.json(reservation, { status: 402 });

  try {
    const results = await triageContacts(rows.map((row) => ({
      id: row.id as string,
      job_title: row.job_title as string | null,
      company_name: row.company_name as string | null,
      email: row.email as string | null,
    })));
    const now = new Date().toISOString();
    for (const row of rows) {
      const result = results.get(row.id as string);
      if (!result) continue;
      await admin.from('raw_uploads').update({
        triage_group: result.group,
        triage_version: result.version ?? TRIAGE_VERSION,
        triage_scored_at: now,
        raw_data: withTriageReason(
          (row.raw_data as Record<string, unknown> | null) ?? null,
          result.reason,
        ),
        status: 'awaiting_enrichment',
      }).eq('id', row.id).eq('org_id', member.org_id);
    }
    const completed = rows.filter((row) => results.has(row.id as string)).length;
    await settleCredits(reservation.transactionId, completed * 0.1);
    return NextResponse.json({ success: true, triaged: completed, ...estimate });
  } catch (caught) {
    await refundCredits(reservation.transactionId);
    return NextResponse.json({
      error: caught instanceof Error ? caught.message : 'Triage failed',
    }, { status: 500 });
  }
}
