-- Phase 1d — `companies` becomes a globally canonical/shared directory.
--
-- Drops:
--   - trigger trg_sync_user_companies_on_companies_update (per-user state has
--     moved to user_companies; no source to mirror anymore)
--   - function sync_user_companies_from_companies (no other users)
--   - users_own_companies RLS policy (depends on companies.user_id)
--   - accounts_view (depends on user_companies.priority_score, which is being
--     recreated as a generated column)
--   - companies.priority_score (generated; depends on fit_score+intent_score)
--   - companies per-user columns: matched_icp_id, fit_score, intent_score,
--     company_fit_*, archived_*, source
--   - companies_user_id_domain_key (the per-user uniqueness was the whole point
--     of the duplication)
--   - companies_user_id_fkey + companies.user_id
--
-- Adds:
--   - user_companies.priority_score becomes a generated column (fit*intent),
--     mirroring the behaviour that used to live on companies. Keeps existing
--     callers reading priority_score from accounts_view/user_companies working
--     with no code changes.
--   - companies needs_review boolean default false (used by Phase 2 resolver
--     when it auto-creates canonical rows for unknown mentions)
--   - UNIQUE INDEX on lower(domain) WHERE domain IS NOT NULL — new canonical key
--   - New RLS: companies is now shared. All authenticated SELECT; INSERT and
--     UPDATE restricted to service_role (server-side enrichment pipelines and
--     the Phase 2 resolver).
--   - accounts_view recreated with the same logic (rebuilt after column dance).
--
-- customer_therapeutic_areas / customer_modalities / customer_development_stages
-- stay on companies — these describe the company's customer base, not a per-
-- user preference. They are also mirrored on user_companies for legacy
-- reasons; that duplication is out of scope for this migration.

drop trigger if exists trg_sync_user_companies_on_companies_update on companies;
drop function if exists sync_user_companies_from_companies();

-- Policies/views that reference columns we're about to drop must come down
-- first.
drop policy if exists users_own_companies on companies;
drop view if exists accounts_view;

-- Replace user_companies.priority_score with a generated column (mirrors the
-- old companies.priority_score behaviour).
alter table user_companies drop column if exists priority_score;
alter table user_companies add column priority_score double precision
  generated always as (
    case
      when fit_score is not null and intent_score is not null then fit_score * intent_score
      else null
    end
  ) stored;

-- Drop the generated companies column first, then its source columns.
alter table companies drop column if exists priority_score;

alter table companies drop column if exists matched_icp_id;
alter table companies drop column if exists fit_score;
alter table companies drop column if exists intent_score;
alter table companies drop column if exists company_fit_score;
alter table companies drop column if exists company_fit_breakdown;
alter table companies drop column if exists company_fit_coverage;
alter table companies drop column if exists company_fit_scored_at;
alter table companies drop column if exists company_fit_version;
alter table companies drop column if exists company_fit_summary;
alter table companies drop column if exists archived_at;
alter table companies drop column if exists archived_by;
alter table companies drop column if exists archived_reason;
alter table companies drop column if exists source;

alter table companies drop constraint if exists companies_user_id_domain_key;
alter table companies drop constraint if exists companies_user_id_fkey;
alter table companies drop column if exists user_id;

create unique index if not exists companies_domain_lower_key
  on companies (lower(domain))
  where domain is not null and domain <> '';

alter table companies add column if not exists needs_review boolean not null default false;

-- companies is now shared. Anyone authenticated can SELECT; writes only via
-- service_role (which bypasses RLS).
create policy companies_select_authenticated on companies
  for select to authenticated using (true);

create view accounts_view with (security_invoker = true) as
select
  c.id,
  c.domain,
  coalesce(uc.user_overrides->>'company_name', c.company_name) as company_name,
  coalesce(uc.user_overrides->>'website', c.website) as website,
  coalesce(uc.user_overrides->>'description', c.description) as description,
  coalesce(uc.user_overrides->>'industry', c.industry) as industry,
  coalesce(uc.user_overrides->>'sub_industry', c.sub_industry) as sub_industry,
  coalesce((uc.user_overrides->>'employee_count')::int, c.employee_count) as employee_count,
  coalesce(uc.user_overrides->>'employee_range', c.employee_range) as employee_range,
  coalesce((uc.user_overrides->>'founded_year')::int, c.founded_year) as founded_year,
  coalesce(uc.user_overrides->>'headquarters_city', c.headquarters_city) as headquarters_city,
  coalesce(uc.user_overrides->>'headquarters_country', c.headquarters_country) as headquarters_country,
  coalesce(uc.user_overrides->>'headquarters_state', c.headquarters_state) as headquarters_state,
  c.funding_stage,
  c.total_funding_usd,
  c.latest_funding_date,
  c.technologies,
  coalesce(
    case when uc.user_overrides ? 'therapeutic_areas'
         then array(select jsonb_array_elements_text(uc.user_overrides->'therapeutic_areas'))
         else null end,
    c.therapeutic_areas
  ) as therapeutic_areas,
  coalesce(
    case when uc.user_overrides ? 'modalities'
         then array(select jsonb_array_elements_text(uc.user_overrides->'modalities'))
         else null end,
    c.modalities
  ) as modalities,
  coalesce(uc.user_overrides->>'clinical_stage', c.clinical_stage) as clinical_stage,
  c.last_enriched_at,
  c.created_at,
  c.updated_at,
  c.follower_count,
  c.logo_url,
  coalesce(uc.user_overrides->>'linkedin_url', c.linkedin_url) as linkedin_url,
  coalesce(uc.user_overrides->>'tagline', c.tagline) as tagline,
  c.specialties,
  c.funding_data_source,
  c.funding_checked_at,
  coalesce(uc.user_overrides->>'bio_summary', c.bio_summary) as bio_summary,
  c.funding_resolution_confidence,
  c.funding_resolution_summary,
  c.funding_resolution_last_error,
  c.funding_status_label,
  coalesce(uc.user_overrides->>'company_type', c.company_type) as company_type,
  coalesce(uc.user_overrides->>'company_type_display', c.company_type_display) as company_type_display,
  c.taxonomy_evidence_summary,
  coalesce(
    case when uc.user_overrides ? 'development_stages'
         then array(select jsonb_array_elements_text(uc.user_overrides->'development_stages'))
         else null end,
    c.development_stages
  ) as development_stages,
  coalesce(uc.user_overrides->>'company_size_bucket', c.company_size_bucket) as company_size_bucket,
  coalesce(uc.user_overrides->>'platform_category', c.platform_category) as platform_category,
  coalesce(
    case when uc.user_overrides ? 'products_services'
         then array(select jsonb_array_elements_text(uc.user_overrides->'products_services'))
         else null end,
    c.products_services
  ) as products_services,
  coalesce(
    case when uc.user_overrides ? 'services'
         then array(select jsonb_array_elements_text(uc.user_overrides->'services'))
         else null end,
    c.services
  ) as services,
  c.aliases,
  c.aliases_updated_at,
  uc.user_id,
  uc.user_overrides,
  uc.archived_at,
  uc.archived_by,
  uc.archived_reason,
  uc.source,
  uc.added_at,
  uc.matched_icp_id,
  uc.fit_score,
  uc.intent_score,
  uc.priority_score,
  uc.company_fit_score,
  uc.company_fit_breakdown,
  uc.company_fit_coverage,
  uc.company_fit_scored_at,
  uc.company_fit_version,
  uc.customer_therapeutic_areas,
  uc.customer_modalities,
  uc.customer_development_stages
from companies c
join user_companies uc on uc.company_id = c.id;

comment on view accounts_view is
  'Per-(user, company) flat row. Editable fields COALESCE per-user overrides over canonical companies data.';
