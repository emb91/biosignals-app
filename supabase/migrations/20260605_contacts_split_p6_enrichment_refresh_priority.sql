-- Restore enrichment_refresh_priority for the contact-enrichment queue.
--
-- The 20260527 migration added this column to the `contacts` TABLE but was never
-- applied to the live DB (verified: absent from contacts_legacy/people/user_contacts,
-- not in schema_migrations). Meanwhile the job-change monitor writes priority=1 and
-- the queue cron orders by it — both 400 against a nonexistent column, so the queue
-- never drains via that path.
--
-- `contacts` is now a view, so the column belongs on canonical `people` (enrichment
-- is shared; a job-change re-enrichment should be prioritised for everyone who links
-- the person — consistent with the other enrichment_refresh_* columns living on people).
-- We add it to people, surface it in the view, and route it through the view's
-- INSTEAD OF UPDATE trigger + the enrichment merge RPC.

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS enrichment_refresh_priority smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS people_enrichment_refresh_priority_idx
  ON public.people (enrichment_refresh_priority, updated_at)
  WHERE enrichment_refresh_status = 'requested';

-- Surface the column on the contacts view (append-only; preserves INSTEAD OF triggers).
CREATE OR REPLACE VIEW public.contacts WITH (security_invoker = true) AS
 SELECT uc.id,
    uc.user_id,
    uc.company_id,
    uc.batch_id,
    uc.raw_upload_id,
    p.linkedin_url,
    COALESCE(uc.user_overrides ->> 'email'::text, p.email) AS email,
    COALESCE(uc.user_overrides ->> 'full_name'::text, p.full_name) AS full_name,
    COALESCE(uc.user_overrides ->> 'first_name'::text, p.first_name) AS first_name,
    COALESCE(uc.user_overrides ->> 'last_name'::text, p.last_name) AS last_name,
    COALESCE(uc.user_overrides ->> 'job_title'::text, p.job_title) AS job_title,
    p.job_title_standardised,
    p.seniority_level,
    p.business_area,
    COALESCE(uc.user_overrides ->> 'company_name'::text, p.company_name) AS company_name,
    COALESCE(uc.user_overrides ->> 'location'::text, p.location) AS location,
    uc.fit_score,
    uc.readiness_score,
    uc.source,
    p.last_enriched_at,
    uc.created_at,
    uc.updated_at,
    uc.fit_score_reasoning,
    uc.fit_score_matched_on,
    uc.fit_score_gaps,
    uc.scored_against_persona_id,
    COALESCE(uc.user_overrides ->> 'headline'::text, p.headline) AS headline,
    COALESCE(uc.user_overrides ->> 'city'::text, p.city) AS city,
    COALESCE(uc.user_overrides ->> 'country'::text, p.country) AS country,
    p.years_in_current_role,
    p.profile_photo_url,
    COALESCE(uc.user_overrides ->> 'company_domain'::text, p.company_domain) AS company_domain,
    COALESCE(uc.user_overrides ->> 'company_linkedin_url'::text, p.company_linkedin_url) AS company_linkedin_url,
    p.fiber_person_response_raw,
    p.fiber_company_response_raw,
    p.fiber_person_raw,
    p.fiber_company_raw,
    p.fiber_lookup_metadata,
    p.apollo_person_response_raw,
    p.apollo_person_raw,
    p.apollo_organization_raw,
    p.apollo_lookup_metadata,
    p.contact_discovery_status,
    p.email_status,
    p.email_status_reasoning,
    p.linkedin_resolution_source,
    p.linkedin_resolution_confidence,
    p.linkedin_resolution_summary,
    p.linkedin_resolution_status,
    p.linkedin_resolution_last_error,
    p.linkedin_resolution_started_at,
    p.linkedin_resolution_completed_at,
    p.profile_enrichment_status,
    p.profile_enrichment_provider,
    p.profile_enrichment_last_error,
    p.profile_enrichment_started_at,
    p.profile_enrichment_completed_at,
    p.apify_profile_raw,
    p.apify_lookup_metadata,
    p.profile_enrichment_alignment_metadata,
    p.resolved_current_company_name,
    p.resolved_current_company_domain,
    p.resolved_current_job_title,
    p.resolved_employment_history,
    p.resolved_company_firmographics,
    p.apify_company_raw,
    p.apollo_company_domain,
    p.contact_bio,
    p.apollo_company_firmographics,
    p.apollo_company_firmographics_refreshed_at,
    p.apify_company_firmographics,
    p.apify_company_firmographics_refreshed_at,
    uc.contact_fit_score,
    uc.contact_fit_breakdown,
    uc.contact_fit_coverage,
    uc.contact_fit_scored_at,
    uc.contact_fit_version,
    p.enrichment_refresh_status,
    p.enrichment_refresh_last_error,
    p.enrichment_refresh_started_at,
    p.enrichment_refresh_finished_at,
    uc.overall_fit_score,
    uc.archived_at,
    uc.archived_by,
    uc.archived_reason,
    p.job_change_checked_at,
    uc.priority_score,
    uc.contact_panel_summary,
    uc.contact_fit_summary,
    uc.crm_is_suppressed,
    p.enrichment_refresh_priority
   FROM user_contacts uc
     JOIN people p ON p.id = uc.person_id;
