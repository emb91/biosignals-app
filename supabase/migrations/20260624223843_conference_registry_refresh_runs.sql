-- Conference registry-refresh monitor — run log (+ optional rotation column).
--
-- *** NOT APPLIED *** — created for human review. A second agent is concurrently
-- touching the same DB, so this build does NOT apply migrations or write schema.
-- Apply via the Supabase MCP after review.
--
-- The registry-refresh cron (app/api/cron/conference-registry-refresh) keeps the
-- `conferences` table pointed at each recurring show's LIVE edition. It logs each
-- run to this table, mirroring the per-signal *_sync_runs pattern
-- (conference_exhibitor_sync_runs, conference_appearance_sync_runs,
-- conference_social_sync_runs). The sync's run-row insert/update is best-effort:
-- until this is applied the cron still runs and returns its structured result;
-- it just can't persist the run row.

create table if not exists conference_registry_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,                          -- running | success | failed
  rows_checked int,
  rows_refreshed int,
  rows_unresolved int,
  error text
);
create index if not exists conf_registry_refresh_runs_started_idx
  on conference_registry_refresh_runs (started_at desc);

alter table conference_registry_refresh_runs enable row level security;

-- OPTIONAL (recommended): a dedicated rotation column so the refresh batch can
-- order strictly by least-recently-refreshed without colliding with the polling
-- rotation (last_polled_at) or generic updated_at. The sync currently rotates on
-- updated_at to avoid a schema change; switch refresh-registry.ts to order by
-- last_refreshed_at once this is applied.
alter table conferences add column if not exists last_refreshed_at timestamptz;
create index if not exists conferences_last_refreshed_idx
  on conferences (last_refreshed_at);
