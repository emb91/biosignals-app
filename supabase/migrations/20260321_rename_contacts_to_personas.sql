-- Rename contacts table to personas, preserving data and security artifacts.

do $$
begin
  if to_regclass('public.contacts') is not null and to_regclass('public.personas') is null then
    execute 'alter table public.contacts rename to personas';
  end if;
end $$;

-- Ensure personas table has required columns used by the app.
alter table if exists public.personas add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists public.personas add column if not exists name text;
alter table if exists public.personas add column if not exists functions text[];
alter table if exists public.personas add column if not exists seniority_levels text[];
alter table if exists public.personas add column if not exists job_titles text[];
alter table if exists public.personas add column if not exists signals text[];
alter table if exists public.personas add column if not exists icp_id uuid references public.icps(id) on delete set null;
alter table if exists public.personas add column if not exists created_at timestamp with time zone default now();
alter table if exists public.personas add column if not exists updated_at timestamp with time zone default now();

-- RLS and policies for personas.
alter table if exists public.personas enable row level security;
drop policy if exists "Users can only access their own data" on public.personas;
create policy "Users can only access their own data"
on public.personas
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Keep trigger semantics after rename.
drop trigger if exists contacts_updated_at on public.personas;
drop trigger if exists personas_updated_at on public.personas;
create trigger personas_updated_at
before update on public.personas
for each row execute function public.update_updated_at();

-- Helpful indexes.
create index if not exists personas_user_id_idx on public.personas(user_id);
create index if not exists personas_icp_id_idx on public.personas(icp_id);
create index if not exists personas_created_at_idx on public.personas(created_at desc);
