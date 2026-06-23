-- Org-scoped working layer for contacts and companies.
--
-- Canonical tables stay global:
--   people    = enrichment-owned person records
--   companies = enrichment-owned company records
--
-- Customer/team state lives here:
--   org_contact_state      = membership, triage, archive/pin/suppress state
--   org_contact_overrides  = manual edited person fields visible to the org
--   org_companies          = org-owned account membership/state
--   org_company_overrides  = manual edited company fields visible to the org
--
-- The old user_contacts/user_companies tables remain for compatibility while
-- reads/writes migrate. Backfills pick the most recent duplicate row inside an
-- org when two members already had the same person/company.

create table if not exists public.org_contact_state (
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  source text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  triage_group text check (triage_group is null or triage_group in ('high', 'medium', 'low')),
  triage_scored_at timestamptz,
  triage_version text,
  pinned_at timestamptz,
  pinned_by uuid references auth.users(id) on delete set null,
  suppressed_at timestamptz,
  suppressed_by uuid references auth.users(id) on delete set null,
  suppressed_reason text,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archived_reason text,
  primary key (org_id, person_id)
);

create table if not exists public.org_contact_overrides (
  org_id uuid not null references public.organizations(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  overrides jsonb not null default '{}'::jsonb,
  overridden_by uuid references auth.users(id) on delete set null,
  overridden_at timestamptz not null default now(),
  primary key (org_id, person_id)
);

create table if not exists public.org_companies (
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  source text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  matched_icp_id uuid references public.icps(id) on delete set null,
  fit_score double precision,
  readiness_score double precision,
  company_fit_score double precision,
  company_fit_breakdown jsonb,
  company_fit_coverage double precision,
  company_fit_scored_at timestamptz,
  company_fit_version text,
  customer_therapeutic_areas text[],
  customer_modalities text[],
  customer_development_stages text[],
  crm_is_suppressed boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archived_reason text,
  primary key (org_id, company_id)
);

create table if not exists public.org_company_overrides (
  org_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  overrides jsonb not null default '{}'::jsonb,
  overridden_by uuid references auth.users(id) on delete set null,
  overridden_at timestamptz not null default now(),
  primary key (org_id, company_id)
);

create index if not exists org_contact_state_org_company_idx
  on public.org_contact_state (org_id, company_id)
  where archived_at is null;
create index if not exists org_contact_state_triage_idx
  on public.org_contact_state (org_id, triage_group, triage_scored_at desc)
  where archived_at is null;
create index if not exists org_companies_org_fit_idx
  on public.org_companies (org_id, company_fit_score desc nulls last)
  where archived_at is null;
create index if not exists org_companies_matched_icp_idx
  on public.org_companies (matched_icp_id)
  where matched_icp_id is not null;

-- Backfill contact membership/state from the current per-user layer.
insert into public.org_contact_state (
  org_id, person_id, company_id, source, added_at, updated_at, created_by,
  triage_group, triage_scored_at, triage_version,
  archived_at, archived_by, archived_reason
)
select distinct on (m.org_id, uc.person_id)
  m.org_id,
  uc.person_id,
  uc.company_id,
  uc.source,
  coalesce(uc.created_at, now()) as added_at,
  coalesce(uc.updated_at, now()) as updated_at,
  uc.user_id as created_by,
  uc.triage_group,
  uc.triage_scored_at,
  uc.triage_version,
  uc.archived_at,
  uc.archived_by,
  uc.archived_reason
from public.user_contacts uc
join public.org_members m on m.user_id = uc.user_id
where uc.person_id is not null
order by
  m.org_id,
  uc.person_id,
  coalesce(uc.triage_scored_at, uc.updated_at, uc.created_at) desc nulls last
on conflict (org_id, person_id) do update set
  company_id = coalesce(excluded.company_id, public.org_contact_state.company_id),
  source = coalesce(excluded.source, public.org_contact_state.source),
  updated_at = greatest(public.org_contact_state.updated_at, excluded.updated_at),
  triage_group = coalesce(excluded.triage_group, public.org_contact_state.triage_group),
  triage_scored_at = coalesce(excluded.triage_scored_at, public.org_contact_state.triage_scored_at),
  triage_version = coalesce(excluded.triage_version, public.org_contact_state.triage_version),
  archived_at = coalesce(public.org_contact_state.archived_at, excluded.archived_at),
  archived_by = coalesce(public.org_contact_state.archived_by, excluded.archived_by),
  archived_reason = coalesce(public.org_contact_state.archived_reason, excluded.archived_reason);

-- Backfill the latest non-empty manual contact override per org/person.
insert into public.org_contact_overrides (org_id, person_id, overrides, overridden_by, overridden_at)
select distinct on (m.org_id, uc.person_id)
  m.org_id,
  uc.person_id,
  uc.user_overrides,
  uc.user_id,
  coalesce(uc.updated_at, now())
from public.user_contacts uc
join public.org_members m on m.user_id = uc.user_id
where uc.person_id is not null
  and uc.user_overrides is not null
  and uc.user_overrides <> '{}'::jsonb
order by m.org_id, uc.person_id, uc.updated_at desc nulls last
on conflict (org_id, person_id) do update set
  overrides = public.org_contact_overrides.overrides || excluded.overrides,
  overridden_by = excluded.overridden_by,
  overridden_at = greatest(public.org_contact_overrides.overridden_at, excluded.overridden_at);

-- Backfill org companies from the current per-user account layer.
insert into public.org_companies (
  org_id, company_id, source, added_at, updated_at, created_by,
  matched_icp_id, fit_score, readiness_score,
  company_fit_score, company_fit_breakdown, company_fit_coverage,
  company_fit_scored_at, company_fit_version,
  customer_therapeutic_areas, customer_modalities, customer_development_stages,
  crm_is_suppressed, archived_at, archived_by, archived_reason
)
select distinct on (m.org_id, uc.company_id)
  m.org_id,
  uc.company_id,
  uc.source,
  uc.added_at,
  uc.updated_at,
  uc.user_id as created_by,
  uc.matched_icp_id,
  uc.fit_score,
  uc.readiness_score,
  uc.company_fit_score,
  uc.company_fit_breakdown,
  uc.company_fit_coverage,
  uc.company_fit_scored_at,
  uc.company_fit_version,
  uc.customer_therapeutic_areas,
  uc.customer_modalities,
  uc.customer_development_stages,
  coalesce(uc.crm_is_suppressed, false),
  uc.archived_at,
  uc.archived_by,
  uc.archived_reason
from public.user_companies uc
join public.org_members m on m.user_id = uc.user_id
where uc.company_id is not null
order by m.org_id, uc.company_id, uc.updated_at desc nulls last
on conflict (org_id, company_id) do update set
  source = coalesce(excluded.source, public.org_companies.source),
  updated_at = greatest(public.org_companies.updated_at, excluded.updated_at),
  matched_icp_id = coalesce(excluded.matched_icp_id, public.org_companies.matched_icp_id),
  fit_score = coalesce(excluded.fit_score, public.org_companies.fit_score),
  readiness_score = coalesce(excluded.readiness_score, public.org_companies.readiness_score),
  company_fit_score = coalesce(excluded.company_fit_score, public.org_companies.company_fit_score),
  company_fit_breakdown = coalesce(excluded.company_fit_breakdown, public.org_companies.company_fit_breakdown),
  company_fit_coverage = coalesce(excluded.company_fit_coverage, public.org_companies.company_fit_coverage),
  company_fit_scored_at = coalesce(excluded.company_fit_scored_at, public.org_companies.company_fit_scored_at),
  company_fit_version = coalesce(excluded.company_fit_version, public.org_companies.company_fit_version),
  customer_therapeutic_areas = coalesce(excluded.customer_therapeutic_areas, public.org_companies.customer_therapeutic_areas),
  customer_modalities = coalesce(excluded.customer_modalities, public.org_companies.customer_modalities),
  customer_development_stages = coalesce(excluded.customer_development_stages, public.org_companies.customer_development_stages),
  crm_is_suppressed = public.org_companies.crm_is_suppressed or excluded.crm_is_suppressed,
  archived_at = coalesce(public.org_companies.archived_at, excluded.archived_at),
  archived_by = coalesce(public.org_companies.archived_by, excluded.archived_by),
  archived_reason = coalesce(public.org_companies.archived_reason, excluded.archived_reason);

-- Backfill the latest non-empty manual company override per org/company.
insert into public.org_company_overrides (org_id, company_id, overrides, overridden_by, overridden_at)
select distinct on (m.org_id, uc.company_id)
  m.org_id,
  uc.company_id,
  uc.user_overrides,
  uc.user_id,
  coalesce(uc.updated_at, now())
from public.user_companies uc
join public.org_members m on m.user_id = uc.user_id
where uc.company_id is not null
  and uc.user_overrides is not null
  and uc.user_overrides <> '{}'::jsonb
order by m.org_id, uc.company_id, uc.updated_at desc nulls last
on conflict (org_id, company_id) do update set
  overrides = public.org_company_overrides.overrides || excluded.overrides,
  overridden_by = excluded.overridden_by,
  overridden_at = greatest(public.org_company_overrides.overridden_at, excluded.overridden_at);

alter table public.org_contact_state enable row level security;
alter table public.org_contact_overrides enable row level security;
alter table public.org_companies enable row level security;
alter table public.org_company_overrides enable row level security;

create policy org_contact_state_member_read on public.org_contact_state
  for select to authenticated
  using (org_id = public.user_org_id());
create policy org_contact_state_member_write on public.org_contact_state
  for all to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy org_contact_overrides_member_read on public.org_contact_overrides
  for select to authenticated
  using (org_id = public.user_org_id());
create policy org_contact_overrides_member_write on public.org_contact_overrides
  for all to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy org_companies_member_read on public.org_companies
  for select to authenticated
  using (org_id = public.user_org_id());
create policy org_companies_member_write on public.org_companies
  for all to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

create policy org_company_overrides_member_read on public.org_company_overrides
  for select to authenticated
  using (org_id = public.user_org_id());
create policy org_company_overrides_member_write on public.org_company_overrides
  for all to authenticated
  using (org_id = public.user_org_id())
  with check (org_id = public.user_org_id());

comment on table public.org_contact_state is
  'Org-scoped contact membership/state: triage, pin/suppress/archive, and org ownership for a canonical person.';
comment on table public.org_contact_overrides is
  'Org-scoped manual person-field overrides. Read resolution is overrides over canonical people.';
comment on table public.org_companies is
  'Org-scoped company/account membership and scoring state for a canonical company.';
comment on table public.org_company_overrides is
  'Org-scoped manual company-field overrides. Read resolution is overrides over canonical companies.';
