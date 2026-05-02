-- Separate software / product type from scientific modality.
-- This keeps modalities taxonomy-bound while allowing a short free-form
-- platform category for software-first companies.

alter table if exists public.icps
  add column if not exists platform_category text;

alter table if exists public.company_analyses
  add column if not exists platform_category text;

alter table if exists public.companies
  add column if not exists platform_category text;
