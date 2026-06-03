-- user_companies.priority_score was a STORED generated column computing
-- fit_score * readiness_score — but fit_score is the dead legacy column (null),
-- so it always produced null, and the (no-floor) formula didn't match the model.
-- Redefine it to company_fit_score × (0.5 + 0.5 × readiness_score): the agreed
-- priority formula, sourced from the canonical fit column, auto-maintained when
-- readiness_score (the cron mirror) changes. accounts_view is recreated because
-- it depends on the column (definition unchanged from the readiness-rename
-- migration; reproduced here because DROP COLUMN requires dropping the view).

DROP VIEW IF EXISTS public.accounts_view;

ALTER TABLE user_companies DROP COLUMN priority_score;
ALTER TABLE user_companies
  ADD COLUMN priority_score double precision
  GENERATED ALWAYS AS (
    CASE
      WHEN company_fit_score IS NOT NULL AND readiness_score IS NOT NULL
      THEN company_fit_score * (0.5 + 0.5 * readiness_score)
      ELSE NULL
    END
  ) STORED;

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
