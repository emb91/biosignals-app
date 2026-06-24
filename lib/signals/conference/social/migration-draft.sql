-- ============================================================================
-- DRAFT migration — conference SOCIAL-intent signal (Phase 3).  *** NOT APPLIED ***
-- Companion to docs/CONFERENCE_PHASE3_SOCIAL.md.
--
-- Do NOT run this from the scaffold. When productionizing, copy into
-- supabase/migrations/<timestamp>_conference_social_signal.sql, review, and apply
-- via the Supabase MCP. Modeled on the exhibitor migration
-- (../migration-draft.sql / conference_exhibitors_local).
--
-- Adds:
--   conferences.social_tags                  — per-show hashtags to search
--   conference_social_attendees_local        — shared mirror of scraped attendees
--                                              (resolver-at-ingest provenance)
--   conference_social_sync_runs              — sync run log
--
-- Signal emitted: attending_conference (scope CONTACT) → new_needs + new_strategy
-- readiness dimensions; phase-based lifecycle (upcoming/live/recent) with hard
-- expiry 21d post-event, enforced in the monitor via conference-phase.ts.
-- ============================================================================

create extension if not exists pg_trgm;

-- ── Per-conference social hashtags ──────────────────────────────────────────
-- Show- and year-specific (#ASCO26 != #ASCO25). The runner only sweeps a
-- conference whose social_tags is non-empty AND whose dates put it in the active
-- pre-event/live window (sync-social-delta.ts inSocialScrapeWindow).
alter table conferences add column if not exists social_tags text[] not null default '{}';

-- ── Shared mirror of scraped attendees (one row per conference + author) ─────
-- The scrape is shared across users; per-user attribution + contact ownership is
-- decided in run-social-monitor.ts (deduped at signal_source_events). This table
-- never stores a user_id.
create table if not exists conference_social_attendees_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,

  -- author (resolution input — the monitor cross-matches token + employer)
  author_name_raw text not null,            -- display name as posted
  author_name_token text,                   -- normalized "last f" cross-match token
  author_profile_url text,                  -- LinkedIn /in/… — strongest identifier
  author_headline text,                     -- profile headline / title line
  author_company_raw text,                  -- stated current employer

  -- post / evidence
  post_url text,
  post_text text,                           -- truncated post body (assertion source)
  posted_at timestamptz,
  matched_tags text[],                      -- which social_tags this post matched
  network text not null default 'linkedin', -- LinkedIn only in Phase 3

  -- attendance scoring (see apify-source.ts)
  assertion_cue text,                       -- which positive cue fired
  confidence numeric,                       -- assertion strength x author resolution

  -- provenance (matches the exhibitor mirror shape)
  source text not null,                     -- 'conference_social'
  source_url text,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- resolver-at-ingest: canonical COMPANY (from author_company_raw). The PERSON
  -- resolution is per-user (token + employer cross-check) and lives in the monitor.
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,          -- [{ source_field, source_text, company_id,
                                            --    company_name, resolved_by, confidence,
                                            --    verified, verification_reason }]

  -- One row per (conference, author). Re-scrapes upsert in place (highest-
  -- confidence post wins, resolved before upsert in sync-social-delta.ts).
  unique (conference_id, author_name_token)
);

create index if not exists conf_social_attendees_token_idx
  on conference_social_attendees_local (author_name_token);
create index if not exists conf_social_attendees_token_trgm_idx
  on conference_social_attendees_local using gin (author_name_token gin_trgm_ops);
create index if not exists conf_social_attendees_company_ids_idx
  on conference_social_attendees_local using gin (mentioned_company_ids);
create index if not exists conf_social_attendees_conf_idx
  on conference_social_attendees_local (conference_id);

-- ── Sync run log (mirrors *_sync_runs pattern) ──────────────────────────────
create table if not exists conference_social_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                     -- running | success | failed
  conferences_polled int,
  attendees_upserted int,
  error text
);
create index if not exists conf_social_sync_runs_started_idx
  on conference_social_sync_runs (started_at desc);

-- Admin-only tables; service role bypasses RLS.
alter table conference_social_attendees_local enable row level security;
alter table conference_social_sync_runs enable row level security;

-- (Productionizing) also extend, in the SHARED files (NOT here):
--   * lib/signals/readiness-types.ts   → SignalKey union: | 'attending_conference'
--   * lib/signals/readiness-catalog.ts → READINESS_SIGNAL_CATALOG entry
--       (scope 'contact', dimensions ['new_needs','new_strategy'], decayDays 30,
--        buyerFunctions ['business_development','commercial','partnerships'],
--        intentMechanisms ['commercial_interest']); optional
--        SIGNAL_IMPACT_OVERRIDES attending_conference: 34
--   * vercel.json                      → a 'conference-social' weekly cron
--   * the cron route + signals_run_history runner key 'conference-social'
