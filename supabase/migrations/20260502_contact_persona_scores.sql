create table if not exists public.contact_persona_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete cascade,
  icp_id uuid references public.icps(id) on delete set null,
  final_score double precision not null default 0,
  raw_score double precision not null default 0,
  coverage double precision,
  breakdown jsonb,
  scored_at timestamp with time zone not null default now(),
  score_version text not null default 'contact_fit_v1',
  unique (contact_id, persona_id)
);

alter table public.contacts
  add column if not exists scored_against_persona_id uuid references public.personas(id) on delete set null,
  add column if not exists contact_fit_breakdown jsonb,
  add column if not exists contact_fit_coverage double precision,
  add column if not exists contact_fit_scored_at timestamp with time zone,
  add column if not exists contact_fit_version text;

alter table public.contact_persona_scores enable row level security;

drop policy if exists "Users can only access their own contact persona scores" on public.contact_persona_scores;
create policy "Users can only access their own contact persona scores"
on public.contact_persona_scores
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists contact_persona_scores_user_id_idx
  on public.contact_persona_scores(user_id);

create index if not exists contact_persona_scores_contact_id_idx
  on public.contact_persona_scores(contact_id);

create index if not exists contact_persona_scores_persona_id_idx
  on public.contact_persona_scores(persona_id);

create index if not exists contact_persona_scores_icp_id_idx
  on public.contact_persona_scores(icp_id);

create index if not exists contact_persona_scores_final_score_desc_idx
  on public.contact_persona_scores(final_score desc);

create index if not exists contacts_scored_against_persona_id_idx
  on public.contacts(scored_against_persona_id);
