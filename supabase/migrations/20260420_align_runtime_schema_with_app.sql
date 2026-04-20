-- Align the persisted schema with the current Arcova runtime payloads.
-- This captures older runtime column drift (full_name, batch_id, raw_data, fit_score)
-- in addition to the newer pass2/pass3 pipeline fields.

alter table public.contacts
add column if not exists full_name text,
add column if not exists raw_upload_id uuid references public.raw_uploads(id) on delete set null,
add column if not exists batch_id uuid references public.upload_batches(id) on delete set null,
add column if not exists profile_photo_url text,
add column if not exists headline text,
add column if not exists years_in_current_role double precision,
add column if not exists location text,
add column if not exists city text,
add column if not exists country text,
add column if not exists company_domain text,
add column if not exists company_linkedin_url text,
add column if not exists fiber_person_response_raw jsonb,
add column if not exists fiber_company_response_raw jsonb,
add column if not exists fiber_person_raw jsonb,
add column if not exists fiber_company_raw jsonb,
add column if not exists fiber_lookup_metadata jsonb,
add column if not exists apollo_person_response_raw jsonb,
add column if not exists apollo_person_raw jsonb,
add column if not exists apollo_organization_raw jsonb,
add column if not exists apollo_lookup_metadata jsonb,
add column if not exists fit_score double precision,
add column if not exists intent_score double precision,
add column if not exists fit_score_reasoning text,
add column if not exists fit_score_matched_on text[],
add column if not exists fit_score_gaps text,
add column if not exists priority_score double precision,
add column if not exists last_enriched_at timestamp with time zone,
add column if not exists pass1_status text,
add column if not exists email_status text,
add column if not exists email_status_reasoning text,
add column if not exists linkedin_resolution_source text,
add column if not exists linkedin_resolution_confidence double precision,
add column if not exists linkedin_resolution_summary text,
add column if not exists pass2_status text,
add column if not exists pass2_last_error text,
add column if not exists pass2_started_at timestamp with time zone,
add column if not exists pass2_completed_at timestamp with time zone,
add column if not exists pass3_status text,
add column if not exists pass3_provider text,
add column if not exists pass3_last_error text,
add column if not exists pass3_started_at timestamp with time zone,
add column if not exists pass3_completed_at timestamp with time zone,
add column if not exists apify_profile_raw jsonb,
add column if not exists apify_lookup_metadata jsonb,
add column if not exists pass3_alignment_metadata jsonb,
add column if not exists resolved_current_company_name text,
add column if not exists resolved_current_company_domain text,
add column if not exists resolved_current_job_title text,
add column if not exists resolved_employment_history jsonb,
add column if not exists resolved_company_firmographics jsonb;

alter table public.raw_uploads
add column if not exists batch_id uuid references public.upload_batches(id) on delete set null,
add column if not exists full_name text,
add column if not exists raw_data jsonb;

do $$
declare
  priority_score_is_generated text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contacts'
      and column_name = 'contact_fullname'
  ) then
    execute $sql$
      update public.contacts
      set full_name = coalesce(nullif(full_name, ''), nullif(contact_fullname, ''))
      where coalesce(full_name, '') = ''
    $sql$;
  end if;

  execute $sql$
    update public.contacts
    set full_name = nullif(trim(concat_ws(' ', first_name, last_name)), '')
    where coalesce(full_name, '') = ''
      and nullif(trim(concat_ws(' ', first_name, last_name)), '') is not null
  $sql$;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contacts'
      and column_name = 'upload_batch_id'
  ) then
    execute $sql$
      update public.contacts
      set batch_id = coalesce(batch_id, upload_batch_id)
      where batch_id is null
        and upload_batch_id is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contacts'
      and column_name = 'contact_fit_score'
  ) then
    execute $sql$
      update public.contacts
      set fit_score = coalesce(fit_score, contact_fit_score)
      where fit_score is null
        and contact_fit_score is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'contacts'
      and column_name = 'contact_intent_score'
  ) then
    execute $sql$
      update public.contacts
      set intent_score = coalesce(intent_score, contact_intent_score)
      where intent_score is null
        and contact_intent_score is not null
    $sql$;
  end if;

  select c.is_generated
  into priority_score_is_generated
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'contacts'
    and c.column_name = 'priority_score';

  if coalesce(priority_score_is_generated, 'NEVER') = 'NEVER' then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'contacts'
        and column_name = 'contact_priority_score'
    ) then
      execute $sql$
        update public.contacts
        set priority_score = coalesce(priority_score, contact_priority_score)
        where priority_score is null
          and contact_priority_score is not null
      $sql$;
    end if;

    execute $sql$
      update public.contacts
      set priority_score = fit_score * intent_score
      where priority_score is null
        and fit_score is not null
        and intent_score is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'raw_uploads'
      and column_name = 'upload_batch_id'
  ) then
    execute $sql$
      update public.raw_uploads
      set batch_id = coalesce(batch_id, upload_batch_id)
      where batch_id is null
        and upload_batch_id is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'raw_uploads'
      and column_name = 'contact_fullname'
  ) then
    execute $sql$
      update public.raw_uploads
      set full_name = coalesce(nullif(full_name, ''), nullif(contact_fullname, ''))
      where coalesce(full_name, '') = ''
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'raw_uploads'
      and column_name = 'contact_name'
  ) then
    execute $sql$
      update public.raw_uploads
      set full_name = coalesce(nullif(full_name, ''), nullif(contact_name, ''))
      where coalesce(full_name, '') = ''
    $sql$;
  end if;

  execute $sql$
    update public.raw_uploads
    set full_name = coalesce(
      nullif(full_name, ''),
      nullif(trim(concat_ws(' ', first_name, last_name)), '')
    )
    where coalesce(full_name, '') = ''
  $sql$;
end $$;

update public.raw_uploads
set raw_data = jsonb_strip_nulls(
  jsonb_build_object(
    'full_name', full_name,
    'email', email,
    'linkedin_url', linkedin_url,
    'company_name', company_name
  )
)
where raw_data is null;

update public.contacts
set pass1_status = coalesce(pass1_status, 'completed'),
    pass2_status = coalesce(pass2_status, 'pending'),
    pass3_status = coalesce(pass3_status, 'pending'),
    email_status = coalesce(
      email_status,
      case
        when nullif(trim(email), '') is null then 'missing'
        else 'candidate'
      end
    ),
    email_status_reasoning = coalesce(
      email_status_reasoning,
      case
        when nullif(trim(email), '') is null then 'No email returned during pass1 enrichment.'
        else 'Candidate email from pass1 provider. Current company alignment not resolved yet.'
      end
    );

alter table public.contacts
alter column pass1_status set default 'completed',
alter column pass2_status set default 'pending',
alter column pass3_status set default 'pending',
alter column fit_score_matched_on set default '{}'::text[],
alter column intent_score set default 1.0;

alter table public.contacts
drop constraint if exists contacts_pass1_status_check;

alter table public.contacts
add constraint contacts_pass1_status_check
check (pass1_status is null or pass1_status = any (array[
  'pending'::text,
  'processing'::text,
  'completed'::text,
  'failed'::text,
  'skipped'::text
]));

alter table public.contacts
drop constraint if exists contacts_pass2_status_check;

alter table public.contacts
add constraint contacts_pass2_status_check
check (pass2_status is null or pass2_status = any (array[
  'pending'::text,
  'processing'::text,
  'completed'::text,
  'ambiguous'::text,
  'failed'::text,
  'blocked'::text
]));

alter table public.contacts
drop constraint if exists contacts_pass3_status_check;

alter table public.contacts
add constraint contacts_pass3_status_check
check (pass3_status is null or pass3_status = any (array[
  'pending'::text,
  'processing'::text,
  'completed'::text,
  'ambiguous'::text,
  'failed'::text,
  'blocked'::text
]));

alter table public.contacts
drop constraint if exists contacts_email_status_check;

alter table public.contacts
add constraint contacts_email_status_check
check (email_status is null or email_status = any (array[
  'aligned_current'::text,
  'candidate'::text,
  'stale_suspected'::text,
  'missing'::text
]));

alter table public.contacts
drop constraint if exists contacts_linkedin_resolution_confidence_check;

alter table public.contacts
add constraint contacts_linkedin_resolution_confidence_check
check (
  linkedin_resolution_confidence is null
  or (
    linkedin_resolution_confidence >= 0
    and linkedin_resolution_confidence <= 1
  )
);

create index if not exists contacts_pass2_status_idx
on public.contacts (pass2_status);

create index if not exists contacts_pass3_status_idx
on public.contacts (pass3_status);

create index if not exists raw_uploads_batch_id_idx
on public.raw_uploads (batch_id);
