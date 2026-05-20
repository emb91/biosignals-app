-- Per-contact phone directory. Mirrors contact_emails: multiple entries per
-- (user, contact) so import / user-added / enriched phone numbers stack
-- instead of overwriting on re-enrichment.

create table if not exists contact_phones (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  user_id uuid not null,
  phone text not null,
  category text not null check (category in ('import', 'user', 'enriched_work', 'enriched_mobile', 'enriched_personal', 'enriched_other')),
  label text,
  source_provider text,
  phone_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, contact_id, phone)
);

create index if not exists contact_phones_contact_user_idx on contact_phones (contact_id, user_id);
create index if not exists contact_phones_user_idx on contact_phones (user_id);

alter table contact_phones enable row level security;

create policy "contact_phones_select_own" on contact_phones
  for select using (auth.uid() = user_id);
create policy "contact_phones_insert_own" on contact_phones
  for insert with check (auth.uid() = user_id);
create policy "contact_phones_update_own" on contact_phones
  for update using (auth.uid() = user_id);
create policy "contact_phones_delete_own" on contact_phones
  for delete using (auth.uid() = user_id);
