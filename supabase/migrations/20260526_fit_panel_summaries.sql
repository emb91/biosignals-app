-- Persisted summaries generated at fit-scoring time.
-- This avoids regenerating panel summaries on every drawer open.

alter table public.contacts
  add column if not exists contact_panel_summary text,
  add column if not exists contact_fit_summary text;

alter table public.companies
  add column if not exists company_fit_summary text;

alter table public.user_companies
  add column if not exists company_fit_summary text;

