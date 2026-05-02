-- Promote target_customers, buyer_types, and competitors out of the
-- example_company_enrichment blob into first-class icps columns.
-- The blob becomes a read-only reference snapshot; editable ICP data lives here.

alter table public.icps
  add column if not exists target_customers  text[]  default '{}',
  add column if not exists buyer_types       text[]  default '{}',
  add column if not exists competitors       jsonb   default '[]';

-- Backfill: prefer user overrides if present, fall back to raw enriched values.
update public.icps
set
  target_customers = case
    when jsonb_typeof(example_company_enrichment->'target_customers_override') = 'array'
         and jsonb_array_length(example_company_enrichment->'target_customers_override') > 0
    then array(select jsonb_array_elements_text(example_company_enrichment->'target_customers_override'))
    when jsonb_typeof(example_company_enrichment->'target_customers') = 'array'
         and jsonb_array_length(example_company_enrichment->'target_customers') > 0
    then array(select jsonb_array_elements_text(example_company_enrichment->'target_customers'))
    else '{}'
  end,
  buyer_types = case
    when jsonb_typeof(example_company_enrichment->'customers_we_serve_override') = 'array'
         and jsonb_array_length(example_company_enrichment->'customers_we_serve_override') > 0
    then array(select jsonb_array_elements_text(example_company_enrichment->'customers_we_serve_override'))
    when jsonb_typeof(example_company_enrichment->'customers_we_serve') = 'array'
         and jsonb_array_length(example_company_enrichment->'customers_we_serve') > 0
    then array(select jsonb_array_elements_text(example_company_enrichment->'customers_we_serve'))
    else '{}'
  end,
  competitors = case
    when jsonb_typeof(example_company_enrichment->'competitors_enriched') = 'array'
    then example_company_enrichment->'competitors_enriched'
    else '[]'::jsonb
  end
where example_company_enrichment is not null;
