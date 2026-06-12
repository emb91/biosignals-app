-- Surface the customer-facing taxonomy (who an account SELLS INTO) in the
-- accounts list + search. For CRO / vendor / services companies the firm's
-- OWN therapeutic_areas / modalities are intentionally empty (they don't
-- develop drugs), but customer_therapeutic_areas / customer_modalities capture
-- the disease areas and modalities they serve (e.g. Sanguine -> Oncology).
-- Without these columns the Accounts table renders blank TAs for every CRO.
--
-- NOTE: rebuilt from the LIVE function definition (which is ahead of the older
-- committed migrations: reads user_contacts, readiness_score, website/industry/
-- enrichment_refresh_* columns, crm_is_suppressed ordering). Only the three
-- customer_* output columns + two search predicates are added here.

DROP FUNCTION IF EXISTS public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer);

CREATE OR REPLACE FUNCTION public.list_user_accounts(
  p_user_id uuid,
  p_search text DEFAULT NULL::text,
  p_coverage_gaps_only boolean DEFAULT false,
  p_min_company_fit double precision DEFAULT 0.65,
  p_max_best_contact_fit double precision DEFAULT 1.0,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
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
LANGUAGE sql STABLE AS $function$
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
    FROM user_contacts
    WHERE user_id    = p_user_id
      AND archived_at IS NULL
      AND company_id  IS NOT NULL
    GROUP BY company_id
  ),
  base AS (
    SELECT
      c.id, c.company_name, c.domain, c.website, c.logo_url, c.logo_cached,
      uc.company_fit_score, uc.company_fit_coverage, uc.matched_icp_id,
      c.therapeutic_areas, c.modalities, c.development_stages,
      c.customer_therapeutic_areas, c.customer_modalities, c.customer_development_stages,
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
      c.enrichment_refresh_status, c.enrichment_refresh_last_error,
      c.enrichment_refresh_started_at, c.enrichment_refresh_finished_at,
      COALESCE(agg.contact_count, 0)    AS contact_count,
      agg.best_contact_fit, agg.worst_contact_fit, agg.avg_contact_fit,
      agg.max_contact_readiness_score,
      snap.overall_score                AS readiness_score,
      snap.overall_label                AS readiness_label,
      CASE
        WHEN uc.company_fit_score IS NOT NULL THEN
          LEAST(1.0, GREATEST(0.0,
            (CASE WHEN uc.company_fit_score > 1 THEN uc.company_fit_score / 100.0
                  ELSE uc.company_fit_score END)
            * (0.5 + 0.5 * COALESCE(snap.overall_score, 0))
          ))::numeric
        ELSE snap.priority_score
      END                               AS priority_score,
      uc.source                         AS uc_source,
      uc.added_at                       AS uc_added_at,
      uc.user_overrides,
      COALESCE(uc.crm_is_suppressed, false) AS crm_is_suppressed
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
      OR EXISTS (SELECT 1 FROM unnest(therapeutic_areas)           t  WHERE t  ILIKE '%' || p_search || '%')
      OR EXISTS (SELECT 1 FROM unnest(modalities)                  m  WHERE m  ILIKE '%' || p_search || '%')
      OR EXISTS (SELECT 1 FROM unnest(development_stages)          d  WHERE d  ILIKE '%' || p_search || '%')
      OR EXISTS (SELECT 1 FROM unnest(customer_therapeutic_areas)  ct WHERE ct ILIKE '%' || p_search || '%')
      OR EXISTS (SELECT 1 FROM unnest(customer_modalities)         cm WHERE cm ILIKE '%' || p_search || '%')
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
    COUNT(*) OVER ()                    AS total_count
  FROM filtered f
  ORDER BY f.crm_is_suppressed ASC,
           f.priority_score DESC NULLS LAST,
           f.company_fit_score DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
$function$;
