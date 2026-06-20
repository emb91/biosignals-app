create or replace function public.backup_readiness_report()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
with connections as (
  select distinct
    case
      when org_id is not null then 'org:' || org_id::text
      else 'user:' || user_id::text
    end as scope_key
  from public.nango_connections
  where integration_id = 'hubspot'
),
counts as (
  select
    (select count(*) from connections)::int as connected_workspaces,
    (select count(*) from connections c
      where not exists (
        select 1 from public.hubspot_backups b
         where b.scope_key = c.scope_key
           and b.kind = 'baseline'
           and b.status = 'complete'
      ))::int as missing_baselines,
    (select count(*) from connections c
      where not exists (
        select 1 from public.hubspot_backups b
         where b.scope_key = c.scope_key
           and b.kind = 'rolling'
           and b.status = 'complete'
           and b.completed_at >= now() - interval '36 hours'
      ))::int as stale_rolling_backups,
    (select count(*) from public.hubspot_backups
      where status = 'failed'
        and created_at >= now() - interval '24 hours')::int as failed_24h,
    (select max(completed_at) from public.hubspot_backups where status = 'complete')
      as last_completed_at
)
select jsonb_build_object(
  'ready', missing_baselines = 0 and stale_rolling_backups = 0 and failed_24h = 0,
  'connectedWorkspaces', connected_workspaces,
  'missingBaselines', missing_baselines,
  'staleRollingBackups', stale_rolling_backups,
  'failed24h', failed_24h,
  'lastCompletedAt', last_completed_at
)
from counts;
$$;

revoke all on function public.backup_readiness_report() from public, anon, authenticated;
grant execute on function public.backup_readiness_report() to service_role;
