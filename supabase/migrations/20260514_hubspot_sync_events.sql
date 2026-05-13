create table if not exists public.hubspot_sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('push', 'pull', 'full')),
  -- push stats
  contacts_synced int,
  contacts_errors int,
  contacts_skipped int,
  skipped_contacts jsonb not null default '[]'::jsonb,
  error_details jsonb not null default '[]'::jsonb,
  companies_updated int,
  -- pull stats
  pull_count int,
  -- deal stats
  deals_fetched int,
  deals_mirrored int,
  deal_events_emitted int
);

alter table public.hubspot_sync_events enable row level security;

create policy "Users see own sync events"
  on public.hubspot_sync_events for select
  using (auth.uid() = user_id);

create index hubspot_sync_events_user_created
  on public.hubspot_sync_events (user_id, created_at desc);
