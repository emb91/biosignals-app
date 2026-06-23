-- The job runner transitions contact-sourcing jobs through a transient
-- 'processing' status (lib/data-acquisition/job-runner.ts: set right after
-- Apollo discovery, before ingest) for all three contact paths. The original
-- status check constraint omitted 'processing', so any job that actually
-- discovered people died with a check_constraint violation before importing.
-- Add 'processing' to the allowed set to match the code's lifecycle:
--   queued -> discovering -> processing -> enriching -> importing -> complete
alter table public.data_acquisition_jobs
  drop constraint if exists data_acquisition_jobs_status_check;

alter table public.data_acquisition_jobs
  add constraint data_acquisition_jobs_status_check
  check (status = any (array[
    'queued'::text,
    'discovering'::text,
    'processing'::text,
    'importing'::text,
    'enriching'::text,
    'complete'::text,
    'failed'::text,
    'cancelled'::text
  ]));
