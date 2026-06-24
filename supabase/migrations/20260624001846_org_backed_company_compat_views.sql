drop view if exists public.accounts_view;

create view public.accounts_view with (security_invoker = true) as
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
  oc.readiness_score,
  case
    when oc.company_fit_score is not null and oc.readiness_score is not null
    then (
      least(1.0, greatest(0.0,
        (case when oc.company_fit_score > 1 then oc.company_fit_score / 100.0 else oc.company_fit_score end)
        * (0.5 + 0.5 * oc.readiness_score)
      ))
    )::double precision
    else null::double precision
  end as priority_score,
  oc.company_fit_score,
  oc.company_fit_breakdown,
  oc.company_fit_coverage,
  oc.company_fit_scored_at,
  oc.company_fit_version,
  oc.customer_therapeutic_areas,
  oc.customer_modalities,
  oc.customer_development_stages,
  c.enrichment_refresh_status,
  c.enrichment_refresh_last_error,
  c.enrichment_refresh_started_at,
  c.enrichment_refresh_finished_at
from public.org_members om
join public.org_companies oc on oc.org_id = om.org_id
join public.companies c on c.id = oc.company_id
left join public.org_company_overrides oco
  on oco.org_id = oc.org_id
 and oco.company_id = oc.company_id;

grant select on public.accounts_view to authenticated, service_role;

drop function if exists public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer);

create or replace function public.list_user_accounts(
  p_user_id uuid,
  p_search text default null::text,
  p_coverage_gaps_only boolean default false,
  p_min_company_fit double precision default 0.65,
  p_max_best_contact_fit double precision default 1.0,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid, company_name text, domain text, website text, logo_url text, logo_cached text,
  company_fit_score double precision, company_fit_coverage double precision, matched_icp_id uuid,
  therapeutic_areas text[], modalities text[], development_stages text[],
  customer_therapeutic_areas text[], customer_modalities text[], customer_development_stages text[],
  funding_stage text, funding_status_label text, total_funding_usd numeric,
  latest_funding_date text, funding_resolution_summary text, company_type text,
  industry text, sub_industry text, clinical_stage text, platform_category text,
  company_size_bucket text, tagline text,
  linkedin_url text, description text, bio_summary text,
  employee_count integer, employee_range text,
  headquarters_city text, headquarters_state text, headquarters_country text, founded_year integer,
  specialties text[], products_services text[], services text[], technologies text[],
  last_enriched_at timestamp with time zone,
  contact_count bigint, best_contact_fit double precision, worst_contact_fit double precision,
  avg_contact_fit double precision, max_contact_readiness_score double precision,
  readiness_score numeric, readiness_label text, priority_score numeric,
  uc_source text, uc_added_at timestamp with time zone, user_overrides jsonb,
  enrichment_refresh_status text, enrichment_refresh_last_error text,
  enrichment_refresh_started_at timestamp with time zone, enrichment_refresh_finished_at timestamp with time zone,
  total_count bigint
)
language sql
stable
set search_path = public, pg_temp
as $function$
  with user_org as (
    select org_id
    from org_members
    where user_id = p_user_id
    limit 1
  ),
  contact_agg as (
    select
      company_id,
      count(*) as contact_count,
      max(case when contact_fit_score > 1 and contact_fit_score <= 100 then contact_fit_score / 100.0
               when contact_fit_score >= 0 and contact_fit_score <= 1 then contact_fit_score
               else null end) as best_contact_fit,
      min(case when contact_fit_score > 1 and contact_fit_score <= 100 then contact_fit_score / 100.0
               when contact_fit_score >= 0 and contact_fit_score <= 1 then contact_fit_score
               else null end) as worst_contact_fit,
      avg(case when contact_fit_score > 1 and contact_fit_score <= 100 then contact_fit_score / 100.0
               when contact_fit_score >= 0 and contact_fit_score <= 1 then contact_fit_score
               else null end) as avg_contact_fit,
      max(case when readiness_score > 0 then readiness_score else null end) as max_contact_readiness_score
    from user_contacts
    where user_id = p_user_id
      and archived_at is null
      and company_id is not null
    group by company_id
  ),
  base as (
    select
      c.id, c.company_name, c.domain, c.website, c.logo_url, c.logo_cached,
      oc.company_fit_score, oc.company_fit_coverage, oc.matched_icp_id,
      c.therapeutic_areas, c.modalities, c.development_stages,
      c.customer_therapeutic_areas, c.customer_modalities, c.customer_development_stages,
      c.funding_stage, c.funding_status_label, c.total_funding_usd,
      c.latest_funding_date::text as latest_funding_date,
      c.funding_resolution_summary, c.company_type,
      c.industry, c.sub_industry, c.clinical_stage, c.platform_category,
      c.company_size_bucket, c.tagline,
      c.linkedin_url, c.description, c.bio_summary,
      c.employee_count, c.employee_range,
      c.headquarters_city, c.headquarters_state, c.headquarters_country, c.founded_year,
      c.specialties, c.products_services, c.services, c.technologies,
      c.last_enriched_at,
      c.enrichment_refresh_status, c.enrichment_refresh_last_error,
      c.enrichment_refresh_started_at, c.enrichment_refresh_finished_at,
      coalesce(agg.contact_count, 0) as contact_count,
      agg.best_contact_fit, agg.worst_contact_fit, agg.avg_contact_fit,
      agg.max_contact_readiness_score,
      snap.overall_score as readiness_score,
      snap.overall_label as readiness_label,
      case
        when oc.company_fit_score is not null then
          least(1.0, greatest(0.0,
            (case when oc.company_fit_score > 1 then oc.company_fit_score / 100.0 else oc.company_fit_score end)
            * (0.5 + 0.5 * coalesce(snap.overall_score, oc.readiness_score, 0))
          ))::numeric
        else snap.priority_score
      end as priority_score,
      oc.source as uc_source,
      oc.added_at as uc_added_at,
      coalesce(oco.overrides, '{}'::jsonb) as user_overrides,
      coalesce(oc.crm_is_suppressed, false) as crm_is_suppressed
    from user_org uo
    join org_companies oc on oc.org_id = uo.org_id
    join companies c on c.id = oc.company_id
    left join org_company_overrides oco
      on oco.org_id = oc.org_id
     and oco.company_id = oc.company_id
    left join contact_agg agg on agg.company_id = c.id
    left join account_readiness_snapshots snap
      on snap.company_id = c.id
     and snap.user_id = p_user_id
    where oc.archived_at is null
  ),
  filtered as (
    select * from base
    where (
      p_search is null or p_search = ''
      or company_name ilike '%' || p_search || '%'
      or domain ilike '%' || p_search || '%'
      or funding_stage ilike '%' || p_search || '%'
      or funding_status_label ilike '%' || p_search || '%'
      or company_type ilike '%' || p_search || '%'
      or industry ilike '%' || p_search || '%'
      or exists (select 1 from unnest(therapeutic_areas) t where t ilike '%' || p_search || '%')
      or exists (select 1 from unnest(modalities) m where m ilike '%' || p_search || '%')
      or exists (select 1 from unnest(development_stages) d where d ilike '%' || p_search || '%')
      or exists (select 1 from unnest(customer_therapeutic_areas) ct where ct ilike '%' || p_search || '%')
      or exists (select 1 from unnest(customer_modalities) cm where cm ilike '%' || p_search || '%')
    )
    and (
      not p_coverage_gaps_only
      or (
        company_fit_score >= p_min_company_fit
        and coalesce(best_contact_fit, 0::double precision) <= p_max_best_contact_fit
      )
    )
  )
  select
    f.id, f.company_name, f.domain, f.website, f.logo_url, f.logo_cached,
    f.company_fit_score, f.company_fit_coverage, f.matched_icp_id,
    f.therapeutic_areas, f.modalities, f.development_stages,
    f.customer_therapeutic_areas, f.customer_modalities, f.customer_development_stages,
    f.funding_stage, f.funding_status_label, f.total_funding_usd,
    f.latest_funding_date, f.funding_resolution_summary, f.company_type,
    f.industry, f.sub_industry, f.clinical_stage, f.platform_category,
    f.company_size_bucket, f.tagline,
    f.linkedin_url, f.description, f.bio_summary,
    f.employee_count, f.employee_range,
    f.headquarters_city, f.headquarters_state, f.headquarters_country, f.founded_year,
    f.specialties, f.products_services, f.services, f.technologies,
    f.last_enriched_at,
    f.contact_count, f.best_contact_fit, f.worst_contact_fit,
    f.avg_contact_fit, f.max_contact_readiness_score,
    f.readiness_score, f.readiness_label, f.priority_score,
    f.uc_source, f.uc_added_at, f.user_overrides,
    f.enrichment_refresh_status, f.enrichment_refresh_last_error,
    f.enrichment_refresh_started_at, f.enrichment_refresh_finished_at,
    count(*) over () as total_count
  from filtered f
  order by f.crm_is_suppressed asc,
           f.priority_score desc nulls last,
           f.company_fit_score desc nulls last
  limit p_limit
  offset p_offset;
$function$;

create or replace function public.get_account_page_for_company(
  p_user_id uuid,
  p_company_id uuid,
  p_page_size integer default 50
)
returns integer
language sql
stable
set search_path = public, pg_temp
as $function$
  with user_org as (
    select org_id
    from org_members
    where user_id = p_user_id
    limit 1
  ),
  base as (
    select
      c.id,
      coalesce(oc.crm_is_suppressed, false) as crm_is_suppressed,
      oc.company_fit_score,
      case
        when oc.company_fit_score is not null then
          least(1.0, greatest(0.0,
            (case when oc.company_fit_score > 1 then oc.company_fit_score / 100.0 else oc.company_fit_score end)
            * (0.5 + 0.5 * coalesce(snap.overall_score, oc.readiness_score, 0))
          ))::numeric
        else snap.priority_score
      end as priority_score
    from user_org uo
    join org_companies oc on oc.org_id = uo.org_id
    join companies c on c.id = oc.company_id
    left join account_readiness_snapshots snap
      on snap.company_id = c.id
     and snap.user_id = p_user_id
    where oc.archived_at is null
  ),
  ranked as (
    select
      id,
      row_number() over (
        order by crm_is_suppressed asc,
                 priority_score desc nulls last,
                 company_fit_score desc nulls last,
                 id asc
      ) as rn
    from base
  )
  select greatest(1, ceil(rn::numeric / greatest(1, p_page_size)))::integer
  from ranked
  where id = p_company_id;
$function$;

grant execute on function public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer)
  to authenticated, service_role;
grant execute on function public.get_account_page_for_company(uuid, uuid, integer)
  to authenticated, service_role;

comment on view public.accounts_view is
  'Compatibility company detail view. Backed by org_companies and org_company_overrides; user_companies remains a legacy mirror only.';
