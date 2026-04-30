-- Separate "own company" taxonomy from "customers served" (beachhead / buyer context).
-- Own: therapeutic_areas, modalities, development_stages on icps (unchanged semantics).
-- Served: customer_* — who the company sells into; do not merge with own fields.

alter table public.icps
  add column if not exists customer_therapeutic_areas text[] default '{}',
  add column if not exists customer_modalities text[] default '{}',
  add column if not exists customer_development_stages text[] default '{}';

alter table public.company_analyses
  add column if not exists customer_therapeutic_areas text[] default '{}',
  add column if not exists customer_modalities text[] default '{}',
  add column if not exists customer_development_stages text[] default '{}';

alter table public.companies
  add column if not exists customer_therapeutic_areas text[] default '{}',
  add column if not exists customer_modalities text[] default '{}',
  add column if not exists customer_development_stages text[] default '{}';
