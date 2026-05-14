alter table public.hubspot_sync_events
  add column if not exists crm_contacts_fetched int,
  add column if not exists crm_contacts_mirrored int,
  add column if not exists contact_events_emitted int,
  add column if not exists contact_context_only_events int,
  add column if not exists crm_recomputed_companies int,
  add column if not exists crm_unresolved_count int;
