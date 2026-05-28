-- Phase 3 (grants) — resolved canonical company ids per NIH grant.
--
-- Populated by lib/signals/sync-nih-grants-delta.ts via the resolver.
-- Per-user monitor (run-grants-monitor.ts) uses array overlap instead of
-- ILIKE substring matching against org_name_normalized.

ALTER TABLE nih_grants_local
  ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[];

CREATE INDEX IF NOT EXISTS nih_grants_local_mentioned_company_ids_idx
  ON nih_grants_local USING gin (mentioned_company_ids);
