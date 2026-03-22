-- Arcova schema migration
-- Creates/updates import, contacts, companies, signals, and tracking tables.
-- This migration is non-destructive and avoids dropping existing data.

create extension if not exists pgcrypto;

-- companies table
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  company_name text not null,
  company_name_legal text,
  company_website text,
  linkedin_url text,
  therapeutic_area text[],
  modality text[],
  funding_stage text,
  funding_amount numeric,
  headcount_range text,
  development_stage text,
  company_type text,
  description text,
  company_fit_score float,
  company_intent_score float,
  company_priority_score float generated always as (
    case
      when company_fit_score is not null and company_intent_score is not null
      then company_fit_score * company_intent_score
      else null
    end
  ) stored,
  source text not null default 'arcova',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.companies add column if not exists company_name text;
alter table public.companies add column if not exists company_name_legal text;
alter table public.companies add column if not exists company_website text;
alter table public.companies add column if not exists linkedin_url text;
alter table public.companies add column if not exists therapeutic_area text[];
alter table public.companies add column if not exists modality text[];
alter table public.companies add column if not exists funding_stage text;
alter table public.companies add column if not exists funding_amount numeric;
alter table public.companies add column if not exists headcount_range text;
alter table public.companies add column if not exists development_stage text;
alter table public.companies add column if not exists company_type text;
alter table public.companies add column if not exists description text;
alter table public.companies add column if not exists company_fit_score float;
alter table public.companies add column if not exists company_intent_score float;
alter table public.companies add column if not exists source text;
alter table public.companies add column if not exists created_at timestamp with time zone default now();
alter table public.companies add column if not exists updated_at timestamp with time zone default now();
alter table public.companies add column if not exists company_priority_score float generated always as (
  case
    when company_fit_score is not null and company_intent_score is not null
    then company_fit_score * company_intent_score
    else null
  end
) stored;

update public.companies set source = coalesce(source, 'arcova');
update public.companies set company_name = coalesce(nullif(company_name, ''), 'Unknown Company');

alter table public.companies alter column source set default 'arcova';
alter table public.companies alter column company_name set not null;
alter table public.companies alter column source set not null;

-- contacts table
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  contact_fullname text not null,
  first_name text,
  last_name text,
  company_id uuid references public.companies(id) on delete set null,
  company_name text not null,
  job_title text,
  job_title_standardised text,
  email text,
  linkedin_url text,
  seniority_level text,
  business_area text,
  contact_fit_score float,
  contact_intent_score float,
  contact_priority_score float generated always as (
    case
      when contact_fit_score is not null and contact_intent_score is not null
      then contact_fit_score * contact_intent_score
      else null
    end
  ) stored,
  source text not null default 'imported',
  upload_batch_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.contacts add column if not exists contact_fullname text;
alter table public.contacts add column if not exists first_name text;
alter table public.contacts add column if not exists last_name text;
alter table public.contacts add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.contacts add column if not exists company_name text;
alter table public.contacts add column if not exists job_title text;
alter table public.contacts add column if not exists job_title_standardised text;
alter table public.contacts add column if not exists email text;
alter table public.contacts add column if not exists linkedin_url text;
alter table public.contacts add column if not exists seniority_level text;
alter table public.contacts add column if not exists business_area text;
alter table public.contacts add column if not exists contact_fit_score float;
alter table public.contacts add column if not exists contact_intent_score float;
alter table public.contacts add column if not exists source text;
alter table public.contacts add column if not exists upload_batch_id uuid;
alter table public.contacts add column if not exists created_at timestamp with time zone default now();
alter table public.contacts add column if not exists updated_at timestamp with time zone default now();
alter table public.contacts add column if not exists contact_priority_score float generated always as (
  case
    when contact_fit_score is not null and contact_intent_score is not null
    then contact_fit_score * contact_intent_score
    else null
  end
) stored;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'contacts' and column_name = 'name'
  ) then
    execute $sql$
      update public.contacts
      set contact_fullname = coalesce(nullif(contact_fullname, ''), nullif(name, ''))
      where coalesce(contact_fullname, '') = ''
    $sql$;
  end if;
end $$;

update public.contacts
set contact_fullname = coalesce(nullif(contact_fullname, ''), 'Unknown Contact')
where coalesce(contact_fullname, '') = '';

update public.contacts
set company_name = coalesce(nullif(company_name, ''), 'Unknown Company')
where coalesce(company_name, '') = '';

update public.contacts
set source = coalesce(source, 'imported');

alter table public.contacts alter column source set default 'imported';
alter table public.contacts alter column contact_fullname set not null;
alter table public.contacts alter column company_name set not null;
alter table public.contacts alter column source set not null;

-- raw_uploads table
create table if not exists public.raw_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  upload_batch_id uuid not null,
  contact_fullname text not null,
  first_name text,
  last_name text,
  company_name text not null,
  job_title text,
  email text,
  linkedin_url text,
  status text not null default 'pending',
  uploaded_at timestamp with time zone default now(),
  enriched_at timestamp with time zone
);

alter table public.raw_uploads add column if not exists upload_batch_id uuid;
alter table public.raw_uploads add column if not exists contact_fullname text;
alter table public.raw_uploads add column if not exists first_name text;
alter table public.raw_uploads add column if not exists last_name text;
alter table public.raw_uploads add column if not exists company_name text;
alter table public.raw_uploads add column if not exists job_title text;
alter table public.raw_uploads add column if not exists email text;
alter table public.raw_uploads add column if not exists linkedin_url text;
alter table public.raw_uploads add column if not exists status text;
alter table public.raw_uploads add column if not exists uploaded_at timestamp with time zone default now();
alter table public.raw_uploads add column if not exists enriched_at timestamp with time zone;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'raw_uploads' and column_name = 'contact_name'
  ) then
    execute $sql$
      update public.raw_uploads
      set contact_fullname = coalesce(nullif(contact_fullname, ''), nullif(contact_name, ''))
      where coalesce(contact_fullname, '') = ''
    $sql$;
  end if;
end $$;

update public.raw_uploads
set contact_fullname = coalesce(nullif(contact_fullname, ''), 'Unknown Contact')
where coalesce(contact_fullname, '') = '';

update public.raw_uploads
set company_name = coalesce(nullif(company_name, ''), 'Unknown Company')
where coalesce(company_name, '') = '';

update public.raw_uploads
set status = coalesce(status, 'pending');

update public.raw_uploads
set upload_batch_id = coalesce(upload_batch_id, gen_random_uuid());

alter table public.raw_uploads alter column status set default 'pending';
alter table public.raw_uploads alter column upload_batch_id set not null;
alter table public.raw_uploads alter column contact_fullname set not null;
alter table public.raw_uploads alter column company_name set not null;
alter table public.raw_uploads alter column status set not null;

-- signals table
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  signal_type text not null,
  signal_date timestamp with time zone not null,
  signal_source text,
  signal_detail jsonb,
  created_at timestamp with time zone default now()
);

alter table public.signals add column if not exists entity_type text;
alter table public.signals add column if not exists entity_id uuid;
alter table public.signals add column if not exists signal_type text;
alter table public.signals add column if not exists signal_date timestamp with time zone;
alter table public.signals add column if not exists signal_source text;
alter table public.signals add column if not exists signal_detail jsonb;
alter table public.signals add column if not exists created_at timestamp with time zone default now();

update public.signals
set entity_type = coalesce(nullif(entity_type, ''), 'unknown')
where entity_type is null;

update public.signals
set signal_type = coalesce(nullif(signal_type, ''), 'unknown')
where signal_type is null;

update public.signals
set signal_date = coalesce(signal_date, now())
where signal_date is null;

alter table public.signals alter column entity_type set not null;
alter table public.signals alter column entity_id set not null;
alter table public.signals alter column signal_type set not null;
alter table public.signals alter column signal_date set not null;

-- upload_batches table
create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  filename text not null,
  total_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  enriched_rows integer not null default 0,
  failed_rows integer not null default 0,
  status text not null default 'processing',
  created_at timestamp with time zone default now(),
  completed_at timestamp with time zone
);

alter table public.upload_batches add column if not exists filename text;
alter table public.upload_batches add column if not exists total_rows integer default 0;
alter table public.upload_batches add column if not exists duplicate_rows integer default 0;
alter table public.upload_batches add column if not exists enriched_rows integer default 0;
alter table public.upload_batches add column if not exists failed_rows integer default 0;
alter table public.upload_batches add column if not exists status text default 'processing';
alter table public.upload_batches add column if not exists created_at timestamp with time zone default now();
alter table public.upload_batches add column if not exists completed_at timestamp with time zone;

update public.upload_batches set filename = coalesce(nullif(filename, ''), 'upload.csv') where coalesce(filename, '') = '';
update public.upload_batches set total_rows = coalesce(total_rows, 0);
update public.upload_batches set duplicate_rows = coalesce(duplicate_rows, 0);
update public.upload_batches set enriched_rows = coalesce(enriched_rows, 0);
update public.upload_batches set failed_rows = coalesce(failed_rows, 0);
update public.upload_batches set status = coalesce(status, 'processing');

alter table public.upload_batches alter column filename set not null;
alter table public.upload_batches alter column total_rows set default 0;
alter table public.upload_batches alter column total_rows set not null;
alter table public.upload_batches alter column duplicate_rows set default 0;
alter table public.upload_batches alter column duplicate_rows set not null;
alter table public.upload_batches alter column enriched_rows set default 0;
alter table public.upload_batches alter column enriched_rows set not null;
alter table public.upload_batches alter column failed_rows set default 0;
alter table public.upload_batches alter column failed_rows set not null;
alter table public.upload_batches alter column status set default 'processing';
alter table public.upload_batches alter column status set not null;

-- locked_signal_clicks table
create table if not exists public.locked_signal_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  signal_id text not null,
  signal_name text not null,
  clicked_at timestamp with time zone default now()
);

alter table public.locked_signal_clicks add column if not exists signal_id text;
alter table public.locked_signal_clicks add column if not exists signal_name text;
alter table public.locked_signal_clicks add column if not exists clicked_at timestamp with time zone default now();

update public.locked_signal_clicks set signal_id = coalesce(nullif(signal_id, ''), 'unknown') where signal_id is null;
update public.locked_signal_clicks set signal_name = coalesce(nullif(signal_name, ''), 'unknown') where signal_name is null;

alter table public.locked_signal_clicks alter column signal_id set not null;
alter table public.locked_signal_clicks alter column signal_name set not null;

-- Row level security
alter table public.raw_uploads enable row level security;
alter table public.contacts enable row level security;
alter table public.companies enable row level security;
alter table public.signals enable row level security;
alter table public.upload_batches enable row level security;
alter table public.locked_signal_clicks enable row level security;

drop policy if exists "Users can only access their own data" on public.raw_uploads;
create policy "Users can only access their own data"
on public.raw_uploads
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own data" on public.contacts;
create policy "Users can only access their own data"
on public.contacts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own data" on public.companies;
create policy "Users can only access their own data"
on public.companies
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own data" on public.signals;
create policy "Users can only access their own data"
on public.signals
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own data" on public.upload_batches;
create policy "Users can only access their own data"
on public.upload_batches
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own data" on public.locked_signal_clicks;
create policy "Users can only access their own data"
on public.locked_signal_clicks
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Indexes
-- contacts
create index if not exists contacts_user_id_idx on public.contacts(user_id);
create index if not exists contacts_linkedin_url_idx on public.contacts(linkedin_url);
create index if not exists contacts_email_idx on public.contacts(email);
create index if not exists contacts_company_id_idx on public.contacts(company_id);
create index if not exists contacts_contact_priority_score_desc_idx on public.contacts(contact_priority_score desc);
create index if not exists contacts_source_idx on public.contacts(source);

-- companies
create index if not exists companies_user_id_idx on public.companies(user_id);
create index if not exists companies_company_website_idx on public.companies(company_website);
create index if not exists companies_company_priority_score_desc_idx on public.companies(company_priority_score desc);
create index if not exists companies_source_idx on public.companies(source);

-- signals
create index if not exists signals_entity_id_idx on public.signals(entity_id);
create index if not exists signals_entity_type_idx on public.signals(entity_type);
create index if not exists signals_signal_date_desc_idx on public.signals(signal_date desc);
create index if not exists signals_user_id_idx on public.signals(user_id);

-- raw_uploads
create index if not exists raw_uploads_upload_batch_id_idx on public.raw_uploads(upload_batch_id);
create index if not exists raw_uploads_user_id_idx on public.raw_uploads(user_id);
create index if not exists raw_uploads_status_idx on public.raw_uploads(status);

-- updated_at trigger
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists contacts_updated_at on public.contacts;
create trigger contacts_updated_at
before update on public.contacts
for each row execute function public.update_updated_at();

drop trigger if exists companies_updated_at on public.companies;
create trigger companies_updated_at
before update on public.companies
for each row execute function public.update_updated_at();
