-- Phase 3 (clinical trials) — resolved canonical company ids per trial.
--
-- Combines lead_sponsor + collaborators after resolution via
-- lib/companies/resolve-mentions.ts. Populated at ingest by
-- lib/signals/sync-ct-delta.ts and consumed by both phase-transition AND
-- principal-investigator signals via run-clinical-trials-monitor.ts.
--
-- *_normalized columns retained for one release as backfill safety net.

ALTER TABLE clinical_trials
  ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[];

CREATE INDEX IF NOT EXISTS clinical_trials_mentioned_company_ids_idx
  ON clinical_trials USING gin (mentioned_company_ids);
