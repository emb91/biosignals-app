-- Phase 3 (funding) — resolved canonical company id per SEC filing.
-- Single uuid because each filing has one entity. Populated by
-- lib/signals/sync-sec-delta.ts and consumed by run-funding-monitor.ts.

ALTER TABLE sec_filings_local
  ADD COLUMN IF NOT EXISTS canonical_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sec_filings_local_canonical_company_id_idx
  ON sec_filings_local (canonical_company_id)
  WHERE canonical_company_id IS NOT NULL;
