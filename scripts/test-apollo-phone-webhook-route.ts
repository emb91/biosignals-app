/**
 * Route-level test of app/api/apollo/phone-webhook/[token]: register a request,
 * invoke the POST handler with a simulated Apollo delivery, assert phones land in
 * contact_phones and the request is marked received. Also checks the unknown-token
 * 404 path. Cleans up. (Apollo can't reach localhost, so this stands in for the
 * real async delivery.)
 *   APOLLO_PHONE_WEBHOOK_URL=https://example.com/api/apollo/phone-webhook \
 *     npx tsx --env-file=.env.local scripts/test-apollo-phone-webhook-route.ts
 */
import { createClient } from '@supabase/supabase-js';
import { POST } from '@/app/api/apollo/phone-webhook/[token]/route';
import { registerPhoneRevealRequest } from '@/lib/apollo-phone-webhook';

const USER = '3f166004-174b-4fc6-88f0-7cd47332f6ee';
// A real user_contacts.id for USER — contact_phones.contact_id FKs user_contacts.
const CONTACT = '78233db4-2170-4925-8abf-1a9fb127321d';
const TEST_PHONES = ['+15552223333', '+15554445555']; // normalized forms we insert

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function main() {
  if (!process.env.APOLLO_PHONE_WEBHOOK_URL) {
    process.env.APOLLO_PHONE_WEBHOOK_URL = 'https://example.com/api/apollo/phone-webhook';
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // clean any prior test residue (ONLY our test phone values — leave real phones)
  await admin.from('contact_phones').delete().eq('contact_id', CONTACT).in('phone', TEST_PHONES);

  const reg = await registerPhoneRevealRequest(admin, {
    userId: USER,
    contactId: CONTACT,
    linkedinUrl: 'https://www.linkedin.com/in/route-test',
    email: 'route-test@x.com',
    fullName: 'Route Test',
  });
  assert(!!reg, 'registered a pending request');

  const apolloBody = {
    people: [
      {
        linkedin_url: 'https://www.linkedin.com/in/route-test',
        email: 'route-test@x.com',
        phone_numbers: [
          { sanitized_number: '+1 (555) 222-3333', type: 'mobile', status: 'valid_number' },
          { sanitized_number: '+1-555-222-3333', type: 'mobile' }, // true normalized dup -> collapsed
          { sanitized_number: '+1 555 444 5555', type: 'work_direct' },
        ],
      },
    ],
  };

  console.log('1. valid token delivery');
  const res = await POST(
    new Request('https://example.com/api/apollo/phone-webhook/x', {
      method: 'POST',
      body: JSON.stringify(apolloBody),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ token: reg!.token }) },
  );
  const json = (await res.json()) as { ok: boolean; written: number };
  assert(res.status === 200 && json.ok, '200 ok');
  console.log(`  written reported: ${json.written}`);
  assert(json.written === 2, 'honest count = 2 (in-payload dup collapsed)');

  const { data: phones } = await admin
    .from('contact_phones')
    .select('phone, category, source_provider')
    .eq('contact_id', CONTACT)
    .eq('user_id', USER)
    .in('phone', TEST_PHONES);
  console.log('  contact_phones (test rows):', JSON.stringify(phones));
  assert((phones?.length ?? 0) === 2, 'two distinct phones written (dup collapsed)');
  assert(phones!.every((p) => p.source_provider === 'apollo_reveal'), 'tagged apollo_reveal');

  const { data: reqRow } = await admin
    .from('apollo_phone_reveal_requests')
    .select('status, phones_written')
    .eq('id', reg!.id)
    .single();
  assert(reqRow!.status === 'received', 'request marked received');

  console.log('2. unknown token -> 404');
  const res404 = await POST(
    new Request('https://example.com/api/apollo/phone-webhook/x', {
      method: 'POST',
      body: JSON.stringify({ people: [{ email: 'nobody@nowhere.com' }] }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ token: 'totally-unknown-token-zzz' }) },
  );
  assert(res404.status === 404, '404 for unknown token + no identity match');

  console.log('3. idempotent re-delivery (Apollo retry)');
  const resRetry = await POST(
    new Request('https://example.com/api/apollo/phone-webhook/x', {
      method: 'POST',
      body: JSON.stringify(apolloBody),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ token: reg!.token }) },
  );
  assert(resRetry.status === 200, 'retry 200');
  const { data: phones2 } = await admin
    .from('contact_phones')
    .select('phone')
    .eq('contact_id', CONTACT)
    .eq('user_id', USER)
    .in('phone', TEST_PHONES);
  assert((phones2?.length ?? 0) === 2, 'still two phones after retry (no dups)');

  // cleanup (only our test phone values)
  await admin.from('contact_phones').delete().eq('contact_id', CONTACT).in('phone', TEST_PHONES);
  await admin.from('apollo_phone_reveal_requests').delete().eq('id', reg!.id);
  console.log('cleaned up');
  console.log('\nALL PASSED');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
