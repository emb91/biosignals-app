import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  findPhoneRevealRequestByToken,
  findPhoneRevealRequestByIdentity,
  markPhoneRevealRequestReceived,
  extractApolloPhonesFromWebhookBody,
  writeRevealedPhonesForRequest,
} from '@/lib/apollo-phone-webhook';

// Apollo posts this from its servers, not the browser — needs the service-role
// client + Node runtime (crypto, no edge). No user session is involved.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Receiver for Apollo's async phone-reveal webhook.
 *
 * Apollo POSTs the matched person (with phone_numbers) to the per-call URL we
 * supplied: .../api/apollo/phone-webhook/<token>. The unguessable, single-use
 * token in the path is both the correlation key (→ which contact) and the bearer
 * secret (Apollo signs nothing). We:
 *   1. resolve the request by token (falling back to identity match),
 *   2. extract phones from a tolerant set of payload shapes,
 *   3. write them to contact_phones (idempotent — Apollo may retry),
 *   4. record the raw body + count for debugging the real-world envelope.
 *
 * Always returns 200 once the token is valid, even on zero phones, so Apollo
 * doesn't retry forever. Unknown token → 404.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Apollo should send JSON; if not, capture nothing but don't 500.
    body = null;
  }

  const supabase = createAdminClient();

  // 1. Correlate. Token (path) is primary; identity is a best-effort fallback.
  const { phones, identity } = extractApolloPhonesFromWebhookBody(body);
  let req = await findPhoneRevealRequestByToken(supabase, token);
  if (!req) {
    req = await findPhoneRevealRequestByIdentity(supabase, {
      linkedinUrl: identity.linkedinUrl,
      email: identity.email,
    });
  }

  if (!req) {
    // Unknown token AND no identity match — reject. Log enough to investigate
    // (the token is opaque; the body shape may be new).
    console.warn(
      `[apollo-phone-webhook] no matching reveal request for token=${token?.slice(0, 8)}… ` +
        `identity=${JSON.stringify(identity)}`,
    );
    return NextResponse.json({ ok: false, error: 'unknown_token' }, { status: 404 });
  }

  // 2 + 3. Write phones (fit gate already applied at request time).
  let written = 0;
  try {
    written = await writeRevealedPhonesForRequest(
      supabase,
      { user_id: req.user_id, contact_id: req.contact_id },
      phones,
    );
  } catch (err) {
    console.error('[apollo-phone-webhook] write failed:', err);
    await markPhoneRevealRequestReceived(supabase, {
      id: req.id,
      phonesWritten: 0,
      rawResponse: body,
      status: 'failed',
    });
    // 200 so Apollo doesn't hammer retries on a persistent write bug; we have
    // the raw body recorded to replay.
    return NextResponse.json({ ok: false, error: 'write_failed' }, { status: 200 });
  }

  // 4. Record receipt (idempotent on retry — we just overwrite count/body).
  await markPhoneRevealRequestReceived(supabase, {
    id: req.id,
    phonesWritten: written,
    rawResponse: body,
  });

  console.log(
    `[apollo-phone-webhook] token=${token?.slice(0, 8)}… contact=${req.contact_id} wrote ${written} phone(s)`,
  );
  return NextResponse.json({ ok: true, written });
}

// Some webhook providers send a GET to verify the endpoint exists. Respond 200.
export async function GET() {
  return NextResponse.json({ ok: true, service: 'apollo-phone-webhook' });
}
