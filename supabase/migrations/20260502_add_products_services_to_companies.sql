-- Add products_services and services to companies table
-- Mirrors the ICP enrichment data model so lead company panels can show
-- rich AI-generated product/service descriptions rather than short Apollo keywords.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS products_services text[],
  ADD COLUMN IF NOT EXISTS services text[];
