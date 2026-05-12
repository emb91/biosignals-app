begin;

create or replace function public.update_data_acquisition_job_usage_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.data_acquisition_jobs
  set
    actual_credit_units = coalesce(actual_credit_units, 0) + coalesce(new.internal_credit_units, 0),
    screened_company_count = screened_company_count + case when new.event_type = 'apollo_company_search_result' then new.quantity else 0 end,
    discovered_company_count = discovered_company_count + case when new.event_type = 'apollo_company_search_result' then new.quantity else 0 end,
    qualified_company_count = qualified_company_count + case when new.event_type = 'qualified_company' then new.quantity else 0 end,
    imported_company_count = imported_company_count + case when new.event_type = 'imported_company' then new.quantity else 0 end,
    discovered_contact_count = discovered_contact_count + case when new.event_type = 'apollo_people_search_result' then new.quantity else 0 end,
    enriched_contact_count = enriched_contact_count + case when new.event_type = 'apollo_person_enrichment' then new.quantity else 0 end,
    imported_contact_count = imported_contact_count + case when new.event_type = 'imported_contact' then new.quantity else 0 end,
    skipped_duplicate_count = skipped_duplicate_count + case when new.event_type in ('duplicate_company_skipped', 'duplicate_contact_skipped') then new.quantity else 0 end,
    rejected_low_fit_count = rejected_low_fit_count + case when new.event_type = 'low_fit_company_rejected' then new.quantity else 0 end,
    updated_at = now()
  where id = new.job_id;

  return new;
end;
$$;

revoke execute on function public.update_data_acquisition_job_usage_totals() from public;
revoke execute on function public.update_data_acquisition_job_usage_totals() from anon;
revoke execute on function public.update_data_acquisition_job_usage_totals() from authenticated;

commit;

