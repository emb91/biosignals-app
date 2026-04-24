-- Store the full enrichment payload for the example company used when creating an ICP.
-- This lets us show the rich target company card even after the session ends.
alter table public.icps add column if not exists example_company_enrichment jsonb;
