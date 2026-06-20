begin;

create table if not exists public.cron_run_history (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  invocation_id text,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  http_status integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  summary jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists cron_run_history_job_started_idx
  on public.cron_run_history (job_name, started_at desc);
create index if not exists cron_run_history_running_idx
  on public.cron_run_history (started_at)
  where status = 'running';

alter table public.cron_run_history enable row level security;
revoke all on table public.cron_run_history from public, anon, authenticated;
grant select, insert, update, delete on table public.cron_run_history to service_role;

commit;
