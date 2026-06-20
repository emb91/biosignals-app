import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service credentials are required');

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let orgId;
try {
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: `__credit_verification_${crypto.randomUUID()}` })
    .select('id')
    .single();
  if (orgError) throw orgError;
  orgId = org.id;

  const now = new Date();
  const expiry = new Date(now.getTime() + 86_400_000);
  const { error: grantError } = await admin.rpc('grant_org_credit_bucket', {
    p_org_id: orgId,
    p_source: 'adjustment',
    p_credits: 100,
    p_valid_from: now.toISOString(),
    p_expires_at: expiry.toISOString(),
    p_external_reference: `verification:${orgId}`,
    p_metadata: { automatedVerification: true },
  });
  if (grantError) throw grantError;

  const first = await reserve('verification:first', 20);
  const duplicate = await reserve('verification:first', 20);
  assert(first.transactionId === duplicate.transactionId, 'idempotent reservation reused transaction');
  assert(duplicate.idempotent === true, 'duplicate reservation marked idempotent');

  const { error: settleError } = await admin.rpc('settle_org_credits', {
    p_transaction_id: first.transactionId,
    p_credits: 12,
  });
  if (settleError) throw settleError;

  const second = await reserve('verification:refund', 10);
  const { error: refundError } = await admin.rpc('refund_org_credits', {
    p_transaction_id: second.transactionId,
  });
  if (refundError) throw refundError;

  const { data: bucket, error: bucketError } = await admin
    .from('org_credit_buckets')
    .select('credits_granted, credits_remaining')
    .eq('org_id', orgId)
    .single();
  if (bucketError) throw bucketError;
  assert(Number(bucket.credits_granted) === 100, 'grant remains 100');
  assert(Number(bucket.credits_remaining) === 88, 'only 12 settled credits remain consumed');

  const { data: transactions, error: txError } = await admin
    .from('org_credit_transactions')
    .select('status, credits_reserved, credits_settled')
    .eq('org_id', orgId)
    .order('created_at');
  if (txError) throw txError;
  assert(transactions?.[0]?.status === 'partially_refunded', 'partial settlement status recorded');
  assert(Number(transactions?.[0]?.credits_settled) === 12, 'partial settlement amount recorded');
  assert(transactions?.[1]?.status === 'refunded', 'full refund status recorded');

  console.log('Credit ledger verification passed.');
} finally {
  if (orgId) {
    const { data: transactions } = await admin
      .from('org_credit_transactions')
      .select('id')
      .eq('org_id', orgId);
    const transactionIds = (transactions ?? []).map((row) => row.id);
    if (transactionIds.length) {
      await admin.from('org_credit_allocations').delete().in('transaction_id', transactionIds);
    }
    await admin.from('org_credit_transactions').delete().eq('org_id', orgId);
    await admin.from('org_credit_buckets').delete().eq('org_id', orgId);
    const { error: cleanupError } = await admin.from('organizations').delete().eq('id', orgId);
    if (cleanupError) throw cleanupError;
  }
}

async function reserve(idempotencyKey, credits) {
  const { data, error } = await admin.rpc('reserve_org_credits', {
    p_org_id: orgId,
    p_user_id: null,
    p_action_type: 'automated_verification',
    p_credits: credits,
    p_idempotency_key: idempotencyKey,
    p_entity_type: 'verification',
    p_entity_id: orgId,
    p_allowed_sources: ['adjustment'],
    p_metadata: { automatedVerification: true },
  });
  if (error) throw error;
  assert(data?.ok === true, `reservation ${idempotencyKey} succeeded`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Credit ledger assertion failed: ${message}`);
}
