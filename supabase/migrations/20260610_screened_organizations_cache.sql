-- Screened-organizations cache for expand_companies acquisition jobs.
--
-- Records every Apollo organization ever evaluated for a (user, ICP) pair,
-- including rejects. Before running the keyword/fit screen on an org, the job
-- runner checks this cache: previously rejected orgs are skipped for free and
-- previously qualified ones short-circuit straight to qualified. This
-- guarantees each organization is screened (and metered) at most once per ICP
-- across all jobs, no matter how many times Apollo returns it.

begin;

create table if not exists public.screened_organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  icp_id uuid references public.icps(id) on delete cascade not null,
  apollo_org_id text,
  domain text,
  -- 'qualified' or a rejection reason such as 'rejected:keyword_mismatch'.
  verdict text not null,
  screened_at timestamp with time zone not null default now()
);

comment on table public.screened_organizations is
  'Every Apollo organization evaluated for a (user, ICP) pair, including rejects. The job runner consults this before paying to screen an org again (lib/data-acquisition/job-runner.ts).';

-- One verdict per org per (user, ICP). Orgs are keyed by Apollo id when we
-- have one and by normalized domain otherwise, so both get a partial unique
-- index.
create unique index if not exists screened_organizations_user_icp_org_idx
  on public.screened_organizations(user_id, icp_id, apollo_org_id)
  where apollo_org_id is not null;

create unique index if not exists screened_organizations_user_icp_domain_idx
  on public.screened_organizations(user_id, icp_id, domain)
  where domain is not null;

create index if not exists screened_organizations_user_icp_idx
  on public.screened_organizations(user_id, icp_id, screened_at desc);

alter table public.screened_organizations enable row level security;

drop policy if exists "Users can only access their own data" on public.screened_organizations;
create policy "Users can only access their own data"
on public.screened_organizations
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
