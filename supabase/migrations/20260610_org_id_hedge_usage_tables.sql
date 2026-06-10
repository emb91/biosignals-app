-- Forward-compatibility hedge for the upcoming org/seats layer.
--
-- Adds a nullable org_id to the usage/metering tables so historical rows can
-- be attributed to an organization once orgs exist. Deliberately NO foreign
-- key and NO application logic yet: the orgs table does not exist, and nothing
-- writes this column today. When the org layer lands, add the FK and backfill.

begin;

alter table public.data_acquisition_jobs
  add column if not exists org_id uuid;

alter table public.data_acquisition_usage_events
  add column if not exists org_id uuid;

alter table public.provider_usage_events
  add column if not exists org_id uuid;

comment on column public.data_acquisition_jobs.org_id is
  'Forward-compatibility for the org/seats layer. Nullable, no FK yet, unused by application code.';
comment on column public.data_acquisition_usage_events.org_id is
  'Forward-compatibility for the org/seats layer. Nullable, no FK yet, unused by application code.';
comment on column public.provider_usage_events.org_id is
  'Forward-compatibility for the org/seats layer. Nullable, no FK yet, unused by application code.';

create index if not exists data_acquisition_jobs_org_idx
  on public.data_acquisition_jobs(org_id)
  where org_id is not null;

create index if not exists data_acquisition_usage_events_org_idx
  on public.data_acquisition_usage_events(org_id)
  where org_id is not null;

create index if not exists provider_usage_events_org_idx
  on public.provider_usage_events(org_id)
  where org_id is not null;

commit;
