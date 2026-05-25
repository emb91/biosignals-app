-- Conference appearances signal — V1.
--
-- Tracks specific events where a company in the user's book is presenting,
-- speaking, exhibiting, sponsoring, or otherwise showing up at a major
-- biotech / medical / scientific conference. Populated by a weekly LLM
-- web-search per company (Sonnet 4.6 + web_search_20250305).
--
-- One row per appearance — a single conference can yield multiple rows
-- (e.g., 3 separate posters from the same company at ASCO).
--
-- Signals emitted from this table:
--   * conference_presentation (company-scope) — always when an appearance is found
--   * conference_speaker (contact-scope) — when speaker_name fuzzy-matches an
--     existing contact at the company

create extension if not exists pg_trgm;

-- Track when each company was last researched, so we can lazy-refresh on a
-- 14-day cycle without re-paying for LLM calls every cron tick.
alter table companies add column if not exists conferences_checked_at timestamptz;

create table if not exists company_conference_appearances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null references companies(id) on delete cascade,

  conference_name text not null,
  conference_name_normalized text not null,  -- lowercase, suffix-stripped for matching
  conference_start_date date,
  conference_end_date date,
  location text,                              -- "Chicago, IL" / "Virtual"
  appearance_type text,                       -- presentation | speaker | poster | panel | exhibitor | sponsor

  session_title text,
  speaker_name text,
  speaker_title text,                         -- "Chief Medical Officer"
  matched_contact_id uuid,                    -- set when we found an existing contact match for speaker_name

  abstract_url text,
  source_url text,                            -- citation from web_search
  confidence text,                            -- low | medium | high
  rationale text,                             -- single-sentence sales-facing summary

  raw_payload jsonb,                          -- full LLM response object for the appearance
  ingested_at timestamptz not null default now(),

  -- Per-company dedupe key. NULLS in session_title / speaker_name still allow
  -- multiple rows if the conference itself differs.
  constraint company_conference_appearances_unique
    unique (company_id, conference_name_normalized, conference_start_date, session_title, speaker_name)
);

create index if not exists company_conference_appearances_user_idx
  on company_conference_appearances (user_id);
create index if not exists company_conference_appearances_company_idx
  on company_conference_appearances (company_id);
create index if not exists company_conference_appearances_start_date_idx
  on company_conference_appearances (conference_start_date desc);
create index if not exists company_conference_appearances_conference_name_trgm_idx
  on company_conference_appearances using gin (conference_name_normalized gin_trgm_ops);

alter table company_conference_appearances enable row level security;

create policy "Users can view their own conference appearances"
  on company_conference_appearances
  for select
  using (auth.uid() = user_id);

-- Run log (mirrors the other delta sync logs)
create table if not exists conferences_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                               -- null for bulk cron runs
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                       -- running | success | failed
  companies_checked int,
  companies_with_appearances int,
  appearances_upserted int,
  llm_calls int,
  error text
);
create index if not exists conferences_sync_runs_started_idx
  on conferences_sync_runs (started_at desc);

alter table conferences_sync_runs enable row level security;
