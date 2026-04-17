-- Align runtime schema with the Fiber-only Phase 1 import flow.

alter table public.raw_uploads
drop constraint if exists raw_uploads_status_check;

update public.raw_uploads
set status = 'enriching'
where status = 'sent_to_clay';

alter table public.raw_uploads
add constraint raw_uploads_status_check
check (status = any (array['pending'::text, 'enriching'::text, 'enriched'::text, 'duplicate'::text, 'failed'::text]));

alter table public.raw_uploads
drop column if exists clay_row_id;

update public.contacts
set source = 'imported'
where source = 'clay';

alter table public.contacts
drop constraint if exists contacts_source_check;

alter table public.contacts
add constraint contacts_source_check
check (source = any (array['imported'::text, 'arcova'::text, 'fiber'::text]));

create index if not exists contacts_batch_id_idx
on public.contacts (batch_id);

create index if not exists contacts_raw_upload_id_idx
on public.contacts (raw_upload_id);

create index if not exists contacts_scored_against_persona_id_idx
on public.contacts (scored_against_persona_id);
