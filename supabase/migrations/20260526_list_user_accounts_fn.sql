-- Option A: server-side accounts aggregation
-- Replaces the JS contacts scan + GROUP BY rollup in /api/accounts with a
-- single SQL query that joins contacts → companies → readiness snapshots,
-- aggregates contact stats per company, and returns a paginated result
-- ordered by priority_score DESC.

CREATE OR REPLACE FUNCTION list_user_accounts(
  p_user_id              uuid,
  p_search               text             DEFAULT NULL,
  p_coverage_gaps_only   boolean          DEFAULT false,
  p_min_company_fit      double precision DEFAULT 0.65,
  p_max_best_contact_fit double precision DEFAULT 1.0,
  p_limit                integer          DEFAULT 50,
  p_offset               integer          DEFAULT 0
)
RETURNS TABLE (
  id                         uuid,
  company_name               text,
  domain                     text,
  logo_url                   text,
  company_fit_score          double precision,
  company_fit_coverage       double precision,
  matched_icp_id             uuid,
  therapeutic_areas          text[],
  modalities                 text[],
  development_stages         text[],
  funding_stage              text,
  funding_status_label       text,
  total_funding_usd          numeric,
  latest_funding_date        text,
  funding_resolution_summary text,
  company_type               text,
  linkedin_url               text,
  description                text,
  bio_summary                text,
  employee_count             integer,
  employee_range             text,
  headquarters_city          text,
  headquarters_country       text,
  founded_year               integer,
  specialties                text[],
  products_services          text[],
  services                   text[],
  technologies               text[],
  last_enriched_at           timestamptz,
  contact_count              bigint,
  best_contact_fit           double precision,
  worst_contact_fit          double precision,
  avg_contact_fit            double precision,
  max_contact_intent_score   double precision,
  readiness_score            numeric,
  readiness_label            text,
  priority_score             numeric,
  uc_source                  text,
  uc_added_at                timestamptz,
  user_overrides             jsonb,
  total_count                bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH contact_agg AS (
    SELECT
      company_id,
      COUNT(*) AS contact_count,
      MAX(
        CASE
          WHEN contact_fit_score > 1 AND contact_fit_score <= 100 THEN contact_fit_score / 100.0
          WHEN contact_fit_score >= 0 AND contact_fit_score <= 1  THEN contact_fit_score
          ELSE NULL
        END
      ) AS best_contact_fit,
      MIN(
        CASE
          WHEN contact_fit_score > 1 AND contact_fit_score <= 100 THEN contact_fit_score / 100.0
          WHEN contact_fit_score >= 0 AND contact_fit_score <= 1  THEN contact_fit_score
          ELSE NULL
        END
      ) AS worst_contact_fit,
      AVG(
        CASE
          WHEN contact_fit_score > 1 AND contact_fit_score <= 100 THEN contact_fit_score / 100.0
          WHEN contact_fit_score >= 0 AND contact_fit_score <= 1  THEN contact_fit_score
          ELSE NULL
        END
      ) AS avg_contact_fit,
      MAX(
        CASE WHEN intent_score > 0 THEN intent_score ELSE NULL END
      ) AS max_contact_intent_score
    FROM contacts
    WHERE user_id    = p_user_id
      AND archived_at IS NULL
      AND company_id  IS NOT NULL
    GROUP BY company_id
  ),
  base AS (
    SELECT
      c.id,
      c.company_name,
      c.domain,
      c.logo_url,
      c.company_fit_score,
      c.company_fit_coverage,
      c.matched_icp_id,
      c.therapeutic_areas,
      c.modalities,
      c.development_stages,
      c.funding_stage,
      c.funding_status_label,
      c.total_funding_usd,
      c.latest_funding_date::text       AS latest_funding_date,
      c.funding_resolution_summary,
      c.company_type,
      c.linkedin_url,
      c.description,
      c.bio_summary,
      c.employee_count,
      c.employee_range,
      c.headquarters_city,
      c.headquarters_country,
      c.founded_year,
      c.specialties,
      c.products_services,
      c.services,
      c.technologies,
      c.last_enriched_at,
      COALESCE(agg.contact_count, 0)    AS contact_count,
      agg.best_contact_fit,
      agg.worst_contact_fit,
      agg.avg_contact_fit,
      agg.max_contact_intent_score,
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
      p_search IS NULL
      OR p_search = ''
      OR company_name         ILIKE '%' || p_search || '%'
      OR domain               ILIKE '%' || p_search || '%'
      OR funding_stage        ILIKE '%' || p_search || '%'
      OR funding_status_label ILIKE '%' || p_search || '%'
      OR company_type         ILIKE '%' || p_search || '%'
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
    f.id,
    f.company_name,
    f.domain,
    f.logo_url,
    f.company_fit_score,
    f.company_fit_coverage,
    f.matched_icp_id,
    f.therapeutic_areas,
    f.modalities,
    f.development_stages,
    f.funding_stage,
    f.funding_status_label,
    f.total_funding_usd,
    f.latest_funding_date,
    f.funding_resolution_summary,
    f.company_type,
    f.linkedin_url,
    f.description,
    f.bio_summary,
    f.employee_count,
    f.employee_range,
    f.headquarters_city,
    f.headquarters_country,
    f.founded_year,
    f.specialties,
    f.products_services,
    f.services,
    f.technologies,
    f.last_enriched_at,
    f.contact_count,
    f.best_contact_fit,
    f.worst_contact_fit,
    f.avg_contact_fit,
    f.max_contact_intent_score,
    f.readiness_score,
    f.readiness_label,
    f.priority_score,
    f.uc_source,
    f.uc_added_at,
    f.user_overrides,
    COUNT(*) OVER ()                    AS total_count
  FROM filtered f
  ORDER BY f.priority_score DESC NULLS LAST,
           f.company_fit_score DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- Lightweight helper: find which 1-based page a specific company falls on.
-- Only touches user_companies + companies + readiness — no contacts scan.
CREATE OR REPLACE FUNCTION get_account_page_for_company(
  p_user_id    uuid,
  p_company_id uuid,
  p_page_size  integer DEFAULT 50
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH target AS (
    SELECT
      snap.priority_score,
      c.company_fit_score
    FROM user_companies uc
    INNER JOIN companies c ON c.id = uc.company_id
    LEFT  JOIN account_readiness_snapshots snap
            ON snap.company_id = c.id AND snap.user_id = p_user_id
    WHERE uc.user_id     = p_user_id
      AND uc.archived_at IS NULL
      AND c.id           = p_company_id
    LIMIT 1
  ),
  ranked AS (
    SELECT COUNT(*) AS rows_before
    FROM user_companies uc
    INNER JOIN companies c ON c.id = uc.company_id
    LEFT  JOIN account_readiness_snapshots snap
            ON snap.company_id = c.id AND snap.user_id = p_user_id
    CROSS JOIN target
    WHERE uc.user_id     = p_user_id
      AND uc.archived_at IS NULL
      AND (
        snap.priority_score > target.priority_score
        OR (
          snap.priority_score IS NOT DISTINCT FROM target.priority_score
          AND c.company_fit_score > COALESCE(target.company_fit_score, -1)
        )
      )
  )
  SELECT GREATEST(1, CEIL((rows_before + 1)::numeric / p_page_size))::integer
  FROM ranked;
$$;
