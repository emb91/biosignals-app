-- HubSpot real-time webhook: idempotency ledger + portal_id for org resolution.
-- An inbound webhook has portalId + objectId but no session; we resolve the org
-- by matching portalId against the connection's stored hubspot_portal_id.
create table if not exists public.hubspot_webhook_events (
  id text primary key,            -- HubSpot eventId (at-least-once delivery)
  subscription_type text,
  received_at timestamptz not null default now()
);
alter table public.hubspot_webhook_events enable row level security;

alter table public.nango_connections
  add column if not exists hubspot_portal_id bigint;
create index if not exists idx_nango_connections_portal
  on public.nango_connections (hubspot_portal_id) where hubspot_portal_id is not null;
