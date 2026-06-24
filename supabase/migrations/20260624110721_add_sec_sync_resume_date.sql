-- Checkpoint cursor for resumable SEC delta syncs: when a run stops early
-- (time budget), it records the date it did not finish so the next run resumes
-- from there instead of restarting the whole window.
alter table sec_delta_sync_runs add column if not exists resume_date date;
comment on column sec_delta_sync_runs.resume_date is
  'When status=partial, the filing_date the run stopped before; next run resumes here.';
