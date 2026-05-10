-- Optional structured location fields for Leads inline edit (complement `location` free text).

alter table public.contacts add column if not exists city text;
alter table public.contacts add column if not exists country text;

comment on column public.contacts.city is 'Contact city (user-edited or future enrichment).';
comment on column public.contacts.country is 'Contact country (user-edited or future enrichment).';
