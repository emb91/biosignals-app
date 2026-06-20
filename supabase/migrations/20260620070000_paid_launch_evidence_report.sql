begin;

create or replace function public.paid_launch_evidence_report()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with evidence as (
  select
    (select count(*) from public.org_credit_transactions
      where status in ('settled', 'partially_refunded', 'refunded')
        and created_at >= now() - interval '7 days')::int as finalized_credit_transactions_7d,
    (select count(*) from public.apify_run_usage
      where created_at >= now() - interval '7 days')::int as provider_runs_7d,
    (select count(*) from public.stripe_webhook_events
      where status = 'processed'
        and processed_at >= now() - interval '30 days')::int as stripe_events_30d,
    (select count(*) from public.org_monitored_contacts
      where status = 'active')::int as active_contacts,
    (select count(*) from public.org_monitored_contacts
      where status = 'active'
        and last_sweep_at is not null
        and last_sweep_at >= now() - make_interval(days => cadence_days))::int
      as contacts_within_cadence,
    (select count(*) from public.org_monitored_accounts
      where status = 'active')::int as active_accounts,
    (select count(*) from public.org_monitored_accounts
      where status = 'active'
        and last_sweep_at is not null
        and last_sweep_at >= now() - make_interval(days => cadence_days))::int
      as accounts_within_cadence,
    (select count(distinct job_name) from public.cron_run_history
      where status = 'succeeded'
        and started_at >= now() - interval '7 days')::int as successful_cron_jobs_7d,
    exists (
      select 1 from public.cron_run_history
       where job_name = 'contact-job-change'
         and status = 'succeeded'
         and started_at >= now() - interval '8 days'
    ) as contact_monitor_job_seen,
    exists (
      select 1 from public.cron_run_history
       where job_name = 'jobs-delta'
         and status = 'succeeded'
         and started_at >= now() - interval '8 days'
    ) as account_monitor_job_seen
)
select jsonb_build_object(
  'ready', (
    finalized_credit_transactions_7d > 0
    and provider_runs_7d > 0
    and stripe_events_30d > 0
    and active_contacts > 0
    and contacts_within_cadence = active_contacts
    and active_accounts > 0
    and accounts_within_cadence = active_accounts
    and successful_cron_jobs_7d >= 5
    and contact_monitor_job_seen
    and account_monitor_job_seen
  ),
  'finalizedCreditTransactions7d', finalized_credit_transactions_7d,
  'providerRuns7d', provider_runs_7d,
  'stripeEvents30d', stripe_events_30d,
  'activeMonitoredContacts', active_contacts,
  'contactsWithinCadence', contacts_within_cadence,
  'activeMonitoredAccounts', active_accounts,
  'accountsWithinCadence', accounts_within_cadence,
  'successfulCronJobs7d', successful_cron_jobs_7d,
  'contactMonitorJobSeen', contact_monitor_job_seen,
  'accountMonitorJobSeen', account_monitor_job_seen
)
from evidence;
$$;

revoke all on function public.paid_launch_evidence_report() from public, anon, authenticated;
grant execute on function public.paid_launch_evidence_report() to service_role;

commit;
