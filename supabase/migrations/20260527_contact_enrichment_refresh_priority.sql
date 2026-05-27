-- Add a priority column to the enrichment refresh queue so job-change
-- triggered contacts are processed before routine manual refreshes.
--
-- Priority values:
--   0  default  — manual refresh button, routine re-enrichment
--   1  high     — triggered by job-change monitor (contact moved companies)
--
-- The queue cron orders by enrichment_refresh_priority DESC, updated_at ASC
-- so high-priority contacts always come first, with oldest-first tie-breaking
-- within each priority tier.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS enrichment_refresh_priority SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS contacts_enrichment_refresh_priority_idx
  ON contacts (enrichment_refresh_priority, updated_at)
  WHERE enrichment_refresh_status = 'requested';
