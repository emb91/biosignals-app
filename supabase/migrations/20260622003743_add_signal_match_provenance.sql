-- Store source-level company match provenance so signal monitors can require
-- verified evidence instead of trusting bare mentioned_company_ids.

alter table if exists public.clinical_trials
  add column if not exists mentioned_company_matches jsonb not null default '[]'::jsonb;

alter table if exists public.press_release_articles
  add column if not exists mentioned_company_matches jsonb not null default '[]'::jsonb;

alter table if exists public.nih_grants_local
  add column if not exists mentioned_company_matches jsonb not null default '[]'::jsonb;

alter table if exists public.fda_drug_submissions
  add column if not exists mentioned_company_matches jsonb not null default '[]'::jsonb;

alter table if exists public.fda_device_510k
  add column if not exists mentioned_company_matches jsonb not null default '[]'::jsonb;

alter table if exists public.fda_device_pma
  add column if not exists mentioned_company_matches jsonb not null default '[]'::jsonb;

alter table if exists public.patent_event_assignees
  add column if not exists canonical_company_match jsonb null;

alter table if exists public.sec_filings_local
  add column if not exists canonical_company_match jsonb null;

create index if not exists clinical_trials_company_matches_gin
  on public.clinical_trials using gin (mentioned_company_matches);

create index if not exists press_release_articles_company_matches_gin
  on public.press_release_articles using gin (mentioned_company_matches);

create index if not exists nih_grants_local_company_matches_gin
  on public.nih_grants_local using gin (mentioned_company_matches);

create index if not exists fda_drug_submissions_company_matches_gin
  on public.fda_drug_submissions using gin (mentioned_company_matches);

create index if not exists fda_device_510k_company_matches_gin
  on public.fda_device_510k using gin (mentioned_company_matches);

create index if not exists fda_device_pma_company_matches_gin
  on public.fda_device_pma using gin (mentioned_company_matches);
