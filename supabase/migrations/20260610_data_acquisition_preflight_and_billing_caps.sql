-- Pre-flight screening + billing caps for data acquisition.
--
-- 1. New usage event type 'skipped_existing': companies skipped before any
--    Apollo call because the user already owns the requested coverage
--    (pre-flight gap check). Zero credit weight; tracked so the jobs UI can
--    report "N skipped, already in your workspace".
-- 2. data_acquisition_jobs.skipped_existing_count: trigger-maintained counter
--    for those events (mirrors skipped_duplicate_count).
-- 3. data_acquisition_jobs.completion_note: plain-language partial-fulfillment
--    note set by the job runner when a job stops early (for example a usage
--    cap was reached, or everything requested was already owned). Shown
--    verbatim on job cards; never mentions credit units.
-- 4. user_billing_limits: per-user monthly internal-credit cap enforced at
--    runtime by the job runner. No row (or null limit) falls back to
--    DEFAULT_MONTHLY_CREDIT_LIMIT (500) in application code. Users can read
--    their own row; writes happen via the service role only.

begin;

-- ── 1. Extend the usage event type check constraint ─────────────────────────

alter table public.data_acquisition_usage_events
  drop constraint if exists data_acquisition_usage_events_event_type_check;

alter table public.data_acquisition_usage_events
  add constraint data_acquisition_usage_events_event_type_check check (
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
        'skipped_existing'::text,
        'low_fit_company_rejected'::text
      ]
    )
  );

-- ── 2 + 3. Job columns ───────────────────────────────────────────────────────

alter table public.data_acquisition_jobs
  add column if not exists skipped_existing_count integer not null default 0,
  add column if not exists completion_note text;

comment on column public.data_acquisition_jobs.skipped_existing_count is
  'Companies skipped pre-flight because the requested coverage already exists in the workspace (no Apollo call made).';
comment on column public.data_acquisition_jobs.completion_note is
  'Plain-language note shown to the user when a job completes partially (usage cap reached, or coverage already owned). Never references credit units.';

-- Keep the totals trigger in sync with the new event type / counter.
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
    skipped_existing_count = skipped_existing_count + case when new.event_type = 'skipped_existing' then new.quantity else 0 end,
    rejected_low_fit_count = rejected_low_fit_count + case when new.event_type = 'low_fit_company_rejected' then new.quantity else 0 end,
    updated_at = now()
  where id = new.job_id;

  return new;
end;
$$;

revoke execute on function public.update_data_acquisition_job_usage_totals() from public;
revoke execute on function public.update_data_acquisition_job_usage_totals() from anon;
revoke execute on function public.update_data_acquisition_job_usage_totals() from authenticated;

-- ── 4. Per-user monthly billing cap ─────────────────────────────────────────

create table if not exists public.user_billing_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_credit_limit numeric(12, 2) check (monthly_credit_limit is null or monthly_credit_limit >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.user_billing_limits is
  'Per-user monthly internal-credit cap for data acquisition. Absent row or null limit falls back to DEFAULT_MONTHLY_CREDIT_LIMIT (500) in lib/data-acquisition/job-runner.ts. Internal-only: never surfaced to end users as credit units.';

alter table public.user_billing_limits enable row level security;

-- Users may read their own limit; all writes go through the service role.
drop policy if exists "Users can read their own billing limit" on public.user_billing_limits;
create policy "Users can read their own billing limit"
on public.user_billing_limits
for select
using (auth.uid() = user_id);

commit;
