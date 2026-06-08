/**
 * Local verification of the Apollo phone-reveal webhook machinery (the parts we
 * CAN test without a real Apollo async delivery — Apollo can't reach localhost):
 *   1. extractApolloPhonesFromWebhookBody across the envelope shapes we tolerate.
 *   2. register -> find-by-token -> mark-received round-trip on the real table.
 *   3. find-by-identity fallback.
 * Cleans up its test rows.
 *   APOLLO_PHONE_WEBHOOK_URL=https://example.com/api/apollo/phone-webhook \
 *     npx tsx --env-file=.env.local scripts/test-apollo-phone-webhook.ts
 */
import { createClient } from '@supabase/supabase-js';
import {
  extractApolloPhonesFromWebhookBody,
  registerPhoneRevealRequest,
  findPhoneRevealRequestByToken,
  findPhoneRevealRequestByIdentity,
  markPhoneRevealRequestReceived,
  buildPhoneRevealWebhookUrl,
} from '@/lib/apollo-phone-webhook';

const USER = '3f166004-174b-4fc6-88f0-7cd47332f6ee';
const CONTACT = '00000000-0000-0000-0000-0000000000ff'; // throwaway

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

async function main() {
  // Ensure the receiver URL is set so register() actually mints a token.
  if (!process.env.APOLLO_PHONE_WEBHOOK_URL) {
    process.env.APOLLO_PHONE_WEBHOOK_URL = 'https://example.com/api/apollo/phone-webhook';
  }

  console.log('1. extractApolloPhonesFromWebhookBody — envelope shapes');
  const phoneBlock = [
    { sanitized_number: '+15551230000', type: 'mobile', status: 'valid_number' },
    { sanitized_number: '+15559990000', type: 'work_direct' },
  ];
  const person = { linkedin_url: 'https://www.linkedin.com/in/a-avanzado', email: 'a@x.com', phone_numbers: phoneBlock };
  for (const [label, body] of [
    ['{ person }', { person }],
    ['{ people: [...] }', { people: [person] }],
    ['{ contacts: [...] }', { contacts: [person] }],
    ['{ matches: [...] }', { matches: [person] }],
    ['bare person', person],
    ['bare array', [person]],
  ] as Array<[string, unknown]>) {
    const { phones, identity } = extractApolloPhonesFromWebhookBody(body);
    assert(phones.length === 2, `${label} -> 2 phones`);
    assert(identity.linkedinUrl === person.linkedin_url, `${label} -> linkedin identity`);
  }
  const empty = extractApolloPhonesFromWebhookBody({ foo: 'bar' });
  assert(empty.phones.length === 0, 'unknown shape -> 0 phones (no throw)');
  assert(extractApolloPhonesFromWebhookBody(null).phones.length === 0, 'null body -> 0 phones');

  console.log('2. buildPhoneRevealWebhookUrl');
  const url = buildPhoneRevealWebhookUrl('tok-123');
  assert(url === 'https://example.com/api/apollo/phone-webhook/tok-123', `url = ${url}`);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log('3. register -> find-by-token -> mark-received round-trip');
  const reg = await registerPhoneRevealRequest(admin, {
    userId: USER,
    contactId: CONTACT,
    linkedinUrl: 'https://www.linkedin.com/in/webhook-test',
    email: 'webhook-test@x.com',
    fullName: 'Webhook Test',
  });
  assert(!!reg, 'register returned a token');
  const found = await findPhoneRevealRequestByToken(admin, reg!.token);
  assert(!!found && found.contact_id === CONTACT, 'found request by token, contact matches');
  assert(found!.status === 'pending', 'status pending');

  console.log('4. find-by-identity fallback (linkedin)');
  const byId = await findPhoneRevealRequestByIdentity(admin, {
    linkedinUrl: 'https://www.linkedin.com/in/webhook-test',
  });
  assert(!!byId && byId.id === reg!.id, 'found same request by linkedin identity');

  await markPhoneRevealRequestReceived(admin, { id: reg!.id, phonesWritten: 2, rawResponse: { person } });
  const after = await findPhoneRevealRequestByToken(admin, reg!.token);
  assert(after!.status === 'received' && after!.phones_written === 2, 'marked received w/ count');

  // cleanup
  await admin.from('apollo_phone_reveal_requests').delete().eq('id', reg!.id);
  console.log('cleaned up test row');
  console.log('\nALL PASSED');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
