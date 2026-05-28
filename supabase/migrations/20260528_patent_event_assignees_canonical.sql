-- Phase 3 (patents) — resolved canonical company id per (patent, assignee) row.
--
-- Single uuid (not array) because each row IS one assignee mention. Different
-- assignees on the same patent can resolve to different canonical companies;
-- joining back from patent_events to mentioned_company_ids would lose that.
--
-- Populated by lib/signals/sync-patents-delta.ts via the resolver. The monitor
-- (run-patents-monitor.ts) replaces its fuzzy ILIKE query against
-- assignee_name_normalized with an indexed equality on canonical_company_id.

ALTER TABLE patent_event_assignees
  ADD COLUMN IF NOT EXISTS canonical_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS patent_event_assignees_canonical_company_id_idx
  ON patent_event_assignees (canonical_company_id)
  WHERE canonical_company_id IS NOT NULL;
