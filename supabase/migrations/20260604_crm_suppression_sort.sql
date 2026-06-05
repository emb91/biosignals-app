-- CRM suppression sort key.
--
-- The contacts list (/api/leads, a Supabase query-builder) and the accounts list
-- (list_user_accounts RPC) both paginate in SQL ordered by priority_score. CRM
-- suppression (closed-won/lost → readiness floored, priority drops) is applied at
-- READ time, which only sees the current page — so across page boundaries a
-- closed deal with high intrinsic priority could sort onto page 1 yet display low,
-- burying genuinely active accounts.
--
-- Fix: denormalize a `crm_is_suppressed` boolean onto contacts + user_companies so
-- SQL can sink suppressed rows to the bottom globally. It's maintained by
-- denormalizeCrmSuppressionState() (reusing resolveContactHubSpotStates — no logic
-- drift) on every HubSpot sync + the daily cron; the boolean only lags a cooldown
-- EXPIRY by <24h (sort slot only — the displayed value is always live). The SQL
-- below backfills it once so it's correct immediately.
--
-- Cooldown: closed-won 365d, closed-lost 180d (see CRM suppression policy).

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS crm_is_suppressed boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_companies
  ADD COLUMN IF NOT EXISTS crm_is_suppressed boolean NOT NULL DEFAULT false;

-- Keep the new "suppressed last, then priority" ordering index-backed.
CREATE INDEX IF NOT EXISTS idx_contacts_user_suppressed_priority
  ON public.contacts (user_id, crm_is_suppressed, priority_score DESC NULLS LAST);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Winning deal per contact = most-recently-modified, non-detached deal link.
-- Stage → state: closedwon→customer, closedlost→dormant, else→active.
WITH ranked AS (
  SELECT
    l.arcova_contact_id AS contact_id,
    d.deal_stage,
    d.hs_lastmodifieddate,
    row_number() OVER (
      PARTITION BY l.arcova_contact_id
      ORDER BY d.hs_lastmodifieddate DESC NULLS LAST
    ) AS rn
  FROM public.crm_deal_contact_links l
  JOIN public.crm_deals d
    ON d.hubspot_deal_id = l.hubspot_deal_id
   AND d.user_id = l.user_id
  WHERE l.arcova_contact_id IS NOT NULL
    AND COALESCE(l.raw_payload->>'detached_due_to_job_change', '') <> 'true'
),
winner AS (
  SELECT
    contact_id,
    CASE lower(deal_stage)
      WHEN 'closedwon'  THEN 'customer'
      WHEN 'closedlost' THEN 'dormant'
      ELSE 'active'
    END AS state,
    hs_lastmodifieddate AS closed_at
  FROM ranked
  WHERE rn = 1
)
UPDATE public.contacts c
SET crm_is_suppressed = (
  w.state IN ('customer', 'dormant')
  AND w.closed_at IS NOT NULL
  AND w.closed_at > now() - (
    CASE w.state WHEN 'customer' THEN interval '365 days' ELSE interval '180 days' END
  )
)
FROM winner w
WHERE c.id = w.contact_id;

-- Company-level: highest-priority contact state wins (customer > active >
-- context_only > dormant > none), carrying its close date.
WITH ranked AS (
  SELECT
    l.arcova_contact_id AS contact_id,
    d.deal_stage,
    d.hs_lastmodifieddate,
    row_number() OVER (
      PARTITION BY l.arcova_contact_id
      ORDER BY d.hs_lastmodifieddate DESC NULLS LAST
    ) AS rn
  FROM public.crm_deal_contact_links l
  JOIN public.crm_deals d
    ON d.hubspot_deal_id = l.hubspot_deal_id
   AND d.user_id = l.user_id
  WHERE l.arcova_contact_id IS NOT NULL
    AND COALESCE(l.raw_payload->>'detached_due_to_job_change', '') <> 'true'
),
winner AS (
  SELECT
    contact_id,
    CASE lower(deal_stage)
      WHEN 'closedwon'  THEN 'customer'
      WHEN 'closedlost' THEN 'dormant'
      ELSE 'active'
    END AS state,
    hs_lastmodifieddate AS closed_at
  FROM ranked
  WHERE rn = 1
),
by_company AS (
  SELECT
    ct.user_id, ct.company_id, w.state, w.closed_at,
    CASE w.state
      WHEN 'customer' THEN 5 WHEN 'active' THEN 4 WHEN 'context_only' THEN 3
      WHEN 'dormant' THEN 2 WHEN 'none' THEN 1 ELSE 0
    END AS pr
  FROM winner w
  JOIN public.contacts ct ON ct.id = w.contact_id
  WHERE ct.company_id IS NOT NULL
),
co_winner AS (
  SELECT DISTINCT ON (user_id, company_id)
    user_id, company_id, state, closed_at
  FROM by_company
  ORDER BY user_id, company_id, pr DESC, closed_at DESC NULLS LAST
)
UPDATE public.user_companies uc
SET crm_is_suppressed = (
  cw.state IN ('customer', 'dormant')
  AND cw.closed_at IS NOT NULL
  AND cw.closed_at > now() - (
    CASE cw.state WHEN 'customer' THEN interval '365 days' ELSE interval '180 days' END
  )
)
FROM co_winner cw
WHERE uc.company_id = cw.company_id
  AND uc.user_id = cw.user_id;

-- ── list_user_accounts: sink suppressed accounts to the bottom ───────────────
-- Same body as 20260602_readiness_rename_view_and_rpc.sql, with uc.crm_is_suppressed
-- carried into `base` and added as the FIRST ORDER BY key.
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
  ORDER BY f.crm_is_suppressed ASC,
           f.priority_score DESC NULLS LAST,
           f.company_fit_score DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer) TO anon, authenticated, service_role;
