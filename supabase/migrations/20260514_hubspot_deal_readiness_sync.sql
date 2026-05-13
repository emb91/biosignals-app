begin;

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hubspot_deal_id text not null,
  deal_name text null,
  deal_stage text null,
  pipeline text null,
  amount numeric null,
  close_date timestamptz null,
  created_date timestamptz null,
  hubspot_owner_id text null,
  hs_lastmodifieddate timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_deals_user_hubspot_deal_unique unique (user_id, hubspot_deal_id)
);

create index if not exists crm_deals_user_modified_idx
  on public.crm_deals (user_id, hs_lastmodifieddate desc);

create index if not exists crm_deals_user_deal_stage_idx
  on public.crm_deals (user_id, deal_stage);

drop trigger if exists crm_deals_updated_at on public.crm_deals;
create trigger crm_deals_updated_at
before update on public.crm_deals
for each row execute function public.set_row_updated_at();

create table if not exists public.crm_deal_company_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hubspot_deal_id text not null,
  hubspot_company_id text not null,
  hubspot_company_name text null,
  hubspot_company_domain text null,
  arcova_company_id uuid null references public.companies(id) on delete set null,
  hs_lastmodifieddate timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_deal_company_links_unique unique (user_id, hubspot_deal_id, hubspot_company_id)
);

create index if not exists crm_deal_company_links_user_deal_idx
  on public.crm_deal_company_links (user_id, hubspot_deal_id);

create index if not exists crm_deal_company_links_user_arcova_company_idx
  on public.crm_deal_company_links (user_id, arcova_company_id);

create index if not exists crm_deal_company_links_user_domain_idx
  on public.crm_deal_company_links (user_id, hubspot_company_domain);

drop trigger if exists crm_deal_company_links_updated_at on public.crm_deal_company_links;
create trigger crm_deal_company_links_updated_at
before update on public.crm_deal_company_links
for each row execute function public.set_row_updated_at();

create table if not exists public.crm_deal_contact_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hubspot_deal_id text not null,
  hubspot_contact_id text not null,
  hubspot_contact_email text null,
  hubspot_contact_name text null,
  arcova_contact_id uuid null references public.contacts(id) on delete set null,
  hs_lastmodifieddate timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_deal_contact_links_unique unique (user_id, hubspot_deal_id, hubspot_contact_id)
);

create index if not exists crm_deal_contact_links_user_deal_idx
  on public.crm_deal_contact_links (user_id, hubspot_deal_id);

create index if not exists crm_deal_contact_links_user_arcova_contact_idx
  on public.crm_deal_contact_links (user_id, arcova_contact_id);

create index if not exists crm_deal_contact_links_user_email_idx
  on public.crm_deal_contact_links (user_id, hubspot_contact_email);

drop trigger if exists crm_deal_contact_links_updated_at on public.crm_deal_contact_links;
create trigger crm_deal_contact_links_updated_at
before update on public.crm_deal_contact_links
for each row execute function public.set_row_updated_at();

create table if not exists public.crm_sync_checkpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  object_type text not null,
  last_synced_remote_at timestamptz null,
  last_sync_status text null check (last_sync_status in ('success', 'error')),
  last_sync_error text null,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_sync_checkpoints_user_provider_object_unique unique (user_id, provider, object_type)
);

create index if not exists crm_sync_checkpoints_user_provider_idx
  on public.crm_sync_checkpoints (user_id, provider, object_type);

drop trigger if exists crm_sync_checkpoints_updated_at on public.crm_sync_checkpoints;
create trigger crm_sync_checkpoints_updated_at
before update on public.crm_sync_checkpoints
for each row execute function public.set_row_updated_at();

alter table public.crm_deals enable row level security;
alter table public.crm_deal_company_links enable row level security;
alter table public.crm_deal_contact_links enable row level security;
alter table public.crm_sync_checkpoints enable row level security;

drop policy if exists "Users can only access their own crm deals" on public.crm_deals;
create policy "Users can only access their own crm deals"
on public.crm_deals
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own crm deal company links" on public.crm_deal_company_links;
create policy "Users can only access their own crm deal company links"
on public.crm_deal_company_links
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own crm deal contact links" on public.crm_deal_contact_links;
create policy "Users can only access their own crm deal contact links"
on public.crm_deal_contact_links
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own crm sync checkpoints" on public.crm_sync_checkpoints;
create policy "Users can only access their own crm sync checkpoints"
on public.crm_sync_checkpoints
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

commit;
