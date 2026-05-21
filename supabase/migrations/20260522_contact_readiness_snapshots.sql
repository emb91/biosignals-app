-- Contact-level readiness snapshots, parallel to account_readiness_snapshots.
-- Keyed by (user_id, contact_id).  Populated by recomputeContactReadiness
-- whenever contact-scoped signals are written.

create table if not exists public.contact_readiness_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  contact_id              uuid not null references public.contacts(id) on delete cascade,
  overall_score           numeric(5,4) null,
  overall_label           text null,
  new_budget_score        numeric(5,4) null,
  new_budget_label        text null,
  new_budget_confidence   text null,
  new_needs_score         numeric(5,4) null,
  new_needs_label         text null,
  new_needs_confidence    text null,
  new_people_score        numeric(5,4) null,
  new_people_label        text null,
  new_people_confidence   text null,
  new_strategy_score      numeric(5,4) null,
  new_strategy_label      text null,
  new_strategy_confidence text null,
  caution_score           numeric(5,4) null,
  caution_label           text null,
  caution_confidence      text null,
  top_signal_ids          uuid[] null,
  freshness_score         numeric(5,4) null,
  updated_at              timestamptz not null default now(),
  constraint contact_readiness_snapshots_user_contact_unique unique (user_id, contact_id)
);

create index if not exists contact_readiness_snapshots_user_readiness_idx
  on public.contact_readiness_snapshots (user_id, overall_score desc, updated_at desc);

drop trigger if exists contact_readiness_snapshots_updated_at on public.contact_readiness_snapshots;
create trigger contact_readiness_snapshots_updated_at
  before update on public.contact_readiness_snapshots
  for each row execute function public.set_row_updated_at();

-- RLS
alter table public.contact_readiness_snapshots enable row level security;

drop policy if exists "Users can only access their own contact readiness snapshots"
  on public.contact_readiness_snapshots;

create policy "Users can only access their own contact readiness snapshots"
  on public.contact_readiness_snapshots
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
