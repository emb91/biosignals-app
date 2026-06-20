begin;

create or replace function public.launch_operational_readiness_report()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with base as (
  select public.launch_readiness_report() as report
),
latest_runs as (
  select distinct on (job_name)
    job_name, status, started_at
  from public.cron_run_history
  order by job_name, started_at desc
),
latest_health as (
  select
    count(*) filter (
      where status = 'running' and started_at < now() - interval '15 minutes'
    )::int as stuck,
    count(*) filter (
      where status = 'failed' and started_at >= now() - interval '24 hours'
    )::int as failed
  from latest_runs
),
patched as (
  select
    jsonb_set(
      jsonb_set(
        report,
        '{checks,stuckCronRuns}',
        to_jsonb((select stuck from latest_health))
      ),
      '{checks,failedCronRuns24h}',
      to_jsonb((select failed from latest_health))
    ) as report
  from base
)
select jsonb_set(
  report,
  '{ready}',
  to_jsonb(
    coalesce((report #>> '{checks,organizationOwnerAnomalies}')::int, 0) = 0
    and coalesce((report #>> '{checks,invalidCreditBuckets}')::int, 0) = 0
    and coalesce((report #>> '{checks,stalePendingCreditTransactions}')::int, 0) = 0
    and coalesce((report #>> '{checks,creditAllocationMismatches}')::int, 0) = 0
    and coalesce((report #>> '{checks,providerRowsMissingCreditTransaction}')::int, 0) = 0
    and coalesce((report #>> '{checks,staleStripeWebhookEvents}')::int, 0) = 0
    and coalesce((report #>> '{checks,stuckCronRuns}')::int, 0) = 0
    and coalesce((report #>> '{checks,failedCronRuns24h}')::int, 0) = 0
    and coalesce((report #>> '{checks,overdueContactMonitors}')::int, 0) = 0
    and coalesce((report #>> '{checks,overdueAccountMonitors}')::int, 0) = 0
  )
)
from patched;
$$;

revoke all on function public.launch_operational_readiness_report()
  from public, anon, authenticated;
grant execute on function public.launch_operational_readiness_report()
  to service_role;

commit;
