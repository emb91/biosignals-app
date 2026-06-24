alter table public.org_companies
  add column if not exists company_fit_summary text;

update public.org_companies oc
set company_fit_summary = latest.company_fit_summary
from (
  select distinct on (om.org_id, uc.company_id)
    om.org_id,
    uc.company_id,
    uc.company_fit_summary
  from public.org_members om
  join public.user_companies uc on uc.user_id = om.user_id
  where uc.company_fit_summary is not null
  order by om.org_id, uc.company_id, uc.updated_at desc nulls last
) latest
where latest.org_id = oc.org_id
  and latest.company_id = oc.company_id
  and oc.company_fit_summary is null;

comment on column public.org_companies.company_fit_summary is
  'Org-scoped summary of the winning ICP/company-fit score for this company.';
