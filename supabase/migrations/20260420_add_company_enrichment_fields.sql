-- Add company enrichment fields from harvestapi/linkedin-company scrape
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS follower_count integer,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS specialties text[];

-- Store raw Apify company response on contacts for debugging
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS apify_company_raw jsonb;
