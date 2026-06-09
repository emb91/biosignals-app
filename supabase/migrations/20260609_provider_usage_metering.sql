-- Per-call cost metering for paid data providers (Apify, Apollo).
-- Pairs with lib/provider-usage.ts (forward metering at the enrichment call
-- sites) and the data_provider_usage_by_user view below (retroactive counts
-- from rows already enriched). Mirrors llm_usage_events: RLS on, no public
-- policy → only the service role (admin API + recorder) can read/write.

create table if not exists public.provider_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  provider text not null,            -- 'apify' | 'apollo'
  event_type text not null,          -- e.g. 'apify_profile_scrape', 'apollo_person_enrichment'
  quantity integer not null default 1 check (quantity >= 0),
  unit_cost_usd numeric(12, 6),      -- $ per unit at event time (Apify); null for credit-based
  cost_usd numeric(12, 6),           -- quantity * unit_cost_usd (Apify); null for Apollo
  credit_units numeric(12, 2),       -- consumption in provider credits (Apollo); null for Apify
  contact_id uuid,                   -- audit ref only (no FK — contacts/people in flux)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

alter table public.provider_usage_events enable row level security;

create index if not exists provider_usage_events_created_idx
  on public.provider_usage_events(created_at desc);
create index if not exists provider_usage_events_user_idx
  on public.provider_usage_events(user_id, created_at desc);
create index if not exists provider_usage_events_provider_idx
  on public.provider_usage_events(provider, event_type, created_at desc);

-- Retroactive per-user usage, counted from the raw payloads already stored on
-- enriched contacts (+ phone reveal requests). This is the authoritative
-- "usage to date" source and needs no historical event log, so it covers all
-- history regardless of when forward metering was switched on. security_invoker
-- so it respects the underlying tables' RLS (the service role still sees all).
-- NOTE: sources public.contacts, which is the live compatibility view over the
-- contacts→people split, so these counts stay correct across the cutover.
create or replace view public.data_provider_usage_by_user
with (security_invoker = true) as
with c as (
  select
    user_id,
    count(*) filter (where apify_profile_raw is not null) as apify_profile_scrapes,
    count(*) filter (where apify_company_raw is not null) as apify_company_scrapes,
    count(*) filter (where apollo_person_raw is not null) as apollo_person_enrichments,
    count(*) filter (where apollo_organization_raw is not null) as apollo_org_enrichments
  from public.contacts
  group by user_id
),
r as (
  select
    user_id,
    count(*) as phone_reveal_requests,
    count(*) filter (where status = 'received') as phone_reveals_received
  from public.apollo_phone_reveal_requests
  group by user_id
)
select
  coalesce(c.user_id, r.user_id) as user_id,
  coalesce(c.apify_profile_scrapes, 0) as apify_profile_scrapes,
  coalesce(c.apify_company_scrapes, 0) as apify_company_scrapes,
  coalesce(c.apollo_person_enrichments, 0) as apollo_person_enrichments,
  coalesce(c.apollo_org_enrichments, 0) as apollo_org_enrichments,
  coalesce(r.phone_reveal_requests, 0) as phone_reveal_requests,
  coalesce(r.phone_reveals_received, 0) as phone_reveals_received
from c
full outer join r on c.user_id = r.user_id;
