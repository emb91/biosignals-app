alter table public.icps
  add column if not exists reenrichment_status text default 'idle',
  add column if not exists reenrichment_last_error text,
  add column if not exists reenrichment_started_at timestamp with time zone,
  add column if not exists reenrichment_finished_at timestamp with time zone;

update public.icps
set reenrichment_status = 'idle'
where reenrichment_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'icps_reenrichment_status_check'
      and conrelid = 'public.icps'::regclass
  ) then
    alter table public.icps
      add constraint icps_reenrichment_status_check
      check (reenrichment_status in ('idle', 'running', 'succeeded', 'failed'));
  end if;
end $$;

alter table public.icps
  alter column reenrichment_status set default 'idle',
  alter column reenrichment_status set not null;
