-- SEC EDGAR filings local mirror — funding signal V1.
--
-- Populated by the daily /api/cron/funding-delta cron, which walks EDGAR's
-- pipe-delimited daily-index files for the last N days and ingests:
--   - Form D / D/A (private-placement filings — Reg D)
--   - 8-K with Item 3.02 (unregistered equity sales — PIPEs)
--   - 424B1..B7 (prospectus filings — the cash event after an S-1/S-3 shelf)
--
-- All three map to the `new_budget` readiness dimension via the existing
-- `funding_round` and `ipo_or_follow_on` signal keys.
--
-- Companies are joined in by zero-padded CIK (preferred) or by
-- entity_name_normalized fallback (for private companies whose CIK we
-- haven't enriched yet).

create extension if not exists pg_trgm;

-- ── CIK columns on companies ────────────────────────────────────────────
alter table companies add column if not exists cik text;
alter table companies add column if not exists cik_checked_at timestamptz;

create index if not exists companies_cik_idx
  on companies (cik) where cik is not null;

-- ── SEC filings mirror (one row per filing) ─────────────────────────────
create table if not exists sec_filings_local (
  accession_number text primary key,           -- e.g., 0001234567-26-000123 (with dashes)
  form_type text not null,                     -- D, D/A, 8-K, 8-K/A, 424B1..424B7
  filing_date date not null,                   -- YYYY-MM-DD, canonical from daily-index
  cik text not null,                           -- zero-padded to 10 chars
  entity_name text,                            -- as-filed; dirty (case + suffix variations)
  entity_name_normalized text,                 -- for trgm matching when CIK unknown
  filing_url text not null,                    -- click-through URL on sec.gov
  primary_doc_url text,                        -- direct URL to primary_doc when known

  -- Form D specifics (null for other forms)
  total_offering_amount numeric,
  total_amount_sold numeric,
  total_remaining numeric,
  date_of_first_sale date,
  entity_type text,
  industry_group_type text,

  -- 8-K specifics: array of parsed item codes (e.g. ['1.01', '3.02'])
  items text[],

  -- Flexible bag for V2 enrichment (424B proceeds, related persons, etc.)
  extras jsonb,

  ingested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists sec_filings_local_cik_idx
  on sec_filings_local (cik);
create index if not exists sec_filings_local_form_type_idx
  on sec_filings_local (form_type);
create index if not exists sec_filings_local_filing_date_idx
  on sec_filings_local (filing_date desc);
create index if not exists sec_filings_local_entity_name_norm_idx
  on sec_filings_local (entity_name_normalized);
create index if not exists sec_filings_local_entity_name_trgm_idx
  on sec_filings_local using gin (entity_name_normalized gin_trgm_ops);
-- GIN on the items array supports `items @> ARRAY['3.02']` lookups for the
-- 8-K-PIPE detection path.
create index if not exists sec_filings_local_items_idx
  on sec_filings_local using gin (items);

-- ── Sync run log for SEC delta ──────────────────────────────────────────
create table if not exists sec_delta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                         -- running | success | failed | halted_rate_limit
  start_date date not null,
  end_date date not null,
  days_processed int,
  days_skipped_no_data int,
  filings_upserted int,
  form_d_upserted int,
  form_8k_upserted int,
  form_424b_upserted int,
  rate_limit_halted boolean default false,
  error text
);
create index if not exists sec_delta_sync_runs_started_idx
  on sec_delta_sync_runs (started_at desc);

-- Admin-only tables; service role bypasses RLS.
alter table sec_filings_local enable row level security;
alter table sec_delta_sync_runs enable row level security;
