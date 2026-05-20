-- accounts_view: per-(user, company) flat row. Same shape as the old
-- pre-split companies table (with user_id + per-user state), but sourced
-- from the new canonical companies JOIN user_companies. Lets us migrate
-- every read from ".from('companies').eq('user_id', X)" to
-- ".from('accounts_view').eq('user_id', X)" without touching consumer
-- code's row shape.
--
-- Writes still go through companies (a trigger syncs per-user cols to
-- user_companies). After we drop per-user cols from companies, writes will
-- target user_companies directly.

create or replace view accounts_view with (security_invoker = true) as
select
  c.id,
  c.domain,
  c.company_name,
  c.website,
  c.description,
  c.industry,
  c.sub_industry,
  c.employee_count,
  c.employee_range,
  c.founded_year,
  c.headquarters_city,
  c.headquarters_country,
  c.headquarters_state,
  c.funding_stage,
  c.total_funding_usd,
  c.latest_funding_date,
  c.technologies,
  c.therapeutic_areas,
  c.modalities,
  c.clinical_stage,
  c.last_enriched_at,
  c.created_at,
  c.updated_at,
  c.follower_count,
  c.logo_url,
  c.linkedin_url,
  c.tagline,
  c.specialties,
  c.funding_data_source,
  c.funding_checked_at,
  c.bio_summary,
  c.funding_resolution_confidence,
  c.funding_resolution_summary,
  c.funding_resolution_last_error,
  c.funding_status_label,
  c.company_type,
  c.company_type_display,
  c.taxonomy_evidence_summary,
  c.development_stages,
  c.company_size_bucket,
  c.platform_category,
  c.products_services,
  c.services,
  c.aliases,
  c.aliases_updated_at,
  uc.user_id,
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
  'Per-(user, company) flat row joining canonical companies with per-user state from user_companies. Reads only — writes go to underlying tables.';
