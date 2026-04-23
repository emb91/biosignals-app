-- Add tracking fields for the company monitor pipeline.
-- funding_data_source: which module/source last set the funding_stage
-- funding_checked_at: when the funding module last ran for this company

alter table public.companies
  add column if not exists funding_data_source text,
  add column if not exists funding_checked_at timestamp with time zone;
