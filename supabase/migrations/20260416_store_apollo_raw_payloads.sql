alter table public.contacts
add column if not exists apollo_person_response_raw jsonb,
add column if not exists apollo_person_raw jsonb,
add column if not exists apollo_organization_raw jsonb,
add column if not exists apollo_lookup_metadata jsonb;

alter table public.contacts
drop constraint if exists contacts_source_check;

alter table public.contacts
add constraint contacts_source_check
check (source = any (array['imported'::text, 'arcova'::text, 'fiber'::text, 'apollo'::text]));
