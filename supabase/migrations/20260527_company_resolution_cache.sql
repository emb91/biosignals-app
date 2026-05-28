-- Phase 2 — resolver cache.
--
-- Memoises raw-name → canonical-company-id lookups so repeated mentions of the
-- same company across articles/grants/etc. don't re-run trigram and LLM
-- disambiguation every time.
--
-- A row exists for every name we've ever resolved (including "no match"
-- entries where canonical_company_id IS NULL — caching the miss prevents
-- re-querying the LLM on obviously-unknown names).
--
-- Invalidation:
--   * New canonical company → blow all NULL entries (they might now match)
--   * Updated canonical (name/aliases) → blow entries pointing to that company
--     plus all NULL entries
--   * Deleted canonical → CASCADE drops the matching hits; NULL entries
--     unaffected (the deletion doesn't introduce new match possibilities)

CREATE TABLE IF NOT EXISTS company_resolution_cache (
  raw_name_normalized text PRIMARY KEY,
  canonical_company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  confidence double precision NOT NULL DEFAULT 0,
  resolved_by text NOT NULL,           -- 'exact' | 'alias' | 'substring' | 'trgm' | 'llm' | 'no_match'
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_resolution_cache_company_idx
  ON company_resolution_cache (canonical_company_id)
  WHERE canonical_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_resolution_cache_misses_idx
  ON company_resolution_cache (resolved_at)
  WHERE canonical_company_id IS NULL;

-- Invalidation trigger.
CREATE OR REPLACE FUNCTION invalidate_company_resolution_cache()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New canonical company may now match previously-unresolvable names.
    DELETE FROM company_resolution_cache WHERE canonical_company_id IS NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.company_name IS DISTINCT FROM OLD.company_name)
       OR (NEW.aliases IS DISTINCT FROM OLD.aliases) THEN
      DELETE FROM company_resolution_cache
        WHERE canonical_company_id = NEW.id
           OR canonical_company_id IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_company_resolution_cache_ins ON companies;
CREATE TRIGGER trg_invalidate_company_resolution_cache_ins
  AFTER INSERT ON companies
  FOR EACH ROW EXECUTE FUNCTION invalidate_company_resolution_cache();

DROP TRIGGER IF EXISTS trg_invalidate_company_resolution_cache_upd ON companies;
CREATE TRIGGER trg_invalidate_company_resolution_cache_upd
  AFTER UPDATE OF company_name, aliases ON companies
  FOR EACH ROW EXECUTE FUNCTION invalidate_company_resolution_cache();

-- Admin-managed table; service role bypasses RLS. No user-facing access.
ALTER TABLE company_resolution_cache ENABLE ROW LEVEL SECURITY;
