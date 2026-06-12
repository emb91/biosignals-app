-- Store deliverability per email address, not only per contact.
-- This lets one contact carry multiple addresses with independent verification state.

alter table public.contact_emails
  add column if not exists email_deliverability text,
  add column if not exists email_deliverability_provider text,
  add column if not exists email_deliverability_checked_at timestamptz,
  add column if not exists email_deliverability_metadata jsonb;

-- Seed row-level deliverability from Apollo's email_status where we already have it.
update public.contact_emails
set email_deliverability = apollo_email_status
where email_deliverability is null
  and apollo_email_status is not null;

-- Primary import rows may not have apollo_email_status, but the contact-level
-- deliverability column was backfilled from Apollo. Copy that onto the matching
-- per-address row so Apollo-verified primary emails are not re-spent.
update public.contact_emails ce
set
  email_deliverability = c.email_deliverability,
  email_deliverability_provider = case
    when c.email_deliverability is not null then 'apollo'
    else ce.email_deliverability_provider
  end
from public.contacts c
where ce.contact_id = c.id
  and c.email is not null
  and lower(trim(ce.email)) = lower(trim(c.email))
  and ce.email_deliverability is null
  and c.email_deliverability is not null;

comment on column public.contact_emails.email_deliverability is
  'Per-address deliverability status, e.g. verified, extrapolated, unavailable, invalid, catch-all, unknown.';

comment on column public.contact_emails.email_deliverability_provider is
  'Provider that produced email_deliverability, e.g. apollo or zerobounce.';

comment on column public.contact_emails.email_deliverability_checked_at is
  'When this specific email address was last checked with an external verifier.';
