-- Per-subscriber source cadence state.
--
-- Shared source targets decide when infrastructure should acquire data for an
-- entity/source pair. These rows decide which customer subscribers are due to
-- receive that source after the shared acquisition runs.

create table if not exists public.account_source_subscriber_sweeps (
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null,
  status text not null check (
    status in ('active', 'waitlisted', 'paused', 'ineligible')
  ),
  cadence_days integer not null check (cadence_days > 0),
  last_sweep_at timestamptz,
  next_sweep_at timestamptz not null default now(),
  last_sweep_status text,
  last_result_count integer,
  last_provider_cost_usd numeric(14,6),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (org_id, company_id, source)
);

create index if not exists idx_account_source_subscriber_sweeps_due
  on public.account_source_subscriber_sweeps (source, next_sweep_at)
  where status = 'active';

create index if not exists idx_account_source_subscriber_sweeps_company_source
  on public.account_source_subscriber_sweeps (company_id, source)
  where status = 'active';

alter table public.account_source_subscriber_sweeps enable row level security;

drop policy if exists account_source_subscriber_sweeps_member_read
  on public.account_source_subscriber_sweeps;
create policy account_source_subscriber_sweeps_member_read
  on public.account_source_subscriber_sweeps
  for select using (org_id = public.user_org_id());

create table if not exists public.contact_source_subscriber_sweeps (
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  source text not null,
  status text not null check (
    status in ('active', 'waitlisted', 'paused', 'ineligible')
  ),
  cadence_days integer not null check (cadence_days > 0),
  last_sweep_at timestamptz,
  next_sweep_at timestamptz not null default now(),
  last_sweep_status text,
  last_provider_cost_usd numeric(14,6),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (org_id, person_id, source)
);

create index if not exists idx_contact_source_subscriber_sweeps_due
  on public.contact_source_subscriber_sweeps (source, next_sweep_at)
  where status = 'active';

create index if not exists idx_contact_source_subscriber_sweeps_person_source
  on public.contact_source_subscriber_sweeps (person_id, source)
  where status = 'active';

alter table public.contact_source_subscriber_sweeps enable row level security;

drop policy if exists contact_source_subscriber_sweeps_member_read
  on public.contact_source_subscriber_sweeps;
create policy contact_source_subscriber_sweeps_member_read
  on public.contact_source_subscriber_sweeps
  for select using (org_id = public.user_org_id());

insert into public.account_source_subscriber_sweeps (
  org_id,
  company_id,
  source,
  status,
  cadence_days,
  next_sweep_at,
  updated_at
)
select
  mas.org_id,
  mas.company_id,
  source,
  mas.status,
  mas.cadence_days,
  now(),
  now()
from public.monitored_account_subscribers mas
cross join unnest(array[
  'clinical_trials',
  'conferences',
  'fda_regulatory',
  'funding',
  'grants',
  'hiring',
  'patents',
  'press_releases',
  'publications'
]::text[]) source
on conflict (org_id, company_id, source) do update set
  status = excluded.status,
  cadence_days = excluded.cadence_days,
  updated_at = now();

insert into public.contact_source_subscriber_sweeps (
  org_id,
  person_id,
  source,
  status,
  cadence_days,
  next_sweep_at,
  updated_at
)
select
  mcs.org_id,
  mcs.person_id,
  source,
  mcs.status,
  mcs.cadence_days,
  now(),
  now()
from public.monitored_contact_subscribers mcs
cross join unnest(array[
  'conference_presenters',
  'conference_social',
  'job_change',
  'publications'
]::text[]) source
on conflict (org_id, person_id, source) do update set
  status = excluded.status,
  cadence_days = excluded.cadence_days,
  updated_at = now();
