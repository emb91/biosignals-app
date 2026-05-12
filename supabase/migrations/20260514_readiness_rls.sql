begin;

alter table public.signal_source_events enable row level security;
alter table public.normalized_signals enable row level security;
alter table public.account_readiness_snapshots enable row level security;
alter table public.account_reason_snapshots enable row level security;
alter table public.readiness_snapshot_evidence enable row level security;

drop policy if exists "Users can only access their own signal source events" on public.signal_source_events;
create policy "Users can only access their own signal source events"
on public.signal_source_events
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own normalized signals" on public.normalized_signals;
create policy "Users can only access their own normalized signals"
on public.normalized_signals
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own account readiness snapshots" on public.account_readiness_snapshots;
create policy "Users can only access their own account readiness snapshots"
on public.account_readiness_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own account reason snapshots" on public.account_reason_snapshots;
create policy "Users can only access their own account reason snapshots"
on public.account_reason_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access readiness evidence through owned snapshots" on public.readiness_snapshot_evidence;
create policy "Users can only access readiness evidence through owned snapshots"
on public.readiness_snapshot_evidence
for all
using (
  exists (
    select 1
    from public.account_readiness_snapshots ars
    where ars.id = readiness_snapshot_id
      and ars.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.account_readiness_snapshots ars
    where ars.id = readiness_snapshot_id
      and ars.user_id = auth.uid()
  )
);

commit;
