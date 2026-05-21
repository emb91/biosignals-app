-- NIH RePORTER local mirror — grants signal V1.
--
-- Populated by /api/cron/grants-delta which hits the public NIH RePORTER v2
-- Project Search API (POST https://api.reporter.nih.gov/v2/projects/search)
-- for awards in the last N days under TWO union'd criteria:
--   1. activity_codes IN ('R41','R42','R43','R44','U43','U44')  -- SBIR/STTR
--   2. organization_type = 'Domestic For-Profits'                -- any NIH
--                                                                 -- for-profit
--      award (BARDA-via-NIH, R&D contracts, etc.)
--
-- Deduped by appl_id (NIH's unique application identifier — integer, stable).
-- The grants monitor matches awards to companies by normalized org_name
-- (with company aliases for legal-entity/subsidiary fan-out, same pattern as
-- the FDA/CT/patents monitors).
--
-- Signal emitted: grant_award → maps to new_budget readiness dimension.

create extension if not exists pg_trgm;

create table if not exists nih_grants_local (
  appl_id bigint primary key,                  -- NIH unique application id
  project_num text,                            -- e.g. "5R43HL178364-02"
  core_project_num text,                       -- e.g. "R43HL178364"
  activity_code text,                          -- e.g. "R43"
  award_type text,                             -- "1" new, "5" continuation, etc.
  award_amount numeric,                        -- USD
  award_notice_date date,                      -- canonical "award happened" date
  project_start_date date,
  project_end_date date,
  fiscal_year int,

  -- Organization (the recipient)
  org_name text,
  org_name_normalized text,                    -- for trgm matching
  org_type_code text,                          -- "FP", "HE", "SB", etc.
  org_type_name text,                          -- "Domestic For-Profits", etc.
  org_city text,
  org_state text,
  org_country text,
  org_uei text,                                -- federal unique entity id

  -- Agency context (which NIH institute funded)
  agency_ic_code text,                         -- e.g. "HL"
  agency_ic_abbr text,                         -- e.g. "NHLBI"
  agency_ic_name text,                         -- e.g. "National Heart Lung and Blood Institute"

  project_title text,
  contact_pi_name text,
  principal_investigators jsonb,               -- raw array from API
  is_active boolean,
  opportunity_number text,
  mechanism_code_dc text,                      -- "SB" = SBIR, "RP" = research project

  -- Flexible bag for V2 enrichment (spending_categories, terms, etc.)
  extras jsonb,

  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Primary matching path: org_name_normalized via trigram. Trigram + btree both
-- helpful — btree for exact-prefix ILIKE patterns, trgm for fuzzy similarity.
create index if not exists nih_grants_org_name_norm_idx
  on nih_grants_local (org_name_normalized);
create index if not exists nih_grants_org_name_trgm_idx
  on nih_grants_local using gin (org_name_normalized gin_trgm_ops);

create index if not exists nih_grants_award_notice_date_idx
  on nih_grants_local (award_notice_date desc);
create index if not exists nih_grants_activity_code_idx
  on nih_grants_local (activity_code);
create index if not exists nih_grants_org_type_code_idx
  on nih_grants_local (org_type_code);

-- Sync run log (mirrors fda/ct/patents delta_sync_runs pattern).
create table if not exists nih_grant_delta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                        -- running | success | failed
  cutoff_date date not null,                   -- earliest award_notice_date pulled
  awards_upserted int,
  sbir_pages_fetched int,
  for_profit_pages_fetched int,
  error text
);
create index if not exists nih_grant_delta_sync_runs_started_idx
  on nih_grant_delta_sync_runs (started_at desc);

-- Admin-only tables; service role bypasses RLS.
alter table nih_grants_local enable row level security;
alter table nih_grant_delta_sync_runs enable row level security;
