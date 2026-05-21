create table if not exists public.sec_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by_user_id uuid,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'halted_rate_limit', 'cancelled')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  start_date date not null,
  end_date date not null,
  next_date date not null,
  last_processed_date date,
  days_processed int not null default 0,
  days_skipped_no_data int not null default 0,
  filings_upserted int not null default 0,
  form_d_upserted int not null default 0,
  form_8k_upserted int not null default 0,
  form_424b_upserted int not null default 0,
  chunks_completed int not null default 0,
  requested_chunk_business_days int not null default 5,
  rate_limit_halted boolean not null default false,
  worker_claimed_at timestamptz,
  last_error text
);

create index if not exists sec_backfill_jobs_requested_idx
  on public.sec_backfill_jobs (requested_at desc);

create index if not exists sec_backfill_jobs_status_idx
  on public.sec_backfill_jobs (status, requested_at asc);

create table if not exists public.sec_backfill_job_logs (
  id bigserial primary key,
  job_id uuid not null references public.sec_backfill_jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  level text not null default 'info',
  message text not null
);

create index if not exists sec_backfill_job_logs_job_id_idx
  on public.sec_backfill_job_logs (job_id, id asc);

alter table public.sec_backfill_jobs enable row level security;
alter table public.sec_backfill_job_logs enable row level security;
