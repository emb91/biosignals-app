import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import {
  checkAndIncrementUsage,
  refundCredits,
  reserveCredits,
  settleUsage,
  settleCredits,
} from '@/lib/billing/credits';
import { processQueuedRowsInBackground } from '@/lib/import-queue';

export async function POST(request: Request) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as {
    rawUploadIds?: unknown;
    confirm?: boolean;
    operationId?: string;
  };
  const rawUploadIds = Array.isArray(body.rawUploadIds)
    ? [...new Set(body.rawUploadIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (!rawUploadIds.length) return NextResponse.json({ error: 'rawUploadIds required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', user.id).maybeSingle<{ org_id: string }>();
  if (!member?.org_id) return NextResponse.json({ error: 'Workspace not found' }, { status: 409 });
  const { data: rows, error } = await admin.from('raw_uploads')
    .select('id, batch_id, full_name, email, linkedin_url, company_name, raw_data, status, triage_group')
    .eq('user_id', user.id).in('id', rawUploadIds).eq('status', 'awaiting_enrichment')
    .in('triage_group', ['high', 'medium']);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ error: 'No eligible records found' }, { status: 404 });

  const entitlements = await getOrgEntitlements(member.org_id);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const { data: usageRows } = await admin.from('org_usage_events').select('quantity')
    .eq('org_id', member.org_id).eq('action_type', 'imported_enrichment').gte('occurred_at', monthStart);
  const used = (usageRows ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
  const includedRemaining = Math.max(0, entitlements.caps.importedEnrichmentsIncludedMonthly - used);
  const includedCount = Math.min(includedRemaining, rows.length);
  const purchasedCount = rows.length - includedCount;
  const estimate = {
    eligibleRecords: rows.length,
    estimatedCredits: rows.length * 4,
    includedRecords: includedCount,
    purchasedCreditOnlyRecords: purchasedCount,
    hardCapRemaining: Math.max(0, entitlements.caps.importedEnrichmentsHardCapMonthly - used),
  };
  if (!body.confirm) return NextResponse.json({ preflight: estimate });

  const operationId = body.operationId?.trim() || crypto.randomUUID();
  const usage = await checkAndIncrementUsage({
    orgId: member.org_id,
    userId: user.id,
    action: 'imported_enrichment',
    quantity: rows.length,
    operationKey: operationId,
    limit: entitlements.caps.importedEnrichmentsHardCapMonthly,
    window: 'utc_month',
  });
  if (!usage.ok) return NextResponse.json(usage, { status: 429 });

  const includedReservation = includedCount > 0
    ? await reserveCredits({
        orgId: member.org_id,
        userId: user.id,
        action: 'imported_contact_company_enrichment',
        quantity: includedCount,
        idempotencyKey: `import-enrichment:${operationId}:included`,
      })
    : { ok: true as const, transactionId: null, reserved: 0, idempotent: false };
  if (!includedReservation.ok) return NextResponse.json(includedReservation, { status: 402 });
  const purchasedReservation = purchasedCount > 0
    ? await reserveCredits({
        orgId: member.org_id,
        userId: user.id,
        action: 'imported_contact_company_enrichment',
        quantity: purchasedCount,
        idempotencyKey: `import-enrichment:${operationId}:purchased`,
        purchasedOnly: true,
      })
    : { ok: true as const, transactionId: null, reserved: 0, idempotent: false };
  if (!purchasedReservation.ok) {
    await refundCredits(includedReservation.transactionId);
    return NextResponse.json(purchasedReservation, { status: 402 });
  }

  const batchGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = batchGroups.get(row.batch_id as string) ?? [];
    list.push(row);
    batchGroups.set(row.batch_id as string, list);
  }
  after(async () => {
    try {
      for (const [batchId, batchRows] of batchGroups) {
        await processQueuedRowsInBackground({
          queuedRows: batchRows.map((row) => ({
            id: row.id as string,
            full_name: row.full_name as string | null,
            email: row.email as string | null,
            linkedin_url: row.linkedin_url as string | null,
            company_name: row.company_name as string | null,
            raw_data: row.raw_data as Record<string, unknown>,
          })),
          batchId,
          userId: user.id,
          autoEnrich: true,
        });
      }
      const { count: successful } = await admin.from('raw_uploads')
        .select('id', { count: 'exact', head: true })
        .in('id', rows.map((row) => row.id as string)).eq('status', 'enriched');
      let remainingSuccess = successful ?? 0;
      const includedSuccess = Math.min(includedCount, remainingSuccess);
      remainingSuccess -= includedSuccess;
      await settleCredits(includedReservation.transactionId, includedSuccess * 4);
      await settleCredits(purchasedReservation.transactionId, Math.min(purchasedCount, remainingSuccess) * 4);
      await settleUsage({
        orgId: member.org_id,
        action: 'imported_enrichment',
        operationKey: operationId,
        quantity: successful ?? 0,
      });
    } catch (caught) {
      console.error('[import-contacts/enrich] background job failed:', caught);
      await Promise.all([
        refundCredits(includedReservation.transactionId),
        refundCredits(purchasedReservation.transactionId),
      ]);
      await settleUsage({
        orgId: member.org_id,
        action: 'imported_enrichment',
        operationKey: operationId,
        quantity: 0,
      });
    }
  });

  return NextResponse.json({ accepted: true, ...estimate }, { status: 202 });
}
