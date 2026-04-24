-- Add services column to company_analyses
-- Splits products_services into separate products_services (products only) and services arrays
-- so CRO/CDMO/service-led companies get their own section in the UI

ALTER TABLE public.company_analyses
  ADD COLUMN IF NOT EXISTS services text[];
