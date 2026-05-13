alter table public.hubspot_sync_log
  add column if not exists last_error_details jsonb not null default '[]'::jsonb;
