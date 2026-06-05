-- Phase 3b of the contacts canonical split: security baseline for the new tables
-- (additive; nothing reads them yet). Applied to remote via Supabase MCP 2026-06-04.
--
-- This SUPERSEDES the view definition in 20260604_contacts_split_p3_compat_view.sql
-- by recreating it WITH (security_invoker = true) — without that, a view runs as its
-- owner and BYPASSES RLS on the underlying tables (a cross-tenant leak). With it, the
-- RLS below applies per querying user.

-- user_contacts: same rule as contacts — a user sees only their own rows.
ALTER TABLE public.user_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own_user_contacts ON public.user_contacts
  FOR ALL TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- people: canonical/shared, no user_id. A user may read a person only if they have a
-- user_contacts row linking to it. Enrichment writes go via the service role (bypasses RLS).
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_linked_people ON public.people
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.user_contacts uc
    WHERE uc.person_id = people.id AND uc.user_id = auth.uid()
  ));

DROP VIEW IF EXISTS public.contacts_compat;
CREATE VIEW public.contacts_compat WITH (security_invoker = true) AS
SELECT
  uc.id,
  uc.user_id,
  uc.company_id,
  uc.batch_id,
  uc.raw_upload_id,
  p.linkedin_url,
  COALESCE(uc.user_overrides->>'email', p.email)                               AS email,
  COALESCE(uc.user_overrides->>'full_name', p.full_name)                       AS full_name,
  COALESCE(uc.user_overrides->>'first_name', p.first_name)                     AS first_name,
  COALESCE(uc.user_overrides->>'last_name', p.last_name)                       AS last_name,
  COALESCE(uc.user_overrides->>'job_title', p.job_title)                       AS job_title,
  p.job_title_standardised,
  p.seniority_level,
  p.business_area,
  COALESCE(uc.user_overrides->>'company_name', p.company_name)                 AS company_name,
  COALESCE(uc.user_overrides->>'location', p.location)                         AS location,
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
  COALESCE(uc.user_overrides->>'headline', p.headline)                         AS headline,
  COALESCE(uc.user_overrides->>'city', p.city)                                 AS city,
  COALESCE(uc.user_overrides->>'country', p.country)                           AS country,
  p.years_in_current_role,
  p.profile_photo_url,
  COALESCE(uc.user_overrides->>'company_domain', p.company_domain)             AS company_domain,
  COALESCE(uc.user_overrides->>'company_linkedin_url', p.company_linkedin_url) AS company_linkedin_url,
  p.fiber_person_response_raw, p.fiber_company_response_raw, p.fiber_person_raw, p.fiber_company_raw, p.fiber_lookup_metadata,
  p.apollo_person_response_raw, p.apollo_person_raw, p.apollo_organization_raw, p.apollo_lookup_metadata,
  p.contact_discovery_status, p.email_status, p.email_status_reasoning,
  p.linkedin_resolution_source, p.linkedin_resolution_confidence, p.linkedin_resolution_summary,
  p.linkedin_resolution_status, p.linkedin_resolution_last_error,
  p.linkedin_resolution_started_at, p.linkedin_resolution_completed_at,
  p.profile_enrichment_status, p.profile_enrichment_provider, p.profile_enrichment_last_error,
  p.profile_enrichment_started_at, p.profile_enrichment_completed_at,
  p.apify_profile_raw, p.apify_lookup_metadata, p.profile_enrichment_alignment_metadata,
  p.resolved_current_company_name, p.resolved_current_company_domain, p.resolved_current_job_title,
  p.resolved_employment_history, p.resolved_company_firmographics,
  p.apify_company_raw, p.apollo_company_domain, p.contact_bio,
  p.apollo_company_firmographics, p.apollo_company_firmographics_refreshed_at,
  p.apify_company_firmographics, p.apify_company_firmographics_refreshed_at,
  uc.contact_fit_score, uc.contact_fit_breakdown, uc.contact_fit_coverage,
  uc.contact_fit_scored_at, uc.contact_fit_version,
  p.enrichment_refresh_status, p.enrichment_refresh_last_error,
  p.enrichment_refresh_started_at, p.enrichment_refresh_finished_at,
  uc.overall_fit_score,
  uc.archived_at, uc.archived_by, uc.archived_reason,
  p.job_change_checked_at,
  uc.priority_score,
  uc.contact_panel_summary,
  uc.contact_fit_summary,
  uc.crm_is_suppressed
FROM public.user_contacts uc
JOIN public.people p ON p.id = uc.person_id;
