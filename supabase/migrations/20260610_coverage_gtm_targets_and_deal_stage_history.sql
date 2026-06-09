-- Coverage planner — Phase 0 schema.
-- Applied to the linked project via Supabase MCP; tracked here for reproducibility.

-- Per-user quarterly GTM targets (one row per period). Target is OVERALL (not
-- per-ICP — allocation across ICPs is computed). Keyed by user_id (forward-
-- compatible with per-seat targets when the org/seats layer lands).
create table if not exists public.gtm_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,                         -- e.g. '2026-Q3'
  target_type text not null default 'revenue'   -- 'revenue' | 'deals'
    check (target_type in ('revenue', 'deals')),
  target_value numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period)
);

alter table public.gtm_targets enable row level security;

drop policy if exists "gtm_targets_select_own" on public.gtm_targets;
create policy "gtm_targets_select_own" on public.gtm_targets
  for select using (auth.uid() = user_id);
drop policy if exists "gtm_targets_insert_own" on public.gtm_targets;
create policy "gtm_targets_insert_own" on public.gtm_targets
  for insert with check (auth.uid() = user_id);
drop policy if exists "gtm_targets_update_own" on public.gtm_targets;
create policy "gtm_targets_update_own" on public.gtm_targets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "gtm_targets_delete_own" on public.gtm_targets;
create policy "gtm_targets_delete_own" on public.gtm_targets
  for delete using (auth.uid() = user_id);

-- Deal stage transition history — per-stage entered/exited timestamps captured
-- from the HubSpot sync. Powers real funnel conversion + sales-cycle length per
-- ICP (and the "Arcova shortened your cycle" value metric).
create table if not exists public.crm_deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hubspot_deal_id text not null,
  stage text not null,
  entered_at timestamptz not null,
  exited_at timestamptz,                         -- null = current stage
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, hubspot_deal_id, stage, entered_at)
);

create index if not exists crm_deal_stage_history_user_deal_idx
  on public.crm_deal_stage_history (user_id, hubspot_deal_id);

alter table public.crm_deal_stage_history enable row level security;

drop policy if exists "crm_deal_stage_history_select_own" on public.crm_deal_stage_history;
create policy "crm_deal_stage_history_select_own" on public.crm_deal_stage_history
  for select using (auth.uid() = user_id);
drop policy if exists "crm_deal_stage_history_insert_own" on public.crm_deal_stage_history;
create policy "crm_deal_stage_history_insert_own" on public.crm_deal_stage_history
  for insert with check (auth.uid() = user_id);
drop policy if exists "crm_deal_stage_history_update_own" on public.crm_deal_stage_history;
create policy "crm_deal_stage_history_update_own" on public.crm_deal_stage_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
