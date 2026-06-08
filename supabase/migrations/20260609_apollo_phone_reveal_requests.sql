-- Apollo phone reveal is ASYNC: reveal_phone_number=true requires a webhook_url
-- and Apollo delivers the revealed number(s) to that URL minutes later, NOT in
-- the API response (the sync response only carries an employer phone, if any).
--
-- To correlate the async webhook back to the right (user, contact), we mint a
-- single-use random token per reveal request, embed it in the webhook URL path
-- (.../api/apollo/phone-webhook/<token>), and record the pending request here.
-- When Apollo POSTs back, the webhook route looks the contact up by token, writes
-- phones to contact_phones, and marks the row received. The token doubles as the
-- bearer secret — Apollo sends no signature/header on these webhooks, and an
-- unguessable token in the path is the only thing a caller could echo back.
--
-- Service-role only: written by the enrichment worker, read/updated by the
-- webhook route (both use the service-role key). RLS is enabled with NO policies
-- so it is inaccessible to anon/authenticated clients; the service role bypasses
-- RLS. No FK on contact_id/user_id — `contacts` is a view post-cutover and cannot
-- be a FK target; the id stored is the contacts-view id that contact_phones uses.

create table if not exists public.apollo_phone_reveal_requests (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  user_id       uuid not null,
  contact_id    uuid not null,
  -- Identity snapshot at request time — for an identity-based correlation
  -- fallback (match incoming person by linkedin_url/email) if a token ever
  -- fails to round-trip, and for debugging.
  linkedin_url  text,
  email         text,
  full_name     text,
  status        text not null default 'pending'
                  check (status in ('pending', 'received', 'failed')),
  phones_written integer not null default 0,
  -- Raw Apollo webhook body, stored on receipt so the first real delivery is
  -- debuggable (the exact envelope shape isn't documented and can't be tested
  -- against localhost — Apollo can't reach it).
  raw_response  jsonb,
  created_at    timestamptz not null default now(),
  received_at   timestamptz
);

-- Identity-based fallback lookup + housekeeping queries.
create index if not exists apollo_phone_reveal_requests_linkedin_idx
  on public.apollo_phone_reveal_requests (linkedin_url)
  where linkedin_url is not null;
create index if not exists apollo_phone_reveal_requests_status_created_idx
  on public.apollo_phone_reveal_requests (status, created_at);
create index if not exists apollo_phone_reveal_requests_contact_idx
  on public.apollo_phone_reveal_requests (user_id, contact_id);

alter table public.apollo_phone_reveal_requests enable row level security;
-- Intentionally no policies: anon/authenticated get nothing; service role bypasses RLS.

comment on table public.apollo_phone_reveal_requests is
  'Pending/received Apollo async phone-reveal webhook correlations. Token in the webhook URL path maps an async delivery back to (user_id, contact_id). Service-role only.';
