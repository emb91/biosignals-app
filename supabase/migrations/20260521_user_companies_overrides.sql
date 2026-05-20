-- Per-user overrides for editable account fields. Stored as a single JSONB
-- so adding new editable fields needs no schema change. Empty by default.
-- Reads via accounts_view COALESCE the override over the canonical companies
-- value, so user-edited fields display the user's edit; un-edited fields
-- fall back to the shared enrichment data.

alter table user_companies
  add column if not exists user_overrides jsonb not null default '{}';

drop view if exists accounts_view;

create view accounts_view with (security_invoker = true) as
select
  c.id,
  c.domain,
  coalesce(uc.user_overrides->>'company_name', c.company_name) as company_name,
  coalesce(uc.user_overrides->>'website', c.website) as website,
  coalesce(uc.user_overrides->>'description', c.description) as description,
  coalesce(uc.user_overrides->>'industry', c.industry) as industry,
  coalesce(uc.user_overrides->>'sub_industry', c.sub_industry) as sub_industry,
  coalesce((uc.user_overrides->>'employee_count')::int, c.employee_count) as employee_count,
  coalesce(uc.user_overrides->>'employee_range', c.employee_range) as employee_range,
  coalesce((uc.user_overrides->>'founded_year')::int, c.founded_year) as founded_year,
  coalesce(uc.user_overrides->>'headquarters_city', c.headquarters_city) as headquarters_city,
  coalesce(uc.user_overrides->>'headquarters_country', c.headquarters_country) as headquarters_country,
  coalesce(uc.user_overrides->>'headquarters_state', c.headquarters_state) as headquarters_state,
  c.funding_stage,
  c.total_funding_usd,
  c.latest_funding_date,
  c.technologies,
  coalesce(
    case when uc.user_overrides ? 'therapeutic_areas'
         then array(select jsonb_array_elements_text(uc.user_overrides->'therapeutic_areas'))
         else null end,
    c.therapeutic_areas
  ) as therapeutic_areas,
  coalesce(
    case when uc.user_overrides ? 'modalities'
         then array(select jsonb_array_elements_text(uc.user_overrides->'modalities'))
         else null end,
    c.modalities
  ) as modalities,
  coalesce(uc.user_overrides->>'clinical_stage', c.clinical_stage) as clinical_stage,
  c.last_enriched_at,
  c.created_at,
  c.updated_at,
  c.follower_count,
  c.logo_url,
  coalesce(uc.user_overrides->>'linkedin_url', c.linkedin_url) as linkedin_url,
  coalesce(uc.user_overrides->>'tagline', c.tagline) as tagline,
  c.specialties,
  c.funding_data_source,
  c.funding_checked_at,
  coalesce(uc.user_overrides->>'bio_summary', c.bio_summary) as bio_summary,
  c.funding_resolution_confidence,
  c.funding_resolution_summary,
  c.funding_resolution_last_error,
  c.funding_status_label,
  coalesce(uc.user_overrides->>'company_type', c.company_type) as company_type,
  coalesce(uc.user_overrides->>'company_type_display', c.company_type_display) as company_type_display,
  c.taxonomy_evidence_summary,
  coalesce(
    case when uc.user_overrides ? 'development_stages'
         then array(select jsonb_array_elements_text(uc.user_overrides->'development_stages'))
         else null end,
    c.development_stages
  ) as development_stages,
  coalesce(uc.user_overrides->>'company_size_bucket', c.company_size_bucket) as company_size_bucket,
  coalesce(uc.user_overrides->>'platform_category', c.platform_category) as platform_category,
  coalesce(
    case when uc.user_overrides ? 'products_services'
         then array(select jsonb_array_elements_text(uc.user_overrides->'products_services'))
         else null end,
    c.products_services
  ) as products_services,
  coalesce(
    case when uc.user_overrides ? 'services'
         then array(select jsonb_array_elements_text(uc.user_overrides->'services'))
         else null end,
    c.services
  ) as services,
  c.aliases,
  c.aliases_updated_at,
  uc.user_id,
  uc.user_overrides,
  uc.archived_at,
  uc.archived_by,
  uc.archived_reason,
  uc.source,
  uc.added_at,
  uc.matched_icp_id,
  uc.fit_score,
  uc.intent_score,
  uc.priority_score,
  uc.company_fit_score,
  uc.company_fit_breakdown,
  uc.company_fit_coverage,
  uc.company_fit_scored_at,
  uc.company_fit_version,
  uc.customer_therapeutic_areas,
  uc.customer_modalities,
  uc.customer_development_stages
from companies c
join user_companies uc on uc.company_id = c.id;

comment on view accounts_view is
  'Per-(user, company) flat row. Editable fields COALESCE per-user overrides over canonical companies data.';
