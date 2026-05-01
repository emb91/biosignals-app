begin;

create extension if not exists pgcrypto;

create table if not exists public.icp_signal_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  icp_id uuid not null references public.icps(id) on delete cascade,
  signal_id text not null,
  rank integer not null,
  weight numeric(6,3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint icp_signal_selections_rank_check check (rank > 0),
  constraint icp_signal_selections_weight_check check (weight >= 0),
  constraint icp_signal_selections_unique_signal unique (icp_id, signal_id),
  constraint icp_signal_selections_unique_rank unique (icp_id, rank)
);

create index if not exists icp_signal_selections_user_id_idx
  on public.icp_signal_selections(user_id);

create index if not exists icp_signal_selections_icp_id_idx
  on public.icp_signal_selections(icp_id);

create table if not exists public.persona_signal_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  signal_id text not null,
  rank integer not null,
  weight numeric(6,3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint persona_signal_selections_rank_check check (rank > 0),
  constraint persona_signal_selections_weight_check check (weight >= 0),
  constraint persona_signal_selections_unique_signal unique (persona_id, signal_id),
  constraint persona_signal_selections_unique_rank unique (persona_id, rank)
);

create index if not exists persona_signal_selections_user_id_idx
  on public.persona_signal_selections(user_id);

create index if not exists persona_signal_selections_persona_id_idx
  on public.persona_signal_selections(persona_id);

alter table public.signals
  add column if not exists signal_scope text,
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists contact_id uuid references public.contacts(id) on delete cascade,
  add column if not exists detected_at timestamptz,
  add column if not exists source text,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists evidence_url text,
  add column if not exists confidence numeric(6,3),
  add column if not exists event_metadata jsonb,
  add column if not exists raw_payload jsonb;

update public.signals
set
  signal_scope = coalesce(
    signal_scope,
    case
      when entity_type in ('company', 'contact') then entity_type
      else 'company'
    end
  ),
  detected_at = coalesce(detected_at, signal_date, created_at, now()),
  source = coalesce(source, signal_source),
  title = coalesce(title, signal_type),
  event_metadata = coalesce(event_metadata, signal_detail)
where
  signal_scope is null
  or detected_at is null
  or source is null
  or title is null
  or event_metadata is null;

update public.signals
set company_id = entity_id
where signal_scope = 'company'
  and company_id is null;

update public.signals
set contact_id = entity_id
where signal_scope = 'contact'
  and contact_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'signals_scope_check'
      and conrelid = 'public.signals'::regclass
  ) then
    alter table public.signals
      add constraint signals_scope_check
      check (signal_scope in ('company', 'contact'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'signals_entity_presence_check'
      and conrelid = 'public.signals'::regclass
  ) then
    alter table public.signals
      add constraint signals_entity_presence_check
      check (
        (signal_scope = 'company' and company_id is not null and contact_id is null)
        or
        (signal_scope = 'contact' and contact_id is not null)
      );
  end if;
end $$;

alter table public.signals
  alter column signal_scope set not null,
  alter column detected_at set not null;

create index if not exists signals_company_id_detected_at_idx
  on public.signals(company_id, detected_at desc);

create index if not exists signals_contact_id_detected_at_idx
  on public.signals(contact_id, detected_at desc);

create index if not exists signals_scope_detected_at_idx
  on public.signals(signal_scope, detected_at desc);

create index if not exists signals_signal_type_detected_at_idx
  on public.signals(signal_type, detected_at desc);

create unique index if not exists signals_company_event_dedupe_idx
  on public.signals(signal_type, company_id, detected_at, coalesce(source, ''))
  where signal_scope = 'company';

create unique index if not exists signals_contact_event_dedupe_idx
  on public.signals(signal_type, contact_id, detected_at, coalesce(source, ''))
  where signal_scope = 'contact';

alter table public.icp_signal_selections enable row level security;
alter table public.persona_signal_selections enable row level security;

drop policy if exists "Users can only access their own icp signal selections" on public.icp_signal_selections;
create policy "Users can only access their own icp signal selections"
on public.icp_signal_selections
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own persona signal selections" on public.persona_signal_selections;
create policy "Users can only access their own persona signal selections"
on public.persona_signal_selections
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists icp_signal_selections_updated_at on public.icp_signal_selections;
create trigger icp_signal_selections_updated_at
before update on public.icp_signal_selections
for each row execute function public.update_updated_at();

drop trigger if exists persona_signal_selections_updated_at on public.persona_signal_selections;
create trigger persona_signal_selections_updated_at
before update on public.persona_signal_selections
for each row execute function public.update_updated_at();

commit;
