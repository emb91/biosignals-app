create table if not exists public.nango_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  integration_id text not null,
  nango_connection_id text not null,
  created_at timestamp with time zone default now(),
  unique (user_id, integration_id)
);

alter table public.nango_connections enable row level security;

create policy "Users manage own Nango connections"
  on public.nango_connections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
