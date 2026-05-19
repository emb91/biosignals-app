begin;

alter table public.hubspot_sync_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.contact_attribution_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  is_arcova_sourced boolean not null default false,
  is_arcova_enriched boolean not null default false,
  arcova_touchpoint_count integer not null default 0,
  arcova_touchpoints jsonb not null default '[]'::jsonb,
  first_arcova_touch_at timestamptz null,
  latest_arcova_touch_at timestamptz null,
  latest_arcova_touch_type text null,
  latest_closed_won_deal_id text null,
  latest_closed_won_deal_name text null,
  latest_closed_won_at timestamptz null,
  won_after_arcova_touch boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_attribution_snapshots_user_contact_unique unique (user_id, contact_id)
);

create index if not exists contact_attribution_snapshots_user_contact_idx
  on public.contact_attribution_snapshots (user_id, contact_id);

create index if not exists contact_attribution_snapshots_user_won_idx
  on public.contact_attribution_snapshots (user_id, won_after_arcova_touch, latest_closed_won_at desc);

create index if not exists contact_attribution_snapshots_user_touch_idx
  on public.contact_attribution_snapshots (user_id, latest_arcova_touch_at desc);

drop trigger if exists contact_attribution_snapshots_updated_at on public.contact_attribution_snapshots;
create trigger contact_attribution_snapshots_updated_at
before update on public.contact_attribution_snapshots
for each row execute function public.set_row_updated_at();

alter table public.contact_attribution_snapshots enable row level security;

drop policy if exists "Users can only access their own contact attribution snapshots" on public.contact_attribution_snapshots;
create policy "Users can only access their own contact attribution snapshots"
on public.contact_attribution_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
