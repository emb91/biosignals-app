-- Conference presenter / speaker signal (Phase 2, presenting_at_conference).
-- Applied 2026-06-24 via the Supabase MCP; recorded here for version control.
-- Sibling mirror to conference_exhibitors_local, with resolver-at-ingest
-- provenance for BOTH a canonical company (affiliation) and a canonical person.

create extension if not exists pg_trgm;

alter table conferences add column if not exists agenda_source_url text;
alter table conferences add column if not exists agenda_platform text;

create table if not exists conference_appearances_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,
  speaker_name_raw text not null,
  speaker_name_normalized text,
  speaker_title text,
  appearance_type text not null,
  session_title text,
  affiliation_raw text,
  abstract_url text,
  source text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,
  mentioned_contact_ids uuid[],
  mentioned_contact_matches jsonb,
  unique (conference_id, speaker_name_normalized, session_title)
);
create index if not exists conf_appearances_speaker_norm_idx on conference_appearances_local (speaker_name_normalized);
create index if not exists conf_appearances_speaker_norm_trgm_idx on conference_appearances_local using gin (speaker_name_normalized gin_trgm_ops);
create index if not exists conf_appearances_company_ids_idx on conference_appearances_local using gin (mentioned_company_ids);
create index if not exists conf_appearances_contact_ids_idx on conference_appearances_local using gin (mentioned_contact_ids);
create index if not exists conf_appearances_conf_idx on conference_appearances_local (conference_id);

create table if not exists conference_appearance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  conferences_polled int,
  appearances_upserted int,
  error text
);
create index if not exists conf_appearance_sync_runs_started_idx on conference_appearance_sync_runs (started_at desc);

alter table conference_appearances_local enable row level security;
alter table conference_appearance_sync_runs enable row level security;
