-- Align company taxonomy storage with the app's plural canonical fields.
-- Older Arcova schema used singular therapeutic_area/modality columns.

alter table public.companies
  add column if not exists therapeutic_areas text[],
  add column if not exists modalities text[];

update public.companies
set therapeutic_areas = therapeutic_area
where therapeutic_areas is null
  and therapeutic_area is not null;

update public.companies
set modalities = modality
where modalities is null
  and modality is not null;
