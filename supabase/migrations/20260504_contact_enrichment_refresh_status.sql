alter table public.contacts
  add column if not exists enrichment_refresh_status text default 'idle',
  add column if not exists enrichment_refresh_last_error text,
  add column if not exists enrichment_refresh_started_at timestamp with time zone,
  add column if not exists enrichment_refresh_finished_at timestamp with time zone;

update public.contacts
set enrichment_refresh_status = 'idle'
where enrichment_refresh_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'contacts_enrichment_refresh_status_check'
      and conrelid = 'public.contacts'::regclass
  ) then
    alter table public.contacts
      add constraint contacts_enrichment_refresh_status_check
      check (enrichment_refresh_status in ('idle', 'running', 'succeeded', 'failed'));
  end if;
end $$;

alter table public.contacts
  alter column enrichment_refresh_status set default 'idle',
  alter column enrichment_refresh_status set not null;
