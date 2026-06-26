import { after, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { ACTION_CREDITS } from '@/lib/billing/config';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import {
  refundCredits,
  reserveCreditsWithIncludedCreditAllowance,
  settleLeadEnrichmentUsage,
  settleCredits,
} from '@/lib/billing/credits';
import { processQueuedRowsInBackground } from '@/lib/import-queue';
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
  const rawUploadIds = Array.isArray(body.rawUploadIds)
    ? [...new Set(body.rawUploadIds.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (!rawUploadIds.length) return NextResponse.json({ error: 'rawUploadIds required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: member } = await admin.from('org_members').select('org_id')
    .eq('user_id', user.id).maybeSingle<{ org_id: string }>();
  if (!member?.org_id) return NextResponse.json(WORKSPACE_REQUIRED_ERROR, { status: 409 });
  const { data: candidateRows, error } = await admin.from('raw_uploads')
    .select('id, user_id, batch_id, full_name, email, linkedin_url, company_name, raw_data, status, triage_group, triage_override_group')
    .eq('org_id', member.org_id)
    .in('id', rawUploadIds)
    .eq('status', 'awaiting_enrichment');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (candidateRows || []).filter((row) => {
    const effectiveTriage = (row.triage_override_group || row.triage_group) as string | null;
    return effectiveTriage === 'high' || effectiveTriage === 'medium';
  });
  if (!rows?.length) return NextResponse.json({ error: 'No eligible records found' }, { status: 404 });

  const estimate = {
    eligibleRecords: rows.length,
    estimatedCredits: rows.length * ACTION_CREDITS.imported_contact_company_enrichment,
  };
  if (!body.confirm) return NextResponse.json({ preflight: estimate });

  const operationId = body.operationId?.trim() || crypto.randomUUID();
  const entitlements = await getOrgEntitlements(member.org_id);
  const allowanceLimitCredits = entitlements.caps.leadEnrichmentCreditsIncludedMonthly *
    (entitlements.billingInterval === 'annual' ? 12 : 1);
  const reservation = await reserveCreditsWithIncludedCreditAllowance({
    orgId: member.org_id,
    userId: user.id,
    action: 'imported_contact_company_enrichment',
    quantity: rows.length,
    operationKey: operationId,
    window: 'utc_month',
    windowStart: entitlements.currentPeriodStart,
    windowEnd: entitlements.currentPeriodEnd,
    allowanceLimitCredits,
    idempotencyKey: `import-enrichment:${operationId}`,
    metadata: { usage_action: 'imported_enrichment' },
  });
  if (!reservation.ok) return NextResponse.json(reservation, { status: 402 });

  const batchGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.user_id as string}:${row.batch_id as string}`;
    const list = batchGroups.get(key) ?? [];
    list.push(row);
    batchGroups.set(key, list);
  }
  after(async () => {
    try {
      for (const [key, batchRows] of batchGroups) {
        const [ownerUserId, batchId] = key.split(':');
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
          userId: ownerUserId,
          autoEnrich: true,
        });
      }
      const { count: successful } = await admin.from('raw_uploads')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', member.org_id)
        .in('id', rows.map((row) => row.id as string))
        .eq('status', 'enriched');
      const successfulRows = successful ?? 0;
      await settleCredits(
        reservation.transactionId,
        successfulRows * ACTION_CREDITS.imported_contact_company_enrichment,
      );
      await settleLeadEnrichmentUsage({
        orgId: member.org_id,
        operationKey: operationId,
        action: 'imported_contact_company_enrichment',
        actionQuantity: successfulRows,
        credits: successfulRows * ACTION_CREDITS.imported_contact_company_enrichment,
      });
    } catch (caught) {
      console.error('[import-contacts/enrich] background job failed:', caught);
      await refundCredits(reservation.transactionId);
      await settleLeadEnrichmentUsage({
        orgId: member.org_id,
        operationKey: operationId,
        action: 'imported_contact_company_enrichment',
        actionQuantity: 0,
        credits: 0,
      });
    }
  });

  return NextResponse.json({ accepted: true, ...estimate }, { status: 202 });
}
