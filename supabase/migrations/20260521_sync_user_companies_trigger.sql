-- During the transition: when any code writes per-user columns to companies,
-- automatically mirror them to the matching user_companies row. Saves us
-- from hunting down and dual-writing at every code path. Will be dropped
-- once all callers write directly to user_companies and the per-user columns
-- are removed from companies.

create or replace function sync_user_companies_from_companies() returns trigger as $$
begin
  if new.user_id is not null then
    update user_companies set
      matched_icp_id = new.matched_icp_id,
      fit_score = new.fit_score,
      intent_score = new.intent_score,
      priority_score = new.priority_score,
      company_fit_score = new.company_fit_score,
      company_fit_breakdown = new.company_fit_breakdown,
      company_fit_coverage = new.company_fit_coverage,
      company_fit_scored_at = new.company_fit_scored_at,
      company_fit_version = new.company_fit_version,
      customer_therapeutic_areas = new.customer_therapeutic_areas,
      customer_modalities = new.customer_modalities,
      customer_development_stages = new.customer_development_stages,
      archived_by = new.archived_by,
      archived_reason = new.archived_reason,
      archived_at = new.archived_at,
      source = new.source,
      updated_at = greatest(updated_at, now())
    where user_id = new.user_id and company_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_user_companies_on_companies_update on companies;
create trigger trg_sync_user_companies_on_companies_update
after update on companies
for each row
when (
  old.matched_icp_id is distinct from new.matched_icp_id or
  old.fit_score is distinct from new.fit_score or
  old.intent_score is distinct from new.intent_score or
  old.priority_score is distinct from new.priority_score or
  old.company_fit_score is distinct from new.company_fit_score or
  old.company_fit_breakdown::text is distinct from new.company_fit_breakdown::text or
  old.company_fit_coverage is distinct from new.company_fit_coverage or
  old.company_fit_scored_at is distinct from new.company_fit_scored_at or
  old.company_fit_version is distinct from new.company_fit_version or
  old.customer_therapeutic_areas::text is distinct from new.customer_therapeutic_areas::text or
  old.customer_modalities::text is distinct from new.customer_modalities::text or
  old.customer_development_stages::text is distinct from new.customer_development_stages::text or
  old.archived_at is distinct from new.archived_at or
  old.archived_by is distinct from new.archived_by or
  old.archived_reason is distinct from new.archived_reason or
  old.source is distinct from new.source
)
execute function sync_user_companies_from_companies();
