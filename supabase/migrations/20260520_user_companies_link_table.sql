-- Split the companies table into:
--   companies: canonical, one row per domain — shared metadata + enrichment
--   user_companies: per-(user, company) link — user-scoped state (archived,
--                   source, notes, custom fields)
--
-- Phase A: additive. Create user_companies, backfill from existing companies.
-- Old columns (companies.user_id, companies.archived_at, companies.source)
-- stay in place so existing code keeps working. Code migrates incrementally.

create table if not exists user_companies (
  user_id uuid not null,
  company_id uuid not null references companies(id) on delete cascade,
  archived_at timestamptz,
  source text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create index if not exists user_companies_user_idx on user_companies (user_id);
create index if not exists user_companies_company_idx on user_companies (company_id);
create index if not exists user_companies_active_idx
  on user_companies (user_id) where archived_at is null;

-- Backfill: every existing (user_id, company_id) tuple in companies becomes
-- a user_companies row.
insert into user_companies (user_id, company_id, archived_at, source, added_at, updated_at)
select
  user_id,
  id as company_id,
  archived_at,
  source,
  coalesce(created_at, now()) as added_at,
  coalesce(updated_at, now()) as updated_at
from companies
where user_id is not null
on conflict (user_id, company_id) do nothing;

alter table user_companies enable row level security;

create policy "user_companies_select_own" on user_companies
  for select using (auth.uid() = user_id);
create policy "user_companies_insert_own" on user_companies
  for insert with check (auth.uid() = user_id);
create policy "user_companies_update_own" on user_companies
  for update using (auth.uid() = user_id);
create policy "user_companies_delete_own" on user_companies
  for delete using (auth.uid() = user_id);
