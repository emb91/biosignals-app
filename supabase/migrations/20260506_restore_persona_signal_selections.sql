-- Recreates persona_signal_selections after it was dropped in production (see remote migration drop_persona_signal_selections).
-- App code hydrates personas from this table; without it PostgREST returned PGRST205 and /api/contacts failed.

create table if not exists public.persona_signal_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  signal_id text not null,
  rank integer not null,
  weight numeric(6,3) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint persona_signal_selections_rank_check check (rank > 0),
  constraint persona_signal_selections_weight_check check (weight >= 0),
  constraint persona_signal_selections_unique_signal unique (persona_id, signal_id),
  constraint persona_signal_selections_unique_rank unique (persona_id, rank)
);

create index if not exists persona_signal_selections_user_id_idx
  on public.persona_signal_selections(user_id);

create index if not exists persona_signal_selections_persona_id_idx
  on public.persona_signal_selections(persona_id);

alter table public.persona_signal_selections enable row level security;

drop policy if exists "Users can only access their own persona signal selections" on public.persona_signal_selections;
create policy "Users can only access their own persona signal selections"
on public.persona_signal_selections
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists persona_signal_selections_updated_at on public.persona_signal_selections;
create trigger persona_signal_selections_updated_at
before update on public.persona_signal_selections
for each row execute function public.set_row_updated_at();
