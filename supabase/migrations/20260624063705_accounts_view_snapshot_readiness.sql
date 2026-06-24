-- accounts_view must expose the authoritative account readiness snapshot.
--
-- The org_companies.readiness_score column is only a compatibility mirror. It
-- can drift when later company-state writes touch org_companies after a
-- readiness recompute. list_user_accounts already reads
-- account_readiness_snapshots; make the accounts_view compatibility surface do
-- the same so contacts, HubSpot export, billing monitoring, and detail routes
-- do not make product decisions from stale readiness.

create or replace view public.accounts_view with (security_invoker = true) as
select
  c.id,
  c.domain,
  coalesce(oco.overrides ->> 'company_name', c.company_name) as company_name,
  coalesce(oco.overrides ->> 'website', c.website) as website,
  coalesce(oco.overrides ->> 'description', c.description) as description,
  coalesce(oco.overrides ->> 'industry', c.industry) as industry,
  coalesce(oco.overrides ->> 'sub_industry', c.sub_industry) as sub_industry,
  coalesce((oco.overrides ->> 'employee_count')::integer, c.employee_count) as employee_count,
  coalesce(oco.overrides ->> 'employee_range', c.employee_range) as employee_range,
  coalesce((oco.overrides ->> 'founded_year')::integer, c.founded_year) as founded_year,
  coalesce(oco.overrides ->> 'headquarters_city', c.headquarters_city) as headquarters_city,
  coalesce(oco.overrides ->> 'headquarters_country', c.headquarters_country) as headquarters_country,
  coalesce(oco.overrides ->> 'headquarters_state', c.headquarters_state) as headquarters_state,
  c.funding_stage,
  c.total_funding_usd,
  c.latest_funding_date,
  c.technologies,
  coalesce(
    case
      when oco.overrides ? 'therapeutic_areas'
      then array(select jsonb_array_elements_text(oco.overrides -> 'therapeutic_areas'))
      else null::text[]
    end,
    c.therapeutic_areas
  ) as therapeutic_areas,
  coalesce(
    case
      when oco.overrides ? 'modalities'
      then array(select jsonb_array_elements_text(oco.overrides -> 'modalities'))
      else null::text[]
    end,
    c.modalities
  ) as modalities,
  coalesce(oco.overrides ->> 'clinical_stage', c.clinical_stage) as clinical_stage,
  c.last_enriched_at,
  c.created_at,
  c.updated_at,
  c.follower_count,
  c.logo_url,
  coalesce(oco.overrides ->> 'linkedin_url', c.linkedin_url) as linkedin_url,
  coalesce(oco.overrides ->> 'tagline', c.tagline) as tagline,
  c.specialties,
  c.funding_data_source,
  c.funding_checked_at,
  coalesce(oco.overrides ->> 'bio_summary', c.bio_summary) as bio_summary,
  c.funding_resolution_confidence,
  c.funding_resolution_summary,
  c.funding_resolution_last_error,
  c.funding_status_label,
  coalesce(oco.overrides ->> 'company_type', c.company_type) as company_type,
  coalesce(oco.overrides ->> 'company_type_display', c.company_type_display) as company_type_display,
  c.taxonomy_evidence_summary,
  coalesce(
    case
      when oco.overrides ? 'development_stages'
      then array(select jsonb_array_elements_text(oco.overrides -> 'development_stages'))
      else null::text[]
    end,
    c.development_stages
  ) as development_stages,
  coalesce(oco.overrides ->> 'company_size_bucket', c.company_size_bucket) as company_size_bucket,
  coalesce(oco.overrides ->> 'platform_category', c.platform_category) as platform_category,
  coalesce(
    case
      when oco.overrides ? 'products_services'
      then array(select jsonb_array_elements_text(oco.overrides -> 'products_services'))
      else null::text[]
    end,
    c.products_services
  ) as products_services,
  coalesce(
    case
      when oco.overrides ? 'services'
      then array(select jsonb_array_elements_text(oco.overrides -> 'services'))
      else null::text[]
    end,
    c.services
  ) as services,
  c.aliases,
  c.aliases_updated_at,
  om.user_id,
  coalesce(oco.overrides, '{}'::jsonb) as user_overrides,
  oc.archived_at,
  oc.archived_by,
  oc.archived_reason,
  oc.source,
  oc.added_at,
  oc.matched_icp_id,
  oc.fit_score,
  coalesce(ars.overall_score::double precision, oc.readiness_score) as readiness_score,
  case
    when oc.company_fit_score is not null
     and coalesce(ars.overall_score::double precision, oc.readiness_score) is not null
    then least(
      1.0::double precision,
      greatest(
        0.0::double precision,
        (case when oc.company_fit_score > 1 then oc.company_fit_score / 100.0 else oc.company_fit_score end)
        * (0.5 + 0.5 * coalesce(ars.overall_score::double precision, oc.readiness_score))
      )
    )
    else ars.priority_score::double precision
  end as priority_score,
  oc.company_fit_score,
  oc.company_fit_breakdown,
  oc.company_fit_coverage,
  oc.company_fit_scored_at,
  oc.company_fit_version,
  oc.customer_therapeutic_areas,
  oc.customer_modalities,
  oc.customer_development_stages,
  coalesce(oc.crm_is_suppressed, false) as crm_is_suppressed,
  c.enrichment_refresh_status,
  c.enrichment_refresh_last_error,
  c.enrichment_refresh_started_at,
  c.enrichment_refresh_finished_at
from public.org_members om
join public.org_companies oc on oc.org_id = om.org_id
join public.companies c on c.id = oc.company_id
left join public.org_company_overrides oco
  on oco.org_id = oc.org_id
 and oco.company_id = oc.company_id
left join public.account_readiness_snapshots ars
  on ars.user_id = om.user_id
 and ars.company_id = oc.company_id;

grant select on public.accounts_view to authenticated, service_role;

comment on view public.accounts_view is
  'Compatibility company detail view. Readiness/priority come from account_readiness_snapshots when present; org_companies remains a fit/state mirror.';
