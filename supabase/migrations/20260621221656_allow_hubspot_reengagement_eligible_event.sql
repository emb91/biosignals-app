-- Allow the HubSpot sync/event log to record the explicit moment a CRM-suppressed
-- account/contact becomes eligible for re-engagement after its cooldown expires.
alter table public.hubspot_sync_events
  drop constraint if exists hubspot_sync_events_event_type_check;

alter table public.hubspot_sync_events
  add constraint hubspot_sync_events_event_type_check
  check (event_type in ('push', 'pull', 'full', 'eligible_for_reengagement'));

comment on constraint hubspot_sync_events_event_type_check on public.hubspot_sync_events
  is 'Allowed HubSpot sync event categories, including explicit CRM re-engagement eligibility events when suppression cooldown expires.';
