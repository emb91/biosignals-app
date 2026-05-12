begin;

create extension if not exists pgcrypto;

create table if not exists public.llm_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  user_email text null,
  provider text not null,
  feature text not null,
  route text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_creation_input_tokens integer not null default 0 check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer not null default 0 check (cache_read_input_tokens >= 0),
  estimated_cost_usd numeric(12, 6) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists llm_usage_events_created_at_idx
  on public.llm_usage_events (created_at desc);

create index if not exists llm_usage_events_user_id_idx
  on public.llm_usage_events (user_id, created_at desc);

create index if not exists llm_usage_events_feature_idx
  on public.llm_usage_events (feature, created_at desc);

create index if not exists llm_usage_events_route_idx
  on public.llm_usage_events (route, created_at desc);

create index if not exists llm_usage_events_model_idx
  on public.llm_usage_events (model, created_at desc);

alter table public.llm_usage_events enable row level security;

drop policy if exists "Users can access their own llm usage events" on public.llm_usage_events;
create policy "Users can access their own llm usage events"
on public.llm_usage_events
for select
using (auth.uid() = user_id);

commit;
