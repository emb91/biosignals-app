-- Launch security hardening
--
-- Goals:
--   1. Make compatibility views obey the querying user's RLS context.
--   2. Remove anonymous access and unsafe direct RPC access.
--   3. Add an ownership guard before SECURITY DEFINER contact-view triggers.
--   4. Pin search_path on application SQL/PLpgSQL functions.
--   5. Make service-only tables explicitly deny client access.

-- ---------------------------------------------------------------------------
-- Views: restore SECURITY INVOKER and least-privilege grants.
-- ---------------------------------------------------------------------------

ALTER VIEW public.accounts_view SET (security_invoker = true);
ALTER VIEW public.contacts SET (security_invoker = true);

REVOKE ALL ON public.accounts_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.accounts_view TO authenticated, service_role;

REVOKE ALL ON public.contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated, service_role;

-- The existing compatibility write triggers are SECURITY DEFINER because they
-- split a legacy contact-shaped write across people + user_contacts. This
-- invoker trigger runs first and prevents a signed-in caller from supplying or
-- mutating another user's user_id before those privileged triggers run.
CREATE OR REPLACE FUNCTION public.authorize_contacts_compat_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );
BEGIN
  IF v_role IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'contacts user_id must match the authenticated user'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'contact does not belong to the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'contacts user_id cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.authorize_contacts_compat_write()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_contacts_compat_write()
  TO service_role;

DROP TRIGGER IF EXISTS aaa_contacts_compat_authorize_trg ON public.contacts;
CREATE TRIGGER aaa_contacts_compat_authorize_trg
  INSTEAD OF INSERT OR UPDATE OR DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.authorize_contacts_compat_write();

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER functions: deny direct client RPC execution.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.apply_person_enrichment(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_person_enrichment(uuid, uuid, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.contacts_compat_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts_compat_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts_compat_delete()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_compat_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.contacts_compat_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.contacts_compat_delete() TO service_role;

REVOKE ALL ON FUNCTION public.ensure_user_org(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_org(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.import_upsert_contact(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_upsert_contact(uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.increment_org_export_count(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_org_export_count(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.reassign_member_data_to(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_member_data_to(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.set_org_id_from_user()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_outreach_sequence_org_person()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_org_id_from_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_outreach_sequence_org_person() TO service_role;

-- These two helpers intentionally remain SECURITY DEFINER to avoid recursive
-- org_members RLS. They expose only the current auth.uid()'s org and role.
REVOKE ALL ON FUNCTION public.user_org_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_org_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_org_role() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Application RPCs and trigger functions: pin search_path and grants.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.get_account_page_for_company(uuid, uuid, integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_account_page_for_company(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_page_for_company(uuid, uuid, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_user_accounts(uuid, text, boolean, double precision, double precision, integer, integer)
  TO authenticated, service_role;

ALTER FUNCTION public.resolve_company_candidates(text, integer, double precision)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.backfill_candidate_rows(text, text[], text, timestamptz, text, text, text, text, text, text[], double precision, integer)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_contact_priority_scores(uuid)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.resolve_company_candidates(text, integer, double precision)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_candidate_rows(text, text[], text, timestamptz, text, text, text, text, text, text[], double precision, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_contact_priority_scores(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_company_candidates(text, integer, double precision)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_candidate_rows(text, text[], text, timestamptz, text, text, text, text, text, text[], double precision, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_contact_priority_scores(uuid)
  TO service_role;

ALTER FUNCTION public.invalidate_company_resolution_cache()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.capture_contact_priority_change()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.capture_account_priority_change()
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.invalidate_company_resolution_cache()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_contact_priority_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_account_priority_change()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_company_resolution_cache()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_contact_priority_change()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_account_priority_change()
  TO service_role;

-- ---------------------------------------------------------------------------
-- Internal/service-only tables.
--
-- RLS already made these inaccessible to clients, but default table grants
-- remained broad and the lack of an explicit policy produced ambiguous lints.
-- Revoke the grants and add one clear deny policy for client roles.
-- ---------------------------------------------------------------------------

DO $block$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'api_rate_limits',
    'apify_run_usage',
    'apollo_phone_reveal_requests',
    'auth_email_codes',
    'clinical_trials',
    'company_resolution_cache',
    'conferences_sync_runs',
    'ct_delta_sync_runs',
    'fda_delta_sync_runs',
    'fda_device_510k',
    'fda_device_pma',
    'fda_drug_submissions',
    'hubspot_webhook_events',
    'nih_grant_delta_sync_runs',
    'nih_grants_local',
    'org_export_events',
    'patent_delta_sync_runs',
    'patent_event_assignees',
    'patent_events',
    'press_release_articles',
    'press_release_sync_runs',
    'provider_usage_events',
    'sec_backfill_job_logs',
    'sec_backfill_jobs',
    'sec_delta_sync_runs',
    'sec_filings_local',
    'stripe_webhook_events'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table
    );
    EXECUTE format(
      'GRANT ALL ON TABLE public.%I TO service_role',
      v_table
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS client_access_denied ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY client_access_denied ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      v_table
    );
  END LOOP;
END;
$block$;

-- The pre-dedup snapshot is retained temporarily for rollback/audit only.
ALTER TABLE public.companies_pre_dedup_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.companies_pre_dedup_backup
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.companies_pre_dedup_backup TO service_role;
DROP POLICY IF EXISTS client_access_denied
  ON public.companies_pre_dedup_backup;
CREATE POLICY client_access_denied
  ON public.companies_pre_dedup_backup
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
