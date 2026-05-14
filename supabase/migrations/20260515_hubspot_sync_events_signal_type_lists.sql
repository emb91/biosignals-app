alter table public.hubspot_sync_events
  add column if not exists contact_signal_types jsonb not null default '[]'::jsonb,
  add column if not exists contact_context_signal_types jsonb not null default '[]'::jsonb,
  add column if not exists deal_signal_types jsonb not null default '[]'::jsonb;
