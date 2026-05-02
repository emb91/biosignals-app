-- Persist deterministic company-vs-ICP fit scores and cache the winning ICP on
-- each company row for fast lead reads.

create table if not exists public.company_icp_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  icp_id uuid not null references public.icps(id) on delete cascade,
  final_score double precision not null default 0,
  raw_score double precision not null default 0,
  score_cap double precision not null default 1,
  company_type_match_status text not null default 'unknown',
  breakdown jsonb,
  coverage double precision,
  scored_at timestamp with time zone not null default now(),
  score_version text not null default 'company_fit_v1',
  unique (company_id, icp_id)
);

alter table public.companies
  add column if not exists matched_icp_id uuid references public.icps(id) on delete set null,
  add column if not exists company_fit_score double precision,
  add column if not exists company_fit_breakdown jsonb,
  add column if not exists company_fit_coverage double precision,
  add column if not exists company_fit_scored_at timestamp with time zone,
  add column if not exists company_fit_version text;

alter table public.company_icp_scores enable row level security;

drop policy if exists "Users can only access their own company icp scores" on public.company_icp_scores;
create policy "Users can only access their own company icp scores"
on public.company_icp_scores
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists company_icp_scores_user_id_idx
  on public.company_icp_scores(user_id);

create index if not exists company_icp_scores_company_id_idx
  on public.company_icp_scores(company_id);

create index if not exists company_icp_scores_icp_id_idx
  on public.company_icp_scores(icp_id);

create index if not exists company_icp_scores_final_score_desc_idx
  on public.company_icp_scores(final_score desc);

create index if not exists companies_matched_icp_id_idx
  on public.companies(matched_icp_id);
