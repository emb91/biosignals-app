begin;

create or replace function public.launch_readiness_report()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with
owner_anomalies as (
  select count(*)::int as value
  from (
    select o.id
      from public.organizations o
      left join public.org_members m
        on m.org_id = o.id and m.role = 'owner'
     where o.archived_at is null
     group by o.id
    having count(m.user_id) <> 1
  ) x
),
invalid_buckets as (
  select count(*)::int as value
    from public.org_credit_buckets
   where credits_remaining < 0
      or credits_remaining > credits_granted
),
stale_pending_credits as (
  select count(*)::int as value
    from public.org_credit_transactions
   where status = 'pending'
     and created_at < now() - interval '15 minutes'
),
allocation_rollup as (
  select
    t.id,
    t.credits_reserved,
    t.credits_settled,
    coalesce(sum(a.credits_reserved), 0) as allocated_reserved,
    coalesce(sum(a.credits_settled), 0) as allocated_settled
  from public.org_credit_transactions t
  left join public.org_credit_allocations a on a.transaction_id = t.id
  group by t.id
),
allocation_mismatches as (
  select count(*)::int as value
    from allocation_rollup
   where credits_reserved <> allocated_reserved
      or credits_settled <> allocated_settled
),
provider_missing_tx as (
  select count(*)::int as value
    from public.apify_run_usage a
    left join public.org_credit_transactions t
      on t.id = a.customer_credit_transaction_id
   where a.customer_credit_transaction_id is not null
     and t.id is null
),
stripe_stale as (
  select count(*)::int as value
    from public.stripe_webhook_events
   where status = 'processing'
     and processed_at < now() - interval '15 minutes'
),
monitor_contacts as (
  select
    count(*) filter (where status = 'active')::int as active,
    count(*) filter (where status = 'waitlisted')::int as waitlisted,
    count(*) filter (
      where status = 'active'
        and (next_sweep_at is null or next_sweep_at < now() - interval '1 hour')
    )::int as overdue,
    count(*) filter (
      where status = 'active'
        and last_sweep_at is not null
        and last_sweep_at >= now() - make_interval(days => cadence_days)
    )::int as within_cadence
  from public.org_monitored_contacts
),
monitor_accounts as (
  select
    count(*) filter (where status = 'active')::int as active,
    count(*) filter (where status = 'waitlisted')::int as waitlisted,
    count(*) filter (
      where status = 'active'
        and (next_sweep_at is null or next_sweep_at < now() - interval '1 hour')
    )::int as overdue,
    count(*) filter (
      where status = 'active'
        and last_sweep_at is not null
        and last_sweep_at >= now() - make_interval(days => cadence_days)
    )::int as within_cadence
  from public.org_monitored_accounts
),
cron_health as (
  select
    count(*) filter (
      where status = 'running' and started_at < now() - interval '15 minutes'
    )::int as stuck,
    count(*) filter (
      where status = 'failed' and started_at >= now() - interval '24 hours'
    )::int as failed_24h,
    max(started_at) as last_run_at
  from public.cron_run_history
),
thirty_day as (
  select
    coalesce((
      select sum(credits_settled)
        from public.org_credit_transactions
       where created_at >= now() - interval '30 days'
    ), 0) as credits_settled,
    coalesce((
      select sum(actual_cost_usd)
        from public.apify_run_usage
       where created_at >= now() - interval '30 days'
    ), 0) as apify_cost_usd,
    (select count(*) from public.apify_run_usage where created_at >= now() - interval '30 days')::int
      as apify_runs
),
workspace_rows as (
  select jsonb_agg(
    jsonb_build_object(
      'orgId', o.id,
      'name', o.name,
      'plan', coalesce(s.plan_key, 'free'),
      'billingInterval', coalesce(s.billing_interval, 'monthly'),
      'subscriptionStatus', coalesce(s.status, 'free'),
      'creditBalance', coalesce(b.balance, 0),
      'settledCredits30d', coalesce(t.settled_30d, 0),
      'apifyCost30dUsd', coalesce(a.cost_30d, 0),
      'activeMonitoredContacts', coalesce(mc.active, 0),
      'activeMonitoredAccounts', coalesce(ma.active, 0),
      'overdueMonitors', coalesce(mc.overdue, 0) + coalesce(ma.overdue, 0)
    )
    order by o.created_at desc
  ) as value
  from public.organizations o
  left join public.org_subscriptions s on s.org_id = o.id
  left join lateral (
    select sum(credits_remaining) as balance
      from public.org_credit_buckets
     where org_id = o.id and valid_from <= now() and expires_at > now()
  ) b on true
  left join lateral (
    select sum(credits_settled) as settled_30d
      from public.org_credit_transactions
     where org_id = o.id and created_at >= now() - interval '30 days'
  ) t on true
  left join lateral (
    select sum(actual_cost_usd) as cost_30d
      from public.apify_run_usage
     where org_id = o.id and created_at >= now() - interval '30 days'
  ) a on true
  left join lateral (
    select
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (
        where status = 'active'
          and (next_sweep_at is null or next_sweep_at < now() - interval '1 hour')
      )::int as overdue
      from public.org_monitored_contacts where org_id = o.id
  ) mc on true
  left join lateral (
    select
      count(*) filter (where status = 'active')::int as active,
      count(*) filter (
        where status = 'active'
          and (next_sweep_at is null or next_sweep_at < now() - interval '1 hour')
      )::int as overdue
      from public.org_monitored_accounts where org_id = o.id
  ) ma on true
  where o.archived_at is null
)
select jsonb_build_object(
  'generatedAt', now(),
  'ready', (
    (select value from owner_anomalies) = 0
    and (select value from invalid_buckets) = 0
    and (select value from stale_pending_credits) = 0
    and (select value from allocation_mismatches) = 0
    and (select value from provider_missing_tx) = 0
    and (select value from stripe_stale) = 0
    and (select stuck from cron_health) = 0
    and (select failed_24h from cron_health) = 0
    and (select overdue from monitor_contacts) = 0
    and (select overdue from monitor_accounts) = 0
  ),
  'checks', jsonb_build_object(
    'organizationOwnerAnomalies', (select value from owner_anomalies),
    'invalidCreditBuckets', (select value from invalid_buckets),
    'stalePendingCreditTransactions', (select value from stale_pending_credits),
    'creditAllocationMismatches', (select value from allocation_mismatches),
    'providerRowsMissingCreditTransaction', (select value from provider_missing_tx),
    'staleStripeWebhookEvents', (select value from stripe_stale),
    'stuckCronRuns', (select stuck from cron_health),
    'failedCronRuns24h', (select failed_24h from cron_health),
    'overdueContactMonitors', (select overdue from monitor_contacts),
    'overdueAccountMonitors', (select overdue from monitor_accounts)
  ),
  'monitoring', jsonb_build_object(
    'contacts', jsonb_build_object(
      'active', (select active from monitor_contacts),
      'waitlisted', (select waitlisted from monitor_contacts),
      'withinCadence', (select within_cadence from monitor_contacts),
      'overdue', (select overdue from monitor_contacts)
    ),
    'accounts', jsonb_build_object(
      'active', (select active from monitor_accounts),
      'waitlisted', (select waitlisted from monitor_accounts),
      'withinCadence', (select within_cadence from monitor_accounts),
      'overdue', (select overdue from monitor_accounts)
    )
  ),
  'last30Days', jsonb_build_object(
    'creditsSettled', (select credits_settled from thirty_day),
    'apifyCostUsd', (select apify_cost_usd from thirty_day),
    'apifyRuns', (select apify_runs from thirty_day)
  ),
  'cron', jsonb_build_object(
    'lastRunAt', (select last_run_at from cron_health)
  ),
  'workspaces', coalesce((select value from workspace_rows), '[]'::jsonb)
);
$$;

revoke all on function public.launch_readiness_report() from public, anon, authenticated;
grant execute on function public.launch_readiness_report() to service_role;

commit;
