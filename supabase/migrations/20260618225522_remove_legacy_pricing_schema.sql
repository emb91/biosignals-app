-- Remove the retired contact-meter, prepaid-contact-pack, seat, and export-cap
-- schema. Arcova now uses workspace subscriptions, action credits, usage caps,
-- and org_credit_* ledgers exclusively.

drop function if exists public.billing_consume_contact(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  integer,
  timestamptz,
  boolean
);

drop table if exists public.org_billable_contact_events;
drop table if exists public.org_contact_packs;

drop function if exists public.increment_org_export_count(uuid, uuid);
drop table if exists public.org_export_events;

alter table public.org_subscriptions
  drop column if exists included_seats,
  drop column if exists included_monthly_contacts;
