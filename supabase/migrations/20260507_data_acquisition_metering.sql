create table if not exists public.data_acquisition_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  icp_id uuid references public.icps(id) on delete cascade not null,
  upload_batch_id uuid references public.upload_batches(id) on delete set null,
  request_type text not null check (
    request_type = any (
      array[
        'expand_companies'::text,
        'better_contacts'::text,
        'more_contacts_at_accounts'::text
      ]
    )
  ),
  source_strategy text not null default 'apollo_first',
  status text not null default 'queued' check (
    status = any (
      array[
        'queued'::text,
        'discovering'::text,
        'importing'::text,
        'enriching'::text,
        'complete'::text,
        'failed'::text,
        'cancelled'::text
      ]
    )
  ),
  target_company_count integer not null default 50 check (target_company_count >= 0),
  target_contact_count integer check (target_contact_count is null or target_contact_count >= 0),
  max_screened_companies integer check (max_screened_companies is null or max_screened_companies >= 0),
  max_contact_enrichments integer check (max_contact_enrichments is null or max_contact_enrichments >= 0),
  max_credit_units numeric(12, 2) check (max_credit_units is null or max_credit_units >= 0),
  estimated_min_credit_units numeric(12, 2) not null default 0,
  estimated_max_credit_units numeric(12, 2) not null default 0,
  actual_credit_units numeric(12, 2) not null default 0,
  screened_company_count integer not null default 0,
  discovered_company_count integer not null default 0,
  qualified_company_count integer not null default 0,
  imported_company_count integer not null default 0,
  discovered_contact_count integer not null default 0,
  enriched_contact_count integer not null default 0,
  imported_contact_count integer not null default 0,
  skipped_duplicate_count integer not null default 0,
  rejected_low_fit_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  requested_at timestamp with time zone not null default now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.data_acquisition_usage_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.data_acquisition_jobs(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  event_type text not null check (
    event_type = any (
      array[
        'job_requested'::text,
        'apollo_company_search_result'::text,
        'apollo_company_enrichment'::text,
        'apollo_people_search_result'::text,
        'apollo_person_enrichment'::text,
        'apify_profile_scrape'::text,
        'apify_company_scrape'::text,
        'llm_fit_screen'::text,
        'qualified_company'::text,
        'imported_company'::text,
        'imported_contact'::text,
        'duplicate_company_skipped'::text,
        'duplicate_contact_skipped'::text,
        'low_fit_company_rejected'::text
      ]
    )
  ),
  provider text,
  quantity integer not null default 1 check (quantity >= 0),
  provider_cost_units numeric(12, 4) not null default 0 check (provider_cost_units >= 0),
  internal_credit_units numeric(12, 2) not null default 0 check (internal_credit_units >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

alter table public.data_acquisition_jobs enable row level security;
alter table public.data_acquisition_usage_events enable row level security;

drop policy if exists "Users can only access their own data" on public.data_acquisition_jobs;
create policy "Users can only access their own data"
on public.data_acquisition_jobs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own data" on public.data_acquisition_usage_events;
create policy "Users can only access their own data"
on public.data_acquisition_usage_events
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists data_acquisition_jobs_user_status_idx
on public.data_acquisition_jobs(user_id, status, requested_at desc);

create index if not exists data_acquisition_jobs_user_icp_idx
on public.data_acquisition_jobs(user_id, icp_id, requested_at desc);

create index if not exists data_acquisition_jobs_upload_batch_idx
on public.data_acquisition_jobs(upload_batch_id);

create index if not exists data_acquisition_usage_events_job_idx
on public.data_acquisition_usage_events(job_id, created_at);

create index if not exists data_acquisition_usage_events_user_type_idx
on public.data_acquisition_usage_events(user_id, event_type, created_at desc);

create or replace function public.update_data_acquisition_job_usage_totals()
returns trigger
language plpgsql
security definer
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

drop trigger if exists data_acquisition_usage_totals_after_insert
on public.data_acquisition_usage_events;

create trigger data_acquisition_usage_totals_after_insert
after insert on public.data_acquisition_usage_events
for each row
execute function public.update_data_acquisition_job_usage_totals();
