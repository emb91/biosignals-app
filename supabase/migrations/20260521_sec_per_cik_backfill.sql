-- Per-CIK 8-K catch-up tracking.
--
-- The global sec_filings_local backfill skips 8-Ks for CIKs not yet in the
-- `companies` table (efficient — avoids fetching ~10K primary docs/year for
-- companies nobody tracks). The trade-off: when a new public company is
-- added (or a CIK gets resolved post-backfill), their historical 8-Ks
-- are missing.
--
-- This column drives a per-company catch-up worker that hits
-- data.sec.gov/submissions/CIK{cik}.json and mirrors any missing 8-Ks from
-- the last 90 days. The funding-backfill cron drains this queue between
-- chunked global-backfill jobs.
--
-- Null = needs catch-up. Set to now() once the per-CIK 8-K window has been
-- mirrored. Form D and 424B don't need this — they're already mirrored
-- globally for the whole market by the daily delta + chunked backfill.

alter table companies add column if not exists cik_backfilled_at timestamptz;

-- Partial index over the catch-up queue. The drainer query is:
--   SELECT id, cik FROM companies
--   WHERE cik IS NOT NULL AND cik_backfilled_at IS NULL LIMIT N
-- Partial indexes stay tiny because most rows are either cik=null (private)
-- or already backfilled.
create index if not exists companies_cik_backfill_pending_idx
  on companies (cik) where cik is not null and cik_backfilled_at is null;
