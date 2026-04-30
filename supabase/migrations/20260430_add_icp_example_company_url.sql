-- Promote the reference company URL out of the example_company_enrichment jsonb
-- and into a dedicated NOT NULL column on `icps`.
--
-- Every ICP is modelled on a reference company, so the URL is required: it's
-- the canonical input we re-enrich from when the user clicks "Re-enrich" on
-- an ICP card. The enrichment jsonb still holds the full snapshot.

alter table public.icps
  add column if not exists example_company_url text;

update public.icps
   set example_company_url = example_company_enrichment->>'website'
 where example_company_url is null
   and example_company_enrichment->>'website' is not null;

alter table public.icps
  alter column example_company_url set not null;
