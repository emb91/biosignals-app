alter table public.data_acquisition_jobs
drop constraint if exists data_acquisition_jobs_request_type_check;

alter table public.data_acquisition_jobs
add constraint data_acquisition_jobs_request_type_check
check (
  request_type = any (
    array[
      'expand_companies'::text,
      'better_contacts'::text,
      'more_contacts_at_accounts'::text,
      'contacts_at_company'::text
    ]
  )
);
