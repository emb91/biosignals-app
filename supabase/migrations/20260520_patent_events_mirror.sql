-- Patent events mirror.
--
-- Mirrors recent (>= 2019) publications from patents-public-data.patents.publications
-- into Supabase so the per-user patents monitor can match against a local table
-- instead of scanning BigQuery once per scan. The daily cron at
-- /api/cron/patents-delta keeps this table up-to-date.

create table if not exists patent_events (
  publication_number text primary key,
  kind_code text,
  country_code text,
  publication_date date,
  filing_date date,
  title text,
  abstract text,
  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists patent_events_publication_date_idx
  on patent_events (publication_date desc);

-- Many-to-many: one publication can have multiple assignees, and we want fast
-- lookups by normalized assignee name (lowercased, suffix-stripped) so the
-- per-user matcher is a single indexed query.
create table if not exists patent_event_assignees (
  publication_number text not null references patent_events(publication_number) on delete cascade,
  assignee_name text not null,
  assignee_name_normalized text not null,
  primary key (publication_number, assignee_name)
);

create index if not exists patent_event_assignees_normalized_idx
  on patent_event_assignees (assignee_name_normalized);

-- Log table for the daily cron — gives us a paper trail of what was ingested,
-- how much BigQuery scanned, and any failures.
create table if not exists patent_delta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  cutoff_date date not null,
  publications_upserted int,
  assignees_upserted int,
  bytes_billed bigint,
  error text
);

create index if not exists patent_delta_sync_runs_started_idx
  on patent_delta_sync_runs (started_at desc);

-- RLS: these are admin-only tables, no user_id. Service role bypasses RLS.
alter table patent_events enable row level security;
alter table patent_event_assignees enable row level security;
alter table patent_delta_sync_runs enable row level security;
