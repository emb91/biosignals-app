-- ============================================================================
-- DRAFT migration — conference / tradeshow exhibitor signal.  *** NOT APPLIED ***
--
-- Do NOT run this from the scaffold. When productionizing, copy into
-- supabase/migrations/<timestamp>_conference_exhibitor_signal.sql, review, and
-- apply via the Supabase MCP. Modeled on supabase/migrations/20260521_nih_grants_local.sql.
--
-- Two tables:
--   conferences                  — registry (seed from the WIDE workstream)
--   conference_exhibitors_local  — mirror (modeled on nih_grants_local), with
--                                  resolver-at-ingest provenance columns.
--
-- Signal emitted: exhibiting_at_conference → maps to new_needs + new_strategy
-- readiness dimensions (event-date-driven decay — see CONFERENCE_SIGNAL_PLAN.md).
-- ============================================================================

create extension if not exists pg_trgm;

-- ── Registry ────────────────────────────────────────────────────────────────
create table if not exists conferences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  platform text not null,                      -- 'mapyourshow' | 'conference_harvester'
                                               -- | 'spargo' | 'smallworldlabs'
                                               -- | 'terrapinn' | 'swapcard'
  event_url text,
  exhibitor_source_url text,                   -- adapter input (show code / EventKey
                                               -- / jspargo slug / swl subdomain / URL)
  platform_params jsonb,                       -- e.g. {"eventId":25702,"eventClientId":272}
                                               -- for conference_harvester
  start_date date,
  end_date date,
  venue text,
  country text,
  relevance_tags text[],                       -- ICP relevance (TAs / modalities / sector)
  access_status text,                          -- 'clean' | 'js' | 'gated'
  next_poll_at timestamptz,                    -- event-date-driven (see plan)
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conferences_platform_idx on conferences (platform);
create index if not exists conferences_next_poll_idx on conferences (next_poll_at);
create index if not exists conferences_dates_idx on conferences (start_date, end_date);

-- ── Mirror (modeled on nih_grants_local) ────────────────────────────────────
create table if not exists conference_exhibitors_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,

  company_name_raw text not null,              -- exhibitor name as printed
  company_name_normalized text,                -- normalizeCompanyForMatching(name)
  booth text,
  website text,                                -- when the platform carries it
  category text,                               -- when the platform carries it

  source text not null,                        -- 'conference_exhibitor'
  source_url text,
  fetched_at timestamptz not null default now(),

  -- Resolver-at-ingest provenance (same shape as nih_grants_local).
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,             -- [{ source_field, source_text, company_name,
                                               --    verification_reason, confidence, verified,
                                               --    resolved_by }]

  last_seen_at timestamptz not null default now(),

  -- One row per (conference, exhibitor name) — re-polls upsert in place.
  unique (conference_id, company_name_normalized)
);

create index if not exists conf_exhibitors_company_norm_idx
  on conference_exhibitors_local (company_name_normalized);
create index if not exists conf_exhibitors_company_norm_trgm_idx
  on conference_exhibitors_local using gin (company_name_normalized gin_trgm_ops);
create index if not exists conf_exhibitors_mentioned_ids_idx
  on conference_exhibitors_local using gin (mentioned_company_ids);
create index if not exists conf_exhibitors_conf_idx
  on conference_exhibitors_local (conference_id);

-- ── Sync run log (mirrors *_delta_sync_runs pattern) ────────────────────────
create table if not exists conference_exhibitor_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                        -- running | success | failed
  conferences_polled int,
  exhibitors_upserted int,
  error text
);
create index if not exists conf_exhibitor_sync_runs_started_idx
  on conference_exhibitor_sync_runs (started_at desc);

-- Admin-only tables; service role bypasses RLS.
alter table conferences enable row level security;
alter table conference_exhibitors_local enable row level security;
alter table conference_exhibitor_sync_runs enable row level security;
