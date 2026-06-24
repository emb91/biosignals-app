-- Conference / tradeshow exhibitor signal (exhibiting_at_conference).
-- Applied 2026-06-24 via the Supabase MCP; this file records it in version
-- control to match the rest of the migration history. Modeled on
-- nih_grants_local (shared mirror + resolver-at-ingest provenance).

create extension if not exists pg_trgm;

create table if not exists conferences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  platform text not null,
  event_url text,
  exhibitor_source_url text,
  platform_params jsonb,
  start_date date,
  end_date date,
  venue text,
  country text,
  relevance_tags text[],
  access_status text,
  tos_status text,
  next_poll_at timestamptz,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conferences_platform_idx on conferences (platform);
create index if not exists conferences_next_poll_idx on conferences (next_poll_at);
create index if not exists conferences_dates_idx on conferences (start_date, end_date);

create table if not exists conference_exhibitors_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,
  company_name_raw text not null,
  company_name_normalized text,
  booth text,
  website text,
  category text,
  source text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,
  last_seen_at timestamptz not null default now(),
  unique (conference_id, company_name_normalized)
);
create index if not exists conf_exhibitors_company_norm_idx on conference_exhibitors_local (company_name_normalized);
create index if not exists conf_exhibitors_company_norm_trgm_idx on conference_exhibitors_local using gin (company_name_normalized gin_trgm_ops);
create index if not exists conf_exhibitors_mentioned_ids_idx on conference_exhibitors_local using gin (mentioned_company_ids);
create index if not exists conf_exhibitors_conf_idx on conference_exhibitors_local (conference_id);

create table if not exists conference_exhibitor_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  conferences_polled int,
  exhibitors_upserted int,
  error text
);
create index if not exists conf_exhibitor_sync_runs_started_idx on conference_exhibitor_sync_runs (started_at desc);

alter table conferences enable row level security;
alter table conference_exhibitors_local enable row level security;
alter table conference_exhibitor_sync_runs enable row level security;
