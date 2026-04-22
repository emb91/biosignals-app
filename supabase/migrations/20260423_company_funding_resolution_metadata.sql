alter table public.companies
  add column if not exists funding_resolution_confidence text,
  add column if not exists funding_resolution_summary text,
  add column if not exists funding_resolution_last_error text;
