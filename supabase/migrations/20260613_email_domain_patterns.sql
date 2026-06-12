-- Email address patterns derived per company domain, per user.
--
-- When a user holds at least one VERIFIED email at a domain (e.g. Jeff Graff =
-- jgraff@gardanthealth.com), we derive the address pattern ({f}{last}) and use it
-- to synthesize candidate emails for contacts at the same domain who have none.
-- Synthesized addresses are stamped email_deliverability = 'pattern_guessed'
-- (provider 'pattern') so the UI shows a "guessed, not verified" warning and
-- outreach dispatch can hold them until verified.
--
-- TENANCY DECISION: patterns are derived ONLY from the requesting user's own
-- contacts (user_id-scoped), never from other tenants' verified emails in the
-- shared people table. One tenant's address book must not shape another's
-- guesses, even as metadata. Hence user_id in the key.

create table if not exists public.email_domain_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  -- Template tokens: {first} {last} {f} {l}, e.g. '{f}{last}' for jgraff
  pattern text not null,
  -- How many verified samples voted for this pattern / were examined.
  sample_count integer not null default 0,
  total_samples integer not null default 0,
  derived_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, domain)
);

alter table public.email_domain_patterns enable row level security;

drop policy if exists "email_domain_patterns_select_own" on public.email_domain_patterns;
create policy "email_domain_patterns_select_own"
  on public.email_domain_patterns for select
  using (auth.uid() = user_id);

drop policy if exists "email_domain_patterns_insert_own" on public.email_domain_patterns;
create policy "email_domain_patterns_insert_own"
  on public.email_domain_patterns for insert
  with check (auth.uid() = user_id);

drop policy if exists "email_domain_patterns_update_own" on public.email_domain_patterns;
create policy "email_domain_patterns_update_own"
  on public.email_domain_patterns for update
  using (auth.uid() = user_id);

drop policy if exists "email_domain_patterns_delete_own" on public.email_domain_patterns;
create policy "email_domain_patterns_delete_own"
  on public.email_domain_patterns for delete
  using (auth.uid() = user_id);

create index if not exists email_domain_patterns_user_domain_idx
  on public.email_domain_patterns (user_id, domain);
