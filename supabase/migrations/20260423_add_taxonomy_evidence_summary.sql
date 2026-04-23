alter table public.companies
  add column if not exists taxonomy_evidence_summary text;
