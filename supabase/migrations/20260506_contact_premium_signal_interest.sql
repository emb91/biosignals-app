begin;

create table if not exists public.contact_premium_signal_interest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id text not null,
  persona_id uuid references public.personas(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists contact_premium_signal_interest_user_id_idx
  on public.contact_premium_signal_interest(user_id);

create index if not exists contact_premium_signal_interest_signal_id_idx
  on public.contact_premium_signal_interest(signal_id);

alter table public.contact_premium_signal_interest enable row level security;

drop policy if exists "Users manage own contact premium signal interest" on public.contact_premium_signal_interest;
create policy "Users manage own contact premium signal interest"
on public.contact_premium_signal_interest
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
