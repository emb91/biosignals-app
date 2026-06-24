-- Shared monitoring cadence scaffold.
--
-- These tables separate a customer's entitlement to monitor an entity from the
-- source-specific acquisition clock. Subscribers stay org-scoped; sweep targets
-- are global infra rows keyed by canonical entity + source.

create table if not exists public.monitored_account_subscribers (
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null check (
    status in ('active', 'waitlisted', 'paused', 'ineligible')
  ),
  cadence_days integer not null check (cadence_days > 0),
  priority_score numeric,
  represented_by_active_contact boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (org_id, company_id)
);

create index if not exists idx_monitored_account_subscribers_company_active
  on public.monitored_account_subscribers (company_id, cadence_days)
  where status = 'active';

alter table public.monitored_account_subscribers enable row level security;

drop policy if exists monitored_account_subscribers_member_read
  on public.monitored_account_subscribers;
create policy monitored_account_subscribers_member_read
  on public.monitored_account_subscribers
  for select using (org_id = public.user_org_id());

create table if not exists public.monitored_contact_subscribers (
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null check (
    status in ('active', 'waitlisted', 'paused', 'ineligible')
  ),
  cadence_days integer not null check (cadence_days > 0),
  priority_score numeric,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (org_id, person_id)
);

create index if not exists idx_monitored_contact_subscribers_person_active
  on public.monitored_contact_subscribers (person_id, cadence_days)
  where status = 'active';

alter table public.monitored_contact_subscribers enable row level security;

drop policy if exists monitored_contact_subscribers_member_read
  on public.monitored_contact_subscribers;
create policy monitored_contact_subscribers_member_read
  on public.monitored_contact_subscribers
  for select using (org_id = public.user_org_id());

create table if not exists public.account_source_sweep_targets (
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null,
  status text not null default 'active' check (
    status in ('active', 'no_subscribers')
  ),
  effective_cadence_days integer not null check (effective_cadence_days > 0),
  active_subscriber_count integer not null default 0 check (active_subscriber_count >= 0),
  fastest_org_id uuid references public.organizations(id) on delete set null,
  last_sweep_at timestamptz,
  next_sweep_at timestamptz not null default now(),
  last_sweep_status text,
  last_result_count integer,
  last_provider_cost_usd numeric(14,6),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (company_id, source)
);

create index if not exists idx_account_source_sweep_targets_due
  on public.account_source_sweep_targets (source, next_sweep_at)
  where status = 'active';

alter table public.account_source_sweep_targets enable row level security;

create table if not exists public.contact_source_sweep_targets (
  person_id uuid not null references public.people(id) on delete cascade,
  source text not null,
  status text not null default 'active' check (
    status in ('active', 'no_subscribers')
  ),
  effective_cadence_days integer not null check (effective_cadence_days > 0),
  active_subscriber_count integer not null default 0 check (active_subscriber_count >= 0),
  fastest_org_id uuid references public.organizations(id) on delete set null,
  last_sweep_at timestamptz,
  next_sweep_at timestamptz not null default now(),
  last_sweep_status text,
  last_provider_cost_usd numeric(14,6),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (person_id, source)
);

create index if not exists idx_contact_source_sweep_targets_due
  on public.contact_source_sweep_targets (source, next_sweep_at)
  where status = 'active';

alter table public.contact_source_sweep_targets enable row level security;
