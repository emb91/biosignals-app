create table if not exists public.hubspot_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamp with time zone not null,
  hub_id text,
  hub_domain text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique (user_id)
);
alter table public.hubspot_connections enable row level security;
create policy "Users manage own HubSpot connection"
  on public.hubspot_connections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
