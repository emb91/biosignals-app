-- Track when each contact was last checked for a job / role change so the
-- job-change monitor can process the stalest contacts first.

alter table public.contacts
  add column if not exists job_change_checked_at timestamptz null;

create index if not exists contacts_job_change_checked_at_idx
  on public.contacts (job_change_checked_at asc nulls first);
