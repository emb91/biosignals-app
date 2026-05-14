begin;

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hubspot_contact_id text not null,
  full_name text null,
  email text null,
  job_title text null,
  hubspot_owner_id text null,
  arcova_contact_id uuid null references public.contacts(id) on delete set null,
  arcova_company_id uuid null references public.companies(id) on delete set null,
  arcova_company_name text null,
  arcova_company_domain text null,
  hs_lastmodifieddate timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_contacts_user_hubspot_contact_unique unique (user_id, hubspot_contact_id)
);

create index if not exists crm_contacts_user_modified_idx
  on public.crm_contacts (user_id, hs_lastmodifieddate desc);

create index if not exists crm_contacts_user_email_idx
  on public.crm_contacts (user_id, email);

create index if not exists crm_contacts_user_arcova_contact_idx
  on public.crm_contacts (user_id, arcova_contact_id);

drop trigger if exists crm_contacts_updated_at on public.crm_contacts;
create trigger crm_contacts_updated_at
before update on public.crm_contacts
for each row execute function public.set_row_updated_at();

create table if not exists public.crm_contact_company_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hubspot_contact_id text not null,
  hubspot_company_id text not null,
  hubspot_company_name text null,
  hubspot_company_domain text null,
  arcova_company_id uuid null references public.companies(id) on delete set null,
  hs_lastmodifieddate timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_contact_company_links_unique unique (user_id, hubspot_contact_id, hubspot_company_id)
);

create index if not exists crm_contact_company_links_user_contact_idx
  on public.crm_contact_company_links (user_id, hubspot_contact_id);

create index if not exists crm_contact_company_links_user_arcova_company_idx
  on public.crm_contact_company_links (user_id, arcova_company_id);

create index if not exists crm_contact_company_links_user_domain_idx
  on public.crm_contact_company_links (user_id, hubspot_company_domain);

drop trigger if exists crm_contact_company_links_updated_at on public.crm_contact_company_links;
create trigger crm_contact_company_links_updated_at
before update on public.crm_contact_company_links
for each row execute function public.set_row_updated_at();

alter table public.crm_contacts enable row level security;
alter table public.crm_contact_company_links enable row level security;

drop policy if exists "Users can only access their own crm contacts" on public.crm_contacts;
create policy "Users can only access their own crm contacts"
on public.crm_contacts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own crm contact company links" on public.crm_contact_company_links;
create policy "Users can only access their own crm contact company links"
on public.crm_contact_company_links
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
