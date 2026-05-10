-- Structured email slots per lead: import baseline, user-added, enriched work/personal.

create table if not exists public.contact_emails (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  category text not null,
  label text,
  source_provider text,
  apollo_email_status text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint contact_emails_category_check check (
    category in ('import', 'user', 'enriched_work', 'enriched_personal')
  )
);

create unique index if not exists contact_emails_contact_email_lower_idx
  on public.contact_emails (contact_id, lower(trim(email)));

create index if not exists contact_emails_contact_id_idx on public.contact_emails (contact_id);
create index if not exists contact_emails_user_id_idx on public.contact_emails (user_id);

-- One import snapshot per row created at ingest time; enrich/user rows added later.

comment on table public.contact_emails is 'Email addresses keyed to a contact import vs user vs enrichment.';

comment on column public.contact_emails.category is 'import: CSV/HubSpot line; user: typed in Arcova UI; enriched_*: surfaced from enrichment (Apollo, etc.).';

insert into public.contact_emails (contact_id, user_id, email, category)
select c.id,
  c.user_id,
  trim(c.email),
  'import'::text
from public.contacts c
where c.email is not null
  and trim(c.email) <> ''
  and not exists (
    select 1
    from public.contact_emails ce
    where ce.contact_id = c.id
      and lower(trim(ce.email)) = lower(trim(c.email))
  );
