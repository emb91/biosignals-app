-- =============================================================================
-- DRAFT — NOT APPLIED. Conference PRESENTER / speaker signal (Phase 2).
-- Companion to docs/CONFERENCE_PHASE2_PRESENTERS.md.
--
-- Sibling mirror to conference_exhibitors_local (Phase 1). Carries presenter +
-- session fields AND resolver-at-ingest provenance for BOTH a canonical company
-- (from the affiliation) AND a canonical person (from name + affiliation). The
-- Phase 1 exhibitor table + its monitor are left untouched.
--
-- Do NOT apply this from an agent. When productionizing, apply via the Supabase
-- MCP like the exhibitor migration (20260624130000_conference_exhibitor_signal.sql)
-- and record it in the migration history.
-- =============================================================================

create extension if not exists pg_trgm;

-- The presenter analog of conferences.exhibitor_source_url. The agenda/advance-
-- program URL is a distinct, separately-discovered surface (a show can sit on
-- Conference Harvester for exhibitors and eventScribe for its agenda).
alter table conferences add column if not exists agenda_source_url text;
alter table conferences add column if not exists agenda_platform text;

create table if not exists conference_appearances_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,

  -- person / role / session
  speaker_name_raw text not null,
  speaker_name_normalized text,            -- lowercased "last f" token for person matching
  speaker_title text,                      -- "Chief Medical Officer" / "PhD" credential line
  appearance_type text not null,           -- 'speaker' | 'poster' | 'chair' | 'moderator' | 'presenter'
  session_title text,
  affiliation_raw text,                    -- "University of Florida" / "Metrum RG" as printed
  abstract_url text,

  -- provenance (matches the exhibitor mirror shape)
  source text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- resolver-at-ingest: canonical COMPANY (from affiliation_raw)
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,         -- [{ source_field, source_text, company_id, company_name,
                                           --    resolved_by, confidence, verified, verification_reason }]

  -- resolver-at-ingest: canonical PERSON (from speaker_name + affiliation)
  mentioned_contact_ids uuid[],            -- canonical people.id matches
  mentioned_contact_matches jsonb,         -- [{ source_field, source_text, person_id, company_id,
                                           --    published_email, resolved_by, confidence,
                                           --    verified, verification_reason }]

  -- One row per (conference, speaker, session). Distinct sessions for the same
  -- speaker at one show each get a row; NULL session_title still allows a row.
  unique (conference_id, speaker_name_normalized, session_title)
);

create index if not exists conf_appearances_speaker_norm_idx
  on conference_appearances_local (speaker_name_normalized);
create index if not exists conf_appearances_speaker_norm_trgm_idx
  on conference_appearances_local using gin (speaker_name_normalized gin_trgm_ops);
create index if not exists conf_appearances_company_ids_idx
  on conference_appearances_local using gin (mentioned_company_ids);
create index if not exists conf_appearances_contact_ids_idx
  on conference_appearances_local using gin (mentioned_contact_ids);
create index if not exists conf_appearances_conf_idx
  on conference_appearances_local (conference_id);

create table if not exists conference_appearance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                    -- running | success | failed
  conferences_polled int,
  appearances_upserted int,
  error text
);
create index if not exists conf_appearance_sync_runs_started_idx
  on conference_appearance_sync_runs (started_at desc);

alter table conference_appearances_local enable row level security;
alter table conference_appearance_sync_runs enable row level security;

-- (Productionizing) also extend, in the SHARED files (not here):
--   * lib/signals/readiness-types.ts  → SignalKey union: | 'presenting_at_conference'
--   * lib/signals/readiness-catalog.ts → SIGNAL_CATALOG entry (scope 'contact',
--       dimensions ['new_needs','new_strategy'], decayDays 30,
--       buyerFunctions ['research_and_development','clinical_operations',
--                       'medical_affairs','commercial'],
--       intentMechanisms ['commercial_interest','strategy_shift'])
