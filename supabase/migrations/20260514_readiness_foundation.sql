begin;

create extension if not exists pgcrypto;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.signal_source_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_scope text not null check (entity_scope in ('company', 'contact')),
  entity_company_id uuid null references public.companies(id) on delete cascade,
  entity_contact_id uuid null references public.contacts(id) on delete cascade,
  source text not null,
  source_event_type text not null,
  source_event_id text null,
  source_url text null,
  title text null,
  summary text null,
  excerpt text null,
  event_at timestamptz null,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signal_source_events_entity_check check (
    (entity_scope = 'company' and entity_company_id is not null and entity_contact_id is null)
    or
    (entity_scope = 'contact' and entity_contact_id is not null)
  )
);

create index if not exists signal_source_events_user_company_idx
  on public.signal_source_events (user_id, entity_company_id, observed_at desc);

create index if not exists signal_source_events_user_contact_idx
  on public.signal_source_events (user_id, entity_contact_id, observed_at desc);

create index if not exists signal_source_events_source_dedupe_idx
  on public.signal_source_events (user_id, source, coalesce(source_event_id, ''), coalesce(source_url, ''));

drop trigger if exists signal_source_events_updated_at on public.signal_source_events;
create trigger signal_source_events_updated_at
before update on public.signal_source_events
for each row execute function public.set_row_updated_at();

create table if not exists public.normalized_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id uuid not null references public.signal_source_events(id) on delete cascade,
  signal_key text not null,
  signal_scope text not null check (signal_scope in ('company', 'contact')),
  company_id uuid null references public.companies(id) on delete cascade,
  contact_id uuid null references public.contacts(id) on delete cascade,
  dimensions text[] not null,
  buyer_functions text[] not null default '{}',
  intent_mechanisms text[] not null default '{}',
  default_strength text not null check (default_strength in ('weak', 'medium', 'strong')),
  default_confidence text not null check (default_confidence in ('low', 'medium', 'high')),
  event_at timestamptz null,
  observed_at timestamptz not null,
  evidence_excerpt text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint normalized_signals_entity_check check (
    (signal_scope = 'company' and company_id is not null)
    or
    (signal_scope = 'contact' and contact_id is not null)
  )
);

create index if not exists normalized_signals_user_company_idx
  on public.normalized_signals (user_id, company_id, observed_at desc);

create index if not exists normalized_signals_user_contact_idx
  on public.normalized_signals (user_id, contact_id, observed_at desc);

create index if not exists normalized_signals_signal_key_idx
  on public.normalized_signals (user_id, signal_key, observed_at desc);

drop trigger if exists normalized_signals_updated_at on public.normalized_signals;
create trigger normalized_signals_updated_at
before update on public.normalized_signals
for each row execute function public.set_row_updated_at();

create table if not exists public.account_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  fit_score numeric(5,4) null,
  fit_label text null check (fit_label in ('low', 'medium', 'high')),
  overall_score numeric(5,4) not null,
  overall_label text not null check (overall_label in ('low', 'medium', 'high')),
  new_budget_score numeric(5,4) not null,
  new_budget_label text not null check (new_budget_label in ('low', 'medium', 'high')),
  new_budget_confidence text not null check (new_budget_confidence in ('low', 'medium', 'high')),
  new_needs_score numeric(5,4) not null,
  new_needs_label text not null check (new_needs_label in ('low', 'medium', 'high')),
  new_needs_confidence text not null check (new_needs_confidence in ('low', 'medium', 'high')),
  new_people_score numeric(5,4) not null,
  new_people_label text not null check (new_people_label in ('low', 'medium', 'high')),
  new_people_confidence text not null check (new_people_confidence in ('low', 'medium', 'high')),
  new_strategy_score numeric(5,4) not null,
  new_strategy_label text not null check (new_strategy_label in ('low', 'medium', 'high')),
  new_strategy_confidence text not null check (new_strategy_confidence in ('low', 'medium', 'high')),
  caution_score numeric(5,4) not null,
  caution_label text not null check (caution_label in ('low', 'medium', 'high')),
  caution_confidence text not null check (caution_confidence in ('low', 'medium', 'high')),
  top_signal_ids uuid[] not null default '{}',
  freshness_score numeric(5,4) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_readiness_snapshots_user_company_unique unique (user_id, company_id)
);

create index if not exists account_readiness_snapshots_user_readiness_idx
  on public.account_readiness_snapshots (user_id, overall_score desc, updated_at desc);

drop trigger if exists account_readiness_snapshots_updated_at on public.account_readiness_snapshots;
create trigger account_readiness_snapshots_updated_at
before update on public.account_readiness_snapshots
for each row execute function public.set_row_updated_at();

create table if not exists public.account_reason_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  readiness_snapshot_id uuid not null references public.account_readiness_snapshots(id) on delete cascade,
  summary_short text not null,
  summary_long text not null,
  why_now text not null,
  affected_functions text[] not null default '{}',
  suggested_angle text not null,
  confidence_label text not null check (confidence_label in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_reason_snapshots_user_company_unique unique (user_id, company_id)
);

drop trigger if exists account_reason_snapshots_updated_at on public.account_reason_snapshots;
create trigger account_reason_snapshots_updated_at
before update on public.account_reason_snapshots
for each row execute function public.set_row_updated_at();

create table if not exists public.readiness_snapshot_evidence (
  readiness_snapshot_id uuid not null references public.account_readiness_snapshots(id) on delete cascade,
  normalized_signal_id uuid not null references public.normalized_signals(id) on delete cascade,
  dimension text not null check (dimension in ('new_budget', 'new_needs', 'new_people', 'new_strategy', 'caution')),
  contribution numeric(5,4) not null,
  created_at timestamptz not null default now(),
  primary key (readiness_snapshot_id, normalized_signal_id, dimension)
);

create index if not exists readiness_snapshot_evidence_signal_idx
  on public.readiness_snapshot_evidence (normalized_signal_id);

commit;

