alter table public.contacts
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_reason text;

alter table public.companies
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_reason text;

create index if not exists contacts_user_archived_idx
  on public.contacts (user_id, archived_at);

create index if not exists companies_user_archived_idx
  on public.companies (user_id, archived_at);
