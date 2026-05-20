create table if not exists public.signals_run_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  signal_key text not null,
  runner text not null,
  scope text not null check (scope in ('company', 'contact')),
  status text not null check (status in ('success', 'failed')),
  processed int,
  failed int,
  skipped_running int,
  emitted_signal_types jsonb not null default '[]'::jsonb,
  recomputed_companies jsonb not null default '[]'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  company_ids jsonb not null default '[]'::jsonb,
  contact_ids jsonb not null default '[]'::jsonb,
  limit_value int
);

alter table public.signals_run_history enable row level security;

drop policy if exists "Users see own signal run history" on public.signals_run_history;
create policy "Users see own signal run history"
  on public.signals_run_history for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own signal run history" on public.signals_run_history;
create policy "Users insert own signal run history"
  on public.signals_run_history for insert
  with check (auth.uid() = user_id);

create index if not exists signals_run_history_user_created_idx
  on public.signals_run_history (user_id, created_at desc);
