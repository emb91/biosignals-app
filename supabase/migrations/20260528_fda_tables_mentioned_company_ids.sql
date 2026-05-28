-- Phase 3 (FDA) — resolved canonical company ids on all three FDA tables.
-- Populated by lib/signals/sync-fda-delta.ts (sponsor_name / applicant) via
-- the resolver. Consumed by run-fda-regulatory-monitor.ts.

ALTER TABLE fda_drug_submissions
  ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[];
CREATE INDEX IF NOT EXISTS fda_drug_submissions_mentioned_company_ids_idx
  ON fda_drug_submissions USING gin (mentioned_company_ids);

ALTER TABLE fda_device_510k
  ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[];
CREATE INDEX IF NOT EXISTS fda_device_510k_mentioned_company_ids_idx
  ON fda_device_510k USING gin (mentioned_company_ids);

ALTER TABLE fda_device_pma
  ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[];
CREATE INDEX IF NOT EXISTS fda_device_pma_mentioned_company_ids_idx
  ON fda_device_pma USING gin (mentioned_company_ids);
