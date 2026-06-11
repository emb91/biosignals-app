-- Phase 6: track that profile enrichment has been attempted once, so we auto-run it the
-- first time (web-search → find LinkedIn → scrape → populate, the same treatment imported
-- contacts get) without re-spending on every visit. A manual refresh still works.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS enrichment_attempted_at timestamptz;
