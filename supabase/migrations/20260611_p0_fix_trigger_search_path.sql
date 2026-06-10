-- Phase 0: Hygiene — fix missing SET search_path on SECURITY DEFINER trigger function.
--
-- update_data_acquisition_job_usage_totals() was created without SET search_path,
-- leaving it open to namespace injection if search_path is overridden. Recreate
-- with the same body but with the safe search_path setting.

CREATE OR REPLACE FUNCTION public.update_data_acquisition_job_usage_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.data_acquisition_jobs
  SET
    actual_credit_units        = COALESCE(actual_credit_units, 0) + COALESCE(NEW.internal_credit_units, 0),
    screened_company_count     = screened_company_count + CASE WHEN NEW.event_type = 'apollo_company_search_result' THEN NEW.quantity ELSE 0 END,
    discovered_company_count   = discovered_company_count + CASE WHEN NEW.event_type = 'apollo_company_search_result' THEN NEW.quantity ELSE 0 END,
    qualified_company_count    = qualified_company_count + CASE WHEN NEW.event_type = 'qualified_company' THEN NEW.quantity ELSE 0 END,
    imported_company_count     = imported_company_count + CASE WHEN NEW.event_type = 'imported_company' THEN NEW.quantity ELSE 0 END,
    discovered_contact_count   = discovered_contact_count + CASE WHEN NEW.event_type = 'apollo_people_search_result' THEN NEW.quantity ELSE 0 END,
    enriched_contact_count     = enriched_contact_count + CASE WHEN NEW.event_type = 'apollo_person_enrichment' THEN NEW.quantity ELSE 0 END,
    imported_contact_count     = imported_contact_count + CASE WHEN NEW.event_type = 'imported_contact' THEN NEW.quantity ELSE 0 END,
    skipped_duplicate_count    = skipped_duplicate_count + CASE WHEN NEW.event_type IN ('duplicate_company_skipped', 'duplicate_contact_skipped') THEN NEW.quantity ELSE 0 END,
    rejected_low_fit_count     = rejected_low_fit_count + CASE WHEN NEW.event_type = 'low_fit_company_rejected' THEN NEW.quantity ELSE 0 END,
    updated_at                 = NOW()
  WHERE id = NEW.job_id;

  RETURN NEW;
END;
$$;
