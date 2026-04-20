alter table public.contacts
add column if not exists pass1_status text,
add column if not exists email_status text,
add column if not exists email_status_reasoning text,
add column if not exists linkedin_resolution_source text,
add column if not exists linkedin_resolution_confidence float,
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

alter table public.contacts
alter column pass1_status set default 'completed',
alter column pass2_status set default 'pending',
alter column pass3_status set default 'pending';
