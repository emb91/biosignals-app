-- Public "Contact us" form destination (replaces the Airtable integration).
-- Written only by the service-role contact API route (app/api/contact/route.ts).
create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  company text,
  message text not null
);

-- RLS on with no policies: the public anon/authenticated keys cannot read or
-- write this table. The contact route writes with the service-role admin
-- client, which bypasses RLS. Submissions are not customer-visible.
alter table public.contact_submissions enable row level security;

comment on table public.contact_submissions is 'Public "Contact us" form submissions (replaces the Airtable destination). Written only by the service-role contact API route.';
