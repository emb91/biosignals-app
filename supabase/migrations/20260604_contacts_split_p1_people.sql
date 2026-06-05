-- Phase 1 of the contacts canonical split (see docs/plans/contacts-canonical-split.md).
-- Canonical shared person record: holds the PAID enrichment, keyed on linkedin_url,
-- deduped across users (most-enriched row wins). `contacts` is left untouched —
-- pure expand, zero breakage. Applied to remote via Supabase MCP 2026-06-04.
CREATE TABLE public.people AS
WITH ranked AS (
  SELECT *,
    row_number() OVER (
      PARTITION BY linkedin_url
      ORDER BY
        (profile_enrichment_status IN ('completed','ambiguous')) DESC,
        (linkedin_resolution_status = 'completed') DESC,
        last_enriched_at DESC NULLS LAST,
        updated_at DESC NULLS LAST
    ) AS rn
  FROM public.contacts
  WHERE linkedin_url IS NOT NULL AND linkedin_url <> ''
)
SELECT
  gen_random_uuid() AS id,
  linkedin_url,
  email, full_name, first_name, last_name, headline, profile_photo_url, location, city, country,
  job_title, job_title_standardised, seniority_level, business_area, years_in_current_role, contact_bio,
  company_id, company_name, company_domain, company_linkedin_url, apollo_company_domain,
  resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title,
  resolved_employment_history, resolved_company_firmographics,
  fiber_person_response_raw, fiber_company_response_raw, fiber_person_raw, fiber_company_raw, fiber_lookup_metadata,
  apollo_person_response_raw, apollo_person_raw, apollo_organization_raw, apollo_lookup_metadata,
  apify_profile_raw, apify_company_raw, apify_lookup_metadata,
  apify_company_firmographics, apify_company_firmographics_refreshed_at,
  apollo_company_firmographics, apollo_company_firmographics_refreshed_at,
  profile_enrichment_alignment_metadata,
  linkedin_resolution_source, linkedin_resolution_confidence, linkedin_resolution_summary,
  linkedin_resolution_status, linkedin_resolution_last_error,
  linkedin_resolution_started_at, linkedin_resolution_completed_at,
  profile_enrichment_status, profile_enrichment_provider, profile_enrichment_last_error,
  profile_enrichment_started_at, profile_enrichment_completed_at,
  contact_discovery_status, email_status, email_status_reasoning, last_enriched_at,
  enrichment_refresh_status, enrichment_refresh_last_error,
  enrichment_refresh_started_at, enrichment_refresh_finished_at,
  job_change_checked_at,
  created_at,
  now() AS updated_at
FROM ranked
WHERE rn = 1;

ALTER TABLE public.people
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN linkedin_url SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.people ADD CONSTRAINT people_pkey PRIMARY KEY (id);
ALTER TABLE public.people ADD CONSTRAINT people_linkedin_url_key UNIQUE (linkedin_url);
ALTER TABLE public.people
  ADD CONSTRAINT people_company_id_fkey FOREIGN KEY (company_id)
  REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX idx_people_company_id ON public.people (company_id);
