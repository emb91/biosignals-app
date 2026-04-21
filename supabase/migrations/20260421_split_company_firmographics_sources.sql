-- Keep Apollo and Apify company firmographics separate so we can prefer
-- Apollo only for selected structured firmographics without losing the
-- LinkedIn-derived Apify presentation fields.
alter table public.contacts
add column if not exists apollo_company_firmographics jsonb,
add column if not exists apollo_company_firmographics_refreshed_at timestamp with time zone,
add column if not exists apify_company_firmographics jsonb,
add column if not exists apify_company_firmographics_refreshed_at timestamp with time zone;

-- Backfill older rows so existing resolved firmographics continue to render.
-- These rows predate the source split, so we treat the prior resolved payload
-- as Apify-originated display data.
update public.contacts
set apify_company_firmographics = resolved_company_firmographics
where apify_company_firmographics is null
  and resolved_company_firmographics is not null;

update public.contacts
set apify_company_firmographics_refreshed_at = coalesce(apify_company_firmographics_refreshed_at, updated_at)
where apify_company_firmographics is not null
  and apify_company_firmographics_refreshed_at is null;
