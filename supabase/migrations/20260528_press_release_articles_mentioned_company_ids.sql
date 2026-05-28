-- Phase 3 (press releases) — add resolved canonical company ids.
--
-- Populated by lib/signals/sync-press-release-delta.ts via the resolver
-- (lib/companies/resolve-mentions.ts) after classification. The per-user
-- monitor (run-press-release-monitor.ts) replaces its fragile
-- candidate_companies_normalized .cs.{term} lookup with an indexed array
-- overlap against this column.
--
-- candidate_companies_normalized is retained for one release cycle so the old
-- monitor can be re-enabled if matching quality regresses. Drop in Phase 5.

ALTER TABLE press_release_articles
  ADD COLUMN IF NOT EXISTS mentioned_company_ids uuid[];

CREATE INDEX IF NOT EXISTS press_release_articles_mentioned_company_ids_idx
  ON press_release_articles USING gin (mentioned_company_ids);
