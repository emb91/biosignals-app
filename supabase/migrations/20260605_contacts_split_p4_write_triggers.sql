-- Phase 4a: INSTEAD OF triggers make contacts_compat a writable surface.
--
-- Routing rules:
--   * INSERT  -> upsert canonical `people` by linkedin_url (fill-if-null on
--               conflict, never clobber another user's canonical data), then
--               insert the per-user `user_contacts` row (id = supplied id or new).
--   * UPDATE  -> per-user cols -> user_contacts;
--               editable cols (name/title/email/company/location...) -> per-user
--               user_overrides jsonb (a view UPDATE of an editable field is a
--               MANUAL edit -- enrichment writes people directly, Phase 4b);
--               canonical cols -> people (safety net; real enrichment is direct).
--   * DELETE  -> delete the user_contacts row; leave `people` (shared).
--
-- All functions are SECURITY DEFINER: they must write `people` (no per-user
-- INSERT/UPDATE RLS) and other users' canonical data. Per-user isolation is
-- still enforced because the trigger only ever touches the user_contacts row
-- the caller already passed RLS to reach.

-- ---------------------------------------------------------------------------
-- INSERT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_compat_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person_id uuid;
  v_uc_id uuid := COALESCE(NEW.id, gen_random_uuid());
BEGIN
  IF NEW.linkedin_url IS NULL OR btrim(NEW.linkedin_url) = '' THEN
    RAISE EXCEPTION 'contacts insert requires a linkedin_url (canonical key)';
  END IF;

  INSERT INTO people AS p (
    linkedin_url,
    -- editable / display
    email, full_name, first_name, last_name, headline, location, city, country,
    job_title, company_name, company_domain, company_linkedin_url,
    -- canonical
    profile_photo_url, job_title_standardised, seniority_level, business_area,
    years_in_current_role, contact_bio, company_id, apollo_company_domain,
    resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title,
    resolved_employment_history, resolved_company_firmographics,
    fiber_person_response_raw, fiber_company_response_raw, fiber_person_raw, fiber_company_raw,
    fiber_lookup_metadata, apollo_person_response_raw, apollo_person_raw, apollo_organization_raw,
    apollo_lookup_metadata, apify_profile_raw, apify_company_raw, apify_lookup_metadata,
    apify_company_firmographics, apify_company_firmographics_refreshed_at,
    apollo_company_firmographics, apollo_company_firmographics_refreshed_at,
    profile_enrichment_alignment_metadata,
    linkedin_resolution_source, linkedin_resolution_confidence, linkedin_resolution_summary,
    linkedin_resolution_status, linkedin_resolution_last_error,
    linkedin_resolution_started_at, linkedin_resolution_completed_at,
    profile_enrichment_status, profile_enrichment_provider, profile_enrichment_last_error,
    profile_enrichment_started_at, profile_enrichment_completed_at,
    contact_discovery_status, email_status, email_status_reasoning,
    last_enriched_at, enrichment_refresh_status, enrichment_refresh_last_error,
    enrichment_refresh_started_at, enrichment_refresh_finished_at, job_change_checked_at
  ) VALUES (
    NEW.linkedin_url,
    NEW.email, NEW.full_name, NEW.first_name, NEW.last_name, NEW.headline, NEW.location, NEW.city, NEW.country,
    NEW.job_title, NEW.company_name, NEW.company_domain, NEW.company_linkedin_url,
    NEW.profile_photo_url, NEW.job_title_standardised, NEW.seniority_level, NEW.business_area,
    NEW.years_in_current_role, NEW.contact_bio, NEW.company_id, NEW.apollo_company_domain,
    NEW.resolved_current_company_name, NEW.resolved_current_company_domain, NEW.resolved_current_job_title,
    NEW.resolved_employment_history, NEW.resolved_company_firmographics,
    NEW.fiber_person_response_raw, NEW.fiber_company_response_raw, NEW.fiber_person_raw, NEW.fiber_company_raw,
    NEW.fiber_lookup_metadata, NEW.apollo_person_response_raw, NEW.apollo_person_raw, NEW.apollo_organization_raw,
    NEW.apollo_lookup_metadata, NEW.apify_profile_raw, NEW.apify_company_raw, NEW.apify_lookup_metadata,
    NEW.apify_company_firmographics, NEW.apify_company_firmographics_refreshed_at,
    NEW.apollo_company_firmographics, NEW.apollo_company_firmographics_refreshed_at,
    NEW.profile_enrichment_alignment_metadata,
    NEW.linkedin_resolution_source, NEW.linkedin_resolution_confidence, NEW.linkedin_resolution_summary,
    NEW.linkedin_resolution_status, NEW.linkedin_resolution_last_error,
    NEW.linkedin_resolution_started_at, NEW.linkedin_resolution_completed_at,
    NEW.profile_enrichment_status, NEW.profile_enrichment_provider, NEW.profile_enrichment_last_error,
    NEW.profile_enrichment_started_at, NEW.profile_enrichment_completed_at,
    NEW.contact_discovery_status, NEW.email_status, NEW.email_status_reasoning,
    NEW.last_enriched_at, NEW.enrichment_refresh_status, NEW.enrichment_refresh_last_error,
    NEW.enrichment_refresh_started_at, NEW.enrichment_refresh_finished_at, NEW.job_change_checked_at
  )
  ON CONFLICT (linkedin_url) DO UPDATE SET
    -- fill-if-null: keep the first writer's canonical values, only backfill gaps
    email = COALESCE(p.email, EXCLUDED.email),
    full_name = COALESCE(p.full_name, EXCLUDED.full_name),
    first_name = COALESCE(p.first_name, EXCLUDED.first_name),
    last_name = COALESCE(p.last_name, EXCLUDED.last_name),
    headline = COALESCE(p.headline, EXCLUDED.headline),
    location = COALESCE(p.location, EXCLUDED.location),
    city = COALESCE(p.city, EXCLUDED.city),
    country = COALESCE(p.country, EXCLUDED.country),
    job_title = COALESCE(p.job_title, EXCLUDED.job_title),
    company_name = COALESCE(p.company_name, EXCLUDED.company_name),
    company_domain = COALESCE(p.company_domain, EXCLUDED.company_domain),
    company_linkedin_url = COALESCE(p.company_linkedin_url, EXCLUDED.company_linkedin_url),
    profile_photo_url = COALESCE(p.profile_photo_url, EXCLUDED.profile_photo_url),
    company_id = COALESCE(p.company_id, EXCLUDED.company_id),
    updated_at = now()
  RETURNING p.id INTO v_person_id;

  INSERT INTO user_contacts (
    id, user_id, person_id, company_id, source, batch_id, raw_upload_id,
    fit_score, readiness_score, fit_score_reasoning, fit_score_matched_on, fit_score_gaps,
    scored_against_persona_id, contact_fit_score, contact_fit_breakdown, contact_fit_coverage,
    contact_fit_scored_at, contact_fit_version, overall_fit_score,
    archived_at, archived_by, archived_reason, priority_score,
    contact_panel_summary, contact_fit_summary, crm_is_suppressed,
    user_overrides
  ) VALUES (
    v_uc_id, NEW.user_id, v_person_id, NEW.company_id, NEW.source, NEW.batch_id, NEW.raw_upload_id,
    NEW.fit_score, NEW.readiness_score, NEW.fit_score_reasoning, NEW.fit_score_matched_on, NEW.fit_score_gaps,
    NEW.scored_against_persona_id, NEW.contact_fit_score, NEW.contact_fit_breakdown, NEW.contact_fit_coverage,
    NEW.contact_fit_scored_at, NEW.contact_fit_version, NEW.overall_fit_score,
    NEW.archived_at, NEW.archived_by, NEW.archived_reason, NEW.priority_score,
    NEW.contact_panel_summary, NEW.contact_fit_summary, NEW.crm_is_suppressed,
    '{}'::jsonb
  );

  NEW.id := v_uc_id;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_compat_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_person_id uuid;
  v_ov jsonb;
BEGIN
  SELECT person_id, user_overrides INTO v_person_id, v_ov
  FROM user_contacts WHERE id = OLD.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contacts update: no user_contacts row for id %', OLD.id;
  END IF;
  v_ov := COALESCE(v_ov, '{}'::jsonb);

  -- (a) editable fields: a view UPDATE here is a MANUAL edit -> per-user override.
  --     Only record fields that actually changed vs the currently-resolved value.
  IF NEW.email          IS DISTINCT FROM OLD.email          THEN v_ov := jsonb_set(v_ov, '{email}', to_jsonb(NEW.email)); END IF;
  IF NEW.full_name      IS DISTINCT FROM OLD.full_name      THEN v_ov := jsonb_set(v_ov, '{full_name}', to_jsonb(NEW.full_name)); END IF;
  IF NEW.first_name     IS DISTINCT FROM OLD.first_name     THEN v_ov := jsonb_set(v_ov, '{first_name}', to_jsonb(NEW.first_name)); END IF;
  IF NEW.last_name      IS DISTINCT FROM OLD.last_name      THEN v_ov := jsonb_set(v_ov, '{last_name}', to_jsonb(NEW.last_name)); END IF;
  IF NEW.headline       IS DISTINCT FROM OLD.headline       THEN v_ov := jsonb_set(v_ov, '{headline}', to_jsonb(NEW.headline)); END IF;
  IF NEW.location       IS DISTINCT FROM OLD.location       THEN v_ov := jsonb_set(v_ov, '{location}', to_jsonb(NEW.location)); END IF;
  IF NEW.city           IS DISTINCT FROM OLD.city           THEN v_ov := jsonb_set(v_ov, '{city}', to_jsonb(NEW.city)); END IF;
  IF NEW.country        IS DISTINCT FROM OLD.country        THEN v_ov := jsonb_set(v_ov, '{country}', to_jsonb(NEW.country)); END IF;
  IF NEW.job_title      IS DISTINCT FROM OLD.job_title      THEN v_ov := jsonb_set(v_ov, '{job_title}', to_jsonb(NEW.job_title)); END IF;
  IF NEW.company_name   IS DISTINCT FROM OLD.company_name   THEN v_ov := jsonb_set(v_ov, '{company_name}', to_jsonb(NEW.company_name)); END IF;
  IF NEW.company_domain IS DISTINCT FROM OLD.company_domain THEN v_ov := jsonb_set(v_ov, '{company_domain}', to_jsonb(NEW.company_domain)); END IF;
  IF NEW.company_linkedin_url IS DISTINCT FROM OLD.company_linkedin_url THEN v_ov := jsonb_set(v_ov, '{company_linkedin_url}', to_jsonb(NEW.company_linkedin_url)); END IF;

  -- (b) per-user columns -> user_contacts (always set; unchanged = no-op)
  UPDATE user_contacts SET
    company_id = NEW.company_id,
    source = NEW.source,
    batch_id = NEW.batch_id,
    raw_upload_id = NEW.raw_upload_id,
    fit_score = NEW.fit_score,
    readiness_score = NEW.readiness_score,
    fit_score_reasoning = NEW.fit_score_reasoning,
    fit_score_matched_on = NEW.fit_score_matched_on,
    fit_score_gaps = NEW.fit_score_gaps,
    scored_against_persona_id = NEW.scored_against_persona_id,
    contact_fit_score = NEW.contact_fit_score,
    contact_fit_breakdown = NEW.contact_fit_breakdown,
    contact_fit_coverage = NEW.contact_fit_coverage,
    contact_fit_scored_at = NEW.contact_fit_scored_at,
    contact_fit_version = NEW.contact_fit_version,
    overall_fit_score = NEW.overall_fit_score,
    archived_at = NEW.archived_at,
    archived_by = NEW.archived_by,
    archived_reason = NEW.archived_reason,
    priority_score = NEW.priority_score,
    contact_panel_summary = NEW.contact_panel_summary,
    contact_fit_summary = NEW.contact_fit_summary,
    crm_is_suppressed = NEW.crm_is_suppressed,
    user_overrides = v_ov,
    updated_at = now()
  WHERE id = OLD.id;

  -- (c) canonical columns -> people (safety net; real enrichment writes direct).
  --     linkedin_url change re-points: handled as a canonical edit on people.
  UPDATE people SET
    linkedin_url = NEW.linkedin_url,
    profile_photo_url = NEW.profile_photo_url,
    job_title_standardised = NEW.job_title_standardised,
    seniority_level = NEW.seniority_level,
    business_area = NEW.business_area,
    years_in_current_role = NEW.years_in_current_role,
    contact_bio = NEW.contact_bio,
    apollo_company_domain = NEW.apollo_company_domain,
    resolved_current_company_name = NEW.resolved_current_company_name,
    resolved_current_company_domain = NEW.resolved_current_company_domain,
    resolved_current_job_title = NEW.resolved_current_job_title,
    resolved_employment_history = NEW.resolved_employment_history,
    resolved_company_firmographics = NEW.resolved_company_firmographics,
    fiber_person_response_raw = NEW.fiber_person_response_raw,
    fiber_company_response_raw = NEW.fiber_company_response_raw,
    fiber_person_raw = NEW.fiber_person_raw,
    fiber_company_raw = NEW.fiber_company_raw,
    fiber_lookup_metadata = NEW.fiber_lookup_metadata,
    apollo_person_response_raw = NEW.apollo_person_response_raw,
    apollo_person_raw = NEW.apollo_person_raw,
    apollo_organization_raw = NEW.apollo_organization_raw,
    apollo_lookup_metadata = NEW.apollo_lookup_metadata,
    apify_profile_raw = NEW.apify_profile_raw,
    apify_company_raw = NEW.apify_company_raw,
    apify_lookup_metadata = NEW.apify_lookup_metadata,
    apify_company_firmographics = NEW.apify_company_firmographics,
    apify_company_firmographics_refreshed_at = NEW.apify_company_firmographics_refreshed_at,
    apollo_company_firmographics = NEW.apollo_company_firmographics,
    apollo_company_firmographics_refreshed_at = NEW.apollo_company_firmographics_refreshed_at,
    profile_enrichment_alignment_metadata = NEW.profile_enrichment_alignment_metadata,
    linkedin_resolution_source = NEW.linkedin_resolution_source,
    linkedin_resolution_confidence = NEW.linkedin_resolution_confidence,
    linkedin_resolution_summary = NEW.linkedin_resolution_summary,
    linkedin_resolution_status = NEW.linkedin_resolution_status,
    linkedin_resolution_last_error = NEW.linkedin_resolution_last_error,
    linkedin_resolution_started_at = NEW.linkedin_resolution_started_at,
    linkedin_resolution_completed_at = NEW.linkedin_resolution_completed_at,
    profile_enrichment_status = NEW.profile_enrichment_status,
    profile_enrichment_provider = NEW.profile_enrichment_provider,
    profile_enrichment_last_error = NEW.profile_enrichment_last_error,
    profile_enrichment_started_at = NEW.profile_enrichment_started_at,
    profile_enrichment_completed_at = NEW.profile_enrichment_completed_at,
    contact_discovery_status = NEW.contact_discovery_status,
    email_status = NEW.email_status,
    email_status_reasoning = NEW.email_status_reasoning,
    last_enriched_at = NEW.last_enriched_at,
    enrichment_refresh_status = NEW.enrichment_refresh_status,
    enrichment_refresh_last_error = NEW.enrichment_refresh_last_error,
    enrichment_refresh_started_at = NEW.enrichment_refresh_started_at,
    enrichment_refresh_finished_at = NEW.enrichment_refresh_finished_at,
    job_change_checked_at = NEW.job_change_checked_at,
    updated_at = now()
  WHERE id = v_person_id;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- DELETE  (per-user unlink; canonical person retained)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_compat_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM user_contacts WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS contacts_compat_insert_trg ON public.contacts_compat;
DROP TRIGGER IF EXISTS contacts_compat_update_trg ON public.contacts_compat;
DROP TRIGGER IF EXISTS contacts_compat_delete_trg ON public.contacts_compat;

CREATE TRIGGER contacts_compat_insert_trg INSTEAD OF INSERT ON public.contacts_compat
  FOR EACH ROW EXECUTE FUNCTION public.contacts_compat_insert();
CREATE TRIGGER contacts_compat_update_trg INSTEAD OF UPDATE ON public.contacts_compat
  FOR EACH ROW EXECUTE FUNCTION public.contacts_compat_update();
CREATE TRIGGER contacts_compat_delete_trg INSTEAD OF DELETE ON public.contacts_compat
  FOR EACH ROW EXECUTE FUNCTION public.contacts_compat_delete();
