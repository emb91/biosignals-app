-- After renaming intent_score → readiness_score, accounts_view's frozen output
-- column name (intent_score) and the list_user_accounts RPC (which referenced
-- contacts.intent_score) are stale/broken. Recreate both with readiness
-- vocabulary. Preserve security_invoker + grants on the view, EXECUTE on the fn.
-- The RPC output column max_contact_intent_score is renamed to
-- max_contact_readiness_score.

DROP VIEW IF EXISTS public.accounts_view;
CREATE VIEW public.accounts_view WITH (security_invoker=true) AS
 SELECT c.id,
    c.domain,
    COALESCE((uc.user_overrides ->> 'company_name'::text), c.company_name) AS company_name,
    COALESCE((uc.user_overrides ->> 'website'::text), c.website) AS website,
    COALESCE((uc.user_overrides ->> 'description'::text), c.description) AS description,
    COALESCE((uc.user_overrides ->> 'industry'::text), c.industry) AS industry,
    COALESCE((uc.user_overrides ->> 'sub_industry'::text), c.sub_industry) AS sub_industry,
    COALESCE(((uc.user_overrides ->> 'employee_count'::text))::integer, c.employee_count) AS employee_count,
    COALESCE((uc.user_overrides ->> 'employee_range'::text), c.employee_range) AS employee_range,
    COALESCE(((uc.user_overrides ->> 'founded_year'::text))::integer, c.founded_year) AS founded_year,
    COALESCE((uc.user_overrides ->> 'headquarters_city'::text), c.headquarters_city) AS headquarters_city,
    COALESCE((uc.user_overrides ->> 'headquarters_country'::text), c.headquarters_country) AS headquarters_country,
    COALESCE((uc.user_overrides ->> 'headquarters_state'::text), c.headquarters_state) AS headquarters_state,
    c.funding_stage,
    c.total_funding_usd,
    c.latest_funding_date,
    c.technologies,
    COALESCE(CASE WHEN (uc.user_overrides ? 'therapeutic_areas'::text) THEN ARRAY( SELECT jsonb_array_elements_text((uc.user_overrides -> 'therapeutic_areas'::text)) AS jsonb_array_elements_text) ELSE NULL::text[] END, c.therapeutic_areas) AS therapeutic_areas,
    COALESCE(CASE WHEN (uc.user_overrides ? 'modalities'::text) THEN ARRAY( SELECT jsonb_array_elements_text((uc.user_overrides -> 'modalities'::text)) AS jsonb_array_elements_text) ELSE NULL::text[] END, c.modalities) AS modalities,
    COALESCE((uc.user_overrides ->> 'clinical_stage'::text), c.clinical_stage) AS clinical_stage,
    c.last_enriched_at,
    c.created_at,
    c.updated_at,
    c.follower_count,
    c.logo_url,
    COALESCE((uc.user_overrides ->> 'linkedin_url'::text), c.linkedin_url) AS linkedin_url,
    COALESCE((uc.user_overrides ->> 'tagline'::text), c.tagline) AS tagline,
    c.specialties,
    c.funding_data_source,
    c.funding_checked_at,
    COALESCE((uc.user_overrides ->> 'bio_summary'::text), c.bio_summary) AS bio_summary,
    c.funding_resolution_confidence,
    c.funding_resolution_summary,
    c.funding_resolution_last_error,
    c.funding_status_label,
    COALESCE((uc.user_overrides ->> 'company_type'::text), c.company_type) AS company_type,
    COALESCE((uc.user_overrides ->> 'company_type_display'::text), c.company_type_display) AS company_type_display,
    c.taxonomy_evidence_summary,
    COALESCE(CASE WHEN (uc.user_overrides ? 'development_stages'::text) THEN ARRAY( SELECT jsonb_array_elements_text((uc.user_overrides -> 'development_stages'::text)) AS jsonb_array_elements_text) ELSE NULL::text[] END, c.development_stages) AS development_stages,
    COALESCE((uc.user_overrides ->> 'company_size_bucket'::text), c.company_size_bucket) AS company_size_bucket,
    COALESCE((uc.user_overrides ->> 'platform_category'::text), c.platform_category) AS platform_category,
    COALESCE(CASE WHEN (uc.user_overrides ? 'products_services'::text) THEN ARRAY( SELECT jsonb_array_elements_text((uc.user_overrides -> 'products_services'::text)) AS jsonb_array_elements_text) ELSE NULL::text[] END, c.products_services) AS products_services,
    COALESCE(CASE WHEN (uc.user_overrides ? 'services'::text) THEN ARRAY( SELECT jsonb_array_elements_text((uc.user_overrides -> 'services'::text)) AS jsonb_array_elements_text) ELSE NULL::text[] END, c.services) AS services,
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
    uc.readiness_score,
    uc.priority_score,
    uc.company_fit_score,
    uc.company_fit_breakdown,
    uc.company_fit_coverage,
    uc.company_fit_scored_at,
    uc.company_fit_version,
    uc.customer_therapeutic_areas,
    uc.customer_modalities,
    uc.customer_development_stages
   FROM (companies c
     JOIN user_companies uc ON ((uc.company_id = c.id)));

GRANT ALL ON public.accounts_view TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer);
CREATE OR REPLACE FUNCTION public.list_user_accounts(p_user_id uuid, p_search text DEFAULT NULL::text, p_coverage_gaps_only boolean DEFAULT false, p_min_company_fit double precision DEFAULT 0.65, p_max_best_contact_fit double precision DEFAULT 1.0, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, company_name text, domain text, website text, logo_url text, company_fit_score double precision, company_fit_coverage double precision, matched_icp_id uuid, therapeutic_areas text[], modalities text[], development_stages text[], funding_stage text, funding_status_label text, total_funding_usd numeric, latest_funding_date text, funding_resolution_summary text, company_type text, industry text, sub_industry text, clinical_stage text, platform_category text, company_size_bucket text, tagline text, linkedin_url text, description text, bio_summary text, employee_count integer, employee_range text, headquarters_city text, headquarters_state text, headquarters_country text, founded_year integer, specialties text[], products_services text[], services text[], technologies text[], last_enriched_at timestamp with time zone, contact_count bigint, best_contact_fit double precision, worst_contact_fit double precision, avg_contact_fit double precision, max_contact_readiness_score double precision, readiness_score numeric, readiness_label text, priority_score numeric, uc_source text, uc_added_at timestamp with time zone, user_overrides jsonb, total_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  WITH contact_agg AS (
    SELECT
      company_id,
      COUNT(*) AS contact_count,
      MAX(CASE WHEN contact_fit_score > 1 AND contact_fit_score <= 100 THEN contact_fit_score / 100.0
               WHEN contact_fit_score >= 0 AND contact_fit_score <= 1  THEN contact_fit_score
               ELSE NULL END) AS best_contact_fit,
      MIN(CASE WHEN contact_fit_score > 1 AND contact_fit_score <= 100 THEN contact_fit_score / 100.0
               WHEN contact_fit_score >= 0 AND contact_fit_score <= 1  THEN contact_fit_score
               ELSE NULL END) AS worst_contact_fit,
      AVG(CASE WHEN contact_fit_score > 1 AND contact_fit_score <= 100 THEN contact_fit_score / 100.0
               WHEN contact_fit_score >= 0 AND contact_fit_score <= 1  THEN contact_fit_score
               ELSE NULL END) AS avg_contact_fit,
      MAX(CASE WHEN readiness_score > 0 THEN readiness_score ELSE NULL END) AS max_contact_readiness_score
    FROM contacts
    WHERE user_id    = p_user_id
      AND archived_at IS NULL
      AND company_id  IS NOT NULL
    GROUP BY company_id
  ),
  base AS (
    SELECT
      c.id, c.company_name, c.domain, c.website, c.logo_url,
      uc.company_fit_score, uc.company_fit_coverage, uc.matched_icp_id,
      c.therapeutic_areas, c.modalities, c.development_stages,
      c.funding_stage, c.funding_status_label, c.total_funding_usd,
      c.latest_funding_date::text       AS latest_funding_date,
      c.funding_resolution_summary, c.company_type,
      c.industry, c.sub_industry, c.clinical_stage, c.platform_category,
      c.company_size_bucket, c.tagline,
      c.linkedin_url, c.description, c.bio_summary,
      c.employee_count, c.employee_range,
      c.headquarters_city, c.headquarters_state, c.headquarters_country, c.founded_year,
      c.specialties, c.products_services, c.services, c.technologies,
      c.last_enriched_at,
      COALESCE(agg.contact_count, 0)    AS contact_count,
      agg.best_contact_fit, agg.worst_contact_fit, agg.avg_contact_fit,
      agg.max_contact_readiness_score,
      snap.overall_score                AS readiness_score,
      snap.overall_label                AS readiness_label,
      snap.priority_score,
      uc.source                         AS uc_source,
      uc.added_at                       AS uc_added_at,
      uc.user_overrides
    FROM user_companies uc
    INNER JOIN companies c
            ON c.id = uc.company_id
    LEFT  JOIN contact_agg agg
            ON agg.company_id = c.id
    LEFT  JOIN account_readiness_snapshots snap
            ON snap.company_id = c.id
           AND snap.user_id    = p_user_id
    WHERE uc.user_id     = p_user_id
      AND uc.archived_at IS NULL
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (
      p_search IS NULL OR p_search = ''
      OR company_name         ILIKE '%' || p_search || '%'
      OR domain               ILIKE '%' || p_search || '%'
      OR funding_stage        ILIKE '%' || p_search || '%'
      OR funding_status_label ILIKE '%' || p_search || '%'
      OR company_type         ILIKE '%' || p_search || '%'
      OR industry             ILIKE '%' || p_search || '%'
      OR EXISTS (SELECT 1 FROM unnest(therapeutic_areas)  t WHERE t ILIKE '%' || p_search || '%')
      OR EXISTS (SELECT 1 FROM unnest(modalities)         m WHERE m ILIKE '%' || p_search || '%')
      OR EXISTS (SELECT 1 FROM unnest(development_stages) d WHERE d ILIKE '%' || p_search || '%')
    )
    AND (
      NOT p_coverage_gaps_only
      OR (
        company_fit_score >= p_min_company_fit
        AND COALESCE(best_contact_fit, 0::double precision) <= p_max_best_contact_fit
      )
    )
  )
  SELECT
    f.id, f.company_name, f.domain, f.website, f.logo_url,
    f.company_fit_score, f.company_fit_coverage, f.matched_icp_id,
    f.therapeutic_areas, f.modalities, f.development_stages,
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
    COUNT(*) OVER ()                    AS total_count
  FROM filtered f
  ORDER BY f.priority_score DESC NULLS LAST,
           f.company_fit_score DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer) TO anon, authenticated, service_role;
