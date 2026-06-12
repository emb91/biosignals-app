-- Add email_deliverability to people (base table).
-- Stores Apollo's raw email_status: 'verified', 'extrapolated', 'unavailable', or null.
-- This is a DELIVERABILITY signal, distinct from the existing email_status column which
-- is a domain-alignment heuristic (aligned_current / stale_suspected / missing).
--
-- Steps:
--   1. Add the column to people (+ contacts_legacy for parity)
--   2. Backfill from apollo_person_raw->>'email_status'
--   3. Recreate the contacts view to include it
--   4. Recreate the compat triggers to pass it through
--   5. Recreate apply_person_enrichment to handle it

-- 1. add column
alter table public.people add column if not exists email_deliverability text default null;
alter table public.contacts_legacy add column if not exists email_deliverability text default null;

-- 2. backfill from Apollo raw data we already have
update people
set email_deliverability = apollo_person_raw->>'email_status'
where apollo_person_raw->>'email_status' is not null
  and email_deliverability is null;

-- 3. recreate the contacts view with the new column
drop view if exists public.data_provider_usage_by_user;
drop view public.contacts;

create view public.contacts as
 select uc.id,
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
    p.apollo_person_response_raw,
    p.apollo_person_raw,
    p.apollo_organization_raw,
    p.apollo_lookup_metadata,
    p.contact_discovery_status,
    p.email_status,
    p.email_status_reasoning,
    p.email_deliverability,
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
    p.enrichment_refresh_priority,
    p.profile_photo_cached
   from user_contacts uc
     join people p on p.id = uc.person_id;

alter view public.contacts owner to postgres;
grant all on public.contacts to anon, authenticated, service_role;

-- recreate the INSTEAD OF triggers
create trigger contacts_compat_insert_trg instead of insert on public.contacts for each row execute function contacts_compat_insert();
create trigger contacts_compat_update_trg instead of update on public.contacts for each row execute function contacts_compat_update();
create trigger contacts_compat_delete_trg instead of delete on public.contacts for each row execute function contacts_compat_delete();

-- 4a. compat insert — add email_deliverability to the people INSERT
create or replace function public.contacts_compat_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_person_id uuid;
  v_uc_id uuid := COALESCE(NEW.id, gen_random_uuid());
BEGIN
  IF NEW.linkedin_url IS NULL OR btrim(NEW.linkedin_url) = '' THEN
    RAISE EXCEPTION 'contacts insert requires a linkedin_url (canonical key)';
  END IF;

  INSERT INTO people AS p (
    linkedin_url,
    email, full_name, first_name, last_name, headline, location, city, country,
    job_title, company_name, company_domain, company_linkedin_url,
    profile_photo_url, job_title_standardised, seniority_level, business_area,
    years_in_current_role, contact_bio, company_id, apollo_company_domain,
    resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title,
    resolved_employment_history, resolved_company_firmographics,
    apollo_person_response_raw, apollo_person_raw, apollo_organization_raw,
    apollo_lookup_metadata, apify_profile_raw, apify_company_raw, apify_lookup_metadata,
    apify_company_firmographics, apify_company_firmographics_refreshed_at,
    apollo_company_firmographics, apollo_company_firmographics_refreshed_at,
    profile_enrichment_alignment_metadata,
    linkedin_resolution_source, linkedin_resolution_confidence, linkedin_resolution_summary,
    linkedin_resolution_status, linkedin_resolution_last_error,
    linkedin_resolution_started_at, linkedin_resolution_completed_at,
    profile_enrichment_status, profile_enrichment_provider, profile_enrichment_last_error,
    profile_enrichment_started_at, profile_enrichment_completed_at,
    contact_discovery_status, email_status, email_status_reasoning, email_deliverability,
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
    NEW.apollo_person_response_raw, NEW.apollo_person_raw, NEW.apollo_organization_raw,
    NEW.apollo_lookup_metadata, NEW.apify_profile_raw, NEW.apify_company_raw, NEW.apify_lookup_metadata,
    NEW.apify_company_firmographics, NEW.apify_company_firmographics_refreshed_at,
    NEW.apollo_company_firmographics, NEW.apollo_company_firmographics_refreshed_at,
    NEW.profile_enrichment_alignment_metadata,
    NEW.linkedin_resolution_source, NEW.linkedin_resolution_confidence, NEW.linkedin_resolution_summary,
    NEW.linkedin_resolution_status, NEW.linkedin_resolution_last_error,
    NEW.linkedin_resolution_started_at, NEW.linkedin_resolution_completed_at,
    NEW.profile_enrichment_status, NEW.profile_enrichment_provider, NEW.profile_enrichment_last_error,
    NEW.profile_enrichment_started_at, NEW.profile_enrichment_completed_at,
    NEW.contact_discovery_status, NEW.email_status, NEW.email_status_reasoning, NEW.email_deliverability,
    NEW.last_enriched_at, NEW.enrichment_refresh_status, NEW.enrichment_refresh_last_error,
    NEW.enrichment_refresh_started_at, NEW.enrichment_refresh_finished_at, NEW.job_change_checked_at
  )
  ON CONFLICT (linkedin_url) DO UPDATE SET
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
$function$;

-- 4b. compat update — add email_deliverability to the people UPDATE
create or replace function public.contacts_compat_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    email_deliverability = NEW.email_deliverability,
    last_enriched_at = NEW.last_enriched_at,
    enrichment_refresh_status = NEW.enrichment_refresh_status,
    enrichment_refresh_last_error = NEW.enrichment_refresh_last_error,
    enrichment_refresh_started_at = NEW.enrichment_refresh_started_at,
    enrichment_refresh_finished_at = NEW.enrichment_refresh_finished_at,
    enrichment_refresh_priority = NEW.enrichment_refresh_priority,
    job_change_checked_at = NEW.job_change_checked_at,
    updated_at = now()
  WHERE id = v_person_id;

  RETURN NEW;
END;
$function$;

-- 4c. apply_person_enrichment — add email_deliverability
create or replace function public.apply_person_enrichment(p_user_id uuid, p_contact_id uuid, p_payload jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_person_id uuid;
  v_existing people;
  v_merged people;
BEGIN
  SELECT person_id INTO v_person_id
  FROM user_contacts WHERE id = p_contact_id AND user_id = p_user_id;
  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'apply_person_enrichment: no user_contacts row % for user %', p_contact_id, p_user_id;
  END IF;

  SELECT p.* INTO v_existing FROM people p WHERE p.id = v_person_id;
  v_merged := jsonb_populate_record(v_existing, p_payload);

  UPDATE people SET
    linkedin_url = v_merged.linkedin_url,
    email = v_merged.email, full_name = v_merged.full_name,
    first_name = v_merged.first_name, last_name = v_merged.last_name,
    headline = v_merged.headline, profile_photo_url = v_merged.profile_photo_url,
    location = v_merged.location, city = v_merged.city, country = v_merged.country,
    job_title = v_merged.job_title, job_title_standardised = v_merged.job_title_standardised,
    seniority_level = v_merged.seniority_level, business_area = v_merged.business_area,
    years_in_current_role = v_merged.years_in_current_role, contact_bio = v_merged.contact_bio,
    company_id = v_merged.company_id, company_name = v_merged.company_name,
    company_domain = v_merged.company_domain, company_linkedin_url = v_merged.company_linkedin_url,
    apollo_company_domain = v_merged.apollo_company_domain,
    resolved_current_company_name = v_merged.resolved_current_company_name,
    resolved_current_company_domain = v_merged.resolved_current_company_domain,
    resolved_current_job_title = v_merged.resolved_current_job_title,
    resolved_employment_history = v_merged.resolved_employment_history,
    resolved_company_firmographics = v_merged.resolved_company_firmographics,
    apollo_person_response_raw = v_merged.apollo_person_response_raw,
    apollo_person_raw = v_merged.apollo_person_raw,
    apollo_organization_raw = v_merged.apollo_organization_raw,
    apollo_lookup_metadata = v_merged.apollo_lookup_metadata,
    apify_profile_raw = v_merged.apify_profile_raw, apify_company_raw = v_merged.apify_company_raw,
    apify_lookup_metadata = v_merged.apify_lookup_metadata,
    apify_company_firmographics = v_merged.apify_company_firmographics,
    apify_company_firmographics_refreshed_at = v_merged.apify_company_firmographics_refreshed_at,
    apollo_company_firmographics = v_merged.apollo_company_firmographics,
    apollo_company_firmographics_refreshed_at = v_merged.apollo_company_firmographics_refreshed_at,
    profile_enrichment_alignment_metadata = v_merged.profile_enrichment_alignment_metadata,
    linkedin_resolution_source = v_merged.linkedin_resolution_source,
    linkedin_resolution_confidence = v_merged.linkedin_resolution_confidence,
    linkedin_resolution_summary = v_merged.linkedin_resolution_summary,
    linkedin_resolution_status = v_merged.linkedin_resolution_status,
    linkedin_resolution_last_error = v_merged.linkedin_resolution_last_error,
    linkedin_resolution_started_at = v_merged.linkedin_resolution_started_at,
    linkedin_resolution_completed_at = v_merged.linkedin_resolution_completed_at,
    profile_enrichment_status = v_merged.profile_enrichment_status,
    profile_enrichment_provider = v_merged.profile_enrichment_provider,
    profile_enrichment_last_error = v_merged.profile_enrichment_last_error,
    profile_enrichment_started_at = v_merged.profile_enrichment_started_at,
    profile_enrichment_completed_at = v_merged.profile_enrichment_completed_at,
    contact_discovery_status = v_merged.contact_discovery_status,
    email_status = v_merged.email_status, email_status_reasoning = v_merged.email_status_reasoning,
    email_deliverability = v_merged.email_deliverability,
    last_enriched_at = v_merged.last_enriched_at,
    enrichment_refresh_status = v_merged.enrichment_refresh_status,
    enrichment_refresh_last_error = v_merged.enrichment_refresh_last_error,
    enrichment_refresh_started_at = v_merged.enrichment_refresh_started_at,
    enrichment_refresh_finished_at = v_merged.enrichment_refresh_finished_at,
    enrichment_refresh_priority = v_merged.enrichment_refresh_priority,
    job_change_checked_at = v_merged.job_change_checked_at,
    updated_at = now()
  WHERE id = v_person_id;
END;
$function$;

-- 4d. import_upsert_contact — add email_deliverability to INSERT + ON CONFLICT
create or replace function public.import_upsert_contact(p_user_id uuid, p_payload jsonb)
 returns TABLE(contact_id uuid, person_already_enriched boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  vp people := jsonb_populate_record(NULL::people, p_payload);
  v_lnk text := p_payload->>'linkedin_url';
  v_person_id uuid;
  v_already boolean;
  v_uc_id uuid;
BEGIN
  IF v_lnk IS NULL OR btrim(v_lnk) = '' THEN
    RETURN;
  END IF;

  INSERT INTO people AS p (
    linkedin_url, email, full_name, first_name, last_name, profile_photo_url,
    job_title, job_title_standardised, seniority_level, business_area, headline,
    years_in_current_role, location, city, country, company_name, company_domain,
    apollo_company_domain, company_linkedin_url, company_id,
    apollo_person_response_raw, apollo_person_raw, apollo_organization_raw,
    apollo_lookup_metadata, contact_discovery_status, email_status, email_status_reasoning,
    email_deliverability,
    linkedin_resolution_status, profile_enrichment_status, last_enriched_at
  ) VALUES (
    v_lnk, vp.email, vp.full_name, vp.first_name, vp.last_name, vp.profile_photo_url,
    vp.job_title, vp.job_title_standardised, vp.seniority_level, vp.business_area, vp.headline,
    vp.years_in_current_role, vp.location, vp.city, vp.country, vp.company_name, vp.company_domain,
    vp.apollo_company_domain, vp.company_linkedin_url, vp.company_id,
    vp.apollo_person_response_raw, vp.apollo_person_raw, vp.apollo_organization_raw,
    vp.apollo_lookup_metadata, vp.contact_discovery_status, vp.email_status, vp.email_status_reasoning,
    vp.email_deliverability,
    vp.linkedin_resolution_status, vp.profile_enrichment_status, vp.last_enriched_at
  )
  ON CONFLICT (linkedin_url) DO UPDATE SET
    email = COALESCE(p.email, EXCLUDED.email),
    full_name = COALESCE(p.full_name, EXCLUDED.full_name),
    first_name = COALESCE(p.first_name, EXCLUDED.first_name),
    last_name = COALESCE(p.last_name, EXCLUDED.last_name),
    profile_photo_url = COALESCE(p.profile_photo_url, EXCLUDED.profile_photo_url),
    job_title = COALESCE(p.job_title, EXCLUDED.job_title),
    job_title_standardised = COALESCE(p.job_title_standardised, EXCLUDED.job_title_standardised),
    seniority_level = COALESCE(p.seniority_level, EXCLUDED.seniority_level),
    business_area = COALESCE(p.business_area, EXCLUDED.business_area),
    headline = COALESCE(p.headline, EXCLUDED.headline),
    years_in_current_role = COALESCE(p.years_in_current_role, EXCLUDED.years_in_current_role),
    location = COALESCE(p.location, EXCLUDED.location),
    city = COALESCE(p.city, EXCLUDED.city),
    country = COALESCE(p.country, EXCLUDED.country),
    company_name = COALESCE(p.company_name, EXCLUDED.company_name),
    company_domain = COALESCE(p.company_domain, EXCLUDED.company_domain),
    apollo_company_domain = COALESCE(p.apollo_company_domain, EXCLUDED.apollo_company_domain),
    company_linkedin_url = COALESCE(p.company_linkedin_url, EXCLUDED.company_linkedin_url),
    company_id = COALESCE(p.company_id, EXCLUDED.company_id),
    apollo_person_response_raw = COALESCE(p.apollo_person_response_raw, EXCLUDED.apollo_person_response_raw),
    apollo_person_raw = COALESCE(p.apollo_person_raw, EXCLUDED.apollo_person_raw),
    apollo_organization_raw = COALESCE(p.apollo_organization_raw, EXCLUDED.apollo_organization_raw),
    apollo_lookup_metadata = COALESCE(p.apollo_lookup_metadata, EXCLUDED.apollo_lookup_metadata),
    contact_discovery_status = COALESCE(p.contact_discovery_status, EXCLUDED.contact_discovery_status),
    email_status = COALESCE(p.email_status, EXCLUDED.email_status),
    email_status_reasoning = COALESCE(p.email_status_reasoning, EXCLUDED.email_status_reasoning),
    email_deliverability = COALESCE(p.email_deliverability, EXCLUDED.email_deliverability),
    linkedin_resolution_status = COALESCE(p.linkedin_resolution_status, EXCLUDED.linkedin_resolution_status),
    profile_enrichment_status = COALESCE(p.profile_enrichment_status, EXCLUDED.profile_enrichment_status),
    last_enriched_at = COALESCE(p.last_enriched_at, EXCLUDED.last_enriched_at),
    updated_at = now()
  RETURNING p.id, (p.profile_enrichment_status = 'completed')
  INTO v_person_id, v_already;

  INSERT INTO user_contacts (
    id, user_id, person_id, company_id, source, batch_id, raw_upload_id,
    fit_score, fit_score_reasoning, fit_score_matched_on, fit_score_gaps, scored_against_persona_id,
    user_overrides
  ) VALUES (
    gen_random_uuid(), p_user_id, v_person_id, (p_payload->>'company_id')::uuid,
    p_payload->>'source', (p_payload->>'batch_id')::uuid, (p_payload->>'raw_upload_id')::uuid,
    (p_payload->>'fit_score')::double precision, p_payload->>'fit_score_reasoning',
    CASE WHEN p_payload ? 'fit_score_matched_on'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'fit_score_matched_on')) END,
    p_payload->>'fit_score_gaps', (p_payload->>'scored_against_persona_id')::uuid,
    '{}'::jsonb
  )
  ON CONFLICT (user_id, person_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    source = EXCLUDED.source,
    batch_id = EXCLUDED.batch_id,
    raw_upload_id = EXCLUDED.raw_upload_id,
    fit_score = EXCLUDED.fit_score,
    fit_score_reasoning = EXCLUDED.fit_score_reasoning,
    fit_score_matched_on = EXCLUDED.fit_score_matched_on,
    fit_score_gaps = EXCLUDED.fit_score_gaps,
    scored_against_persona_id = EXCLUDED.scored_against_persona_id,
    updated_at = now()
  RETURNING id INTO v_uc_id;

  contact_id := v_uc_id;
  person_already_enriched := COALESCE(v_already, false);
  RETURN NEXT;
END;
$function$;

-- 5. recreate the reporting view (unchanged)
create or replace view public.data_provider_usage_by_user
with (security_invoker = true) as
with c as (
  select
    user_id,
    count(*) filter (where apify_profile_raw is not null) as apify_profile_scrapes,
    count(*) filter (where apify_company_raw is not null) as apify_company_scrapes,
    count(*) filter (where apollo_person_raw is not null) as apollo_person_enrichments,
    count(*) filter (where apollo_organization_raw is not null) as apollo_org_enrichments
  from public.contacts
  group by user_id
),
r as (
  select
    user_id,
    count(*) as phone_reveal_requests,
    count(*) filter (where status = 'received') as phone_reveals_received
  from public.apollo_phone_reveal_requests
  group by user_id
)
select
  coalesce(c.user_id, r.user_id) as user_id,
  coalesce(c.apify_profile_scrapes, 0) as apify_profile_scrapes,
  coalesce(c.apify_company_scrapes, 0) as apify_company_scrapes,
  coalesce(c.apollo_person_enrichments, 0) as apollo_person_enrichments,
  coalesce(c.apollo_org_enrichments, 0) as apollo_org_enrichments,
  coalesce(r.phone_reveal_requests, 0) as phone_reveal_requests,
  coalesce(r.phone_reveals_received, 0) as phone_reveals_received
from c
full outer join r on c.user_id = r.user_id;
