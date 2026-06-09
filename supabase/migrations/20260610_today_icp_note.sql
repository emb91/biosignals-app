-- A tiny per-user "note" the /icps ICP audit writes, so /today can show an
-- "ICPs need attention" row by reading it (cheap) instead of running its own
-- Claude audit. One row per user; upserted each time the audit runs.

create table if not exists public.today_icp_note (
  user_id uuid primary key,
  issue_count int not null default 0,
  top_headline text,
  top_detail text,
  top_severity text,
  updated_at timestamptz not null default now()
);

alter table public.today_icp_note enable row level security;

create policy "users read own icp note" on public.today_icp_note
  for select using (auth.uid() = user_id);
create policy "users insert own icp note" on public.today_icp_note
  for insert with check (auth.uid() = user_id);
create policy "users update own icp note" on public.today_icp_note
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
