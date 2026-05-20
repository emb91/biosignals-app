-- Move per-user scoring + archive metadata from companies to user_companies.
-- After this, companies holds only shared per-domain enrichment, and
-- user_companies holds everything that varies by user (matched ICP, fit
-- score, intent score, archive reason, etc.).
--
-- Phase 1: additive. Add columns + backfill. Old columns on companies stay
-- in place until reads are migrated. Dual-write ensures consistency during
-- the transition.

alter table user_companies
  add column if not exists matched_icp_id uuid,
  add column if not exists fit_score double precision,
  add column if not exists intent_score double precision,
  add column if not exists priority_score double precision,
  add column if not exists company_fit_score double precision,
  add column if not exists company_fit_breakdown jsonb,
  add column if not exists company_fit_coverage double precision,
  add column if not exists company_fit_scored_at timestamptz,
  add column if not exists company_fit_version text,
  add column if not exists customer_therapeutic_areas text[],
  add column if not exists customer_modalities text[],
  add column if not exists customer_development_stages text[],
  add column if not exists archived_by uuid,
  add column if not exists archived_reason text;

create index if not exists user_companies_fit_score_idx
  on user_companies (user_id, company_fit_score desc) where archived_at is null;
create index if not exists user_companies_intent_score_idx
  on user_companies (user_id, intent_score desc) where archived_at is null;
create index if not exists user_companies_matched_icp_idx
  on user_companies (matched_icp_id) where matched_icp_id is not null;

update user_companies uc
set
  matched_icp_id = c.matched_icp_id,
  fit_score = c.fit_score,
  intent_score = c.intent_score,
  priority_score = c.priority_score,
  company_fit_score = c.company_fit_score,
  company_fit_breakdown = c.company_fit_breakdown,
  company_fit_coverage = c.company_fit_coverage,
  company_fit_scored_at = c.company_fit_scored_at,
  company_fit_version = c.company_fit_version,
  customer_therapeutic_areas = c.customer_therapeutic_areas,
  customer_modalities = c.customer_modalities,
  customer_development_stages = c.customer_development_stages,
  archived_by = c.archived_by,
  archived_reason = c.archived_reason,
  updated_at = greatest(uc.updated_at, coalesce(c.updated_at, uc.updated_at))
from companies c
where uc.company_id = c.id
  and uc.user_id = c.user_id;
