-- Contact priority mirrors must use the same snapshot-backed account readiness
-- as /companies, /contacts, and accounts_view.
--
-- The previous refresh_contact_priority_scores RPC joined user_companies, a
-- legacy mirror that can drift from account_readiness_snapshots. That made
-- contact sorting/pagination regress even when the API recomputed display
-- priority correctly.

create or replace function public.refresh_contact_priority_scores(p_user_id uuid)
returns void
language sql
set search_path = public, pg_temp
as $function$
  with calc as (
    select
      uc.id,
      case
        when uc.contact_fit_score > 1 and uc.contact_fit_score <= 100 then uc.contact_fit_score / 100.0
        when uc.contact_fit_score >= 0 and uc.contact_fit_score <= 1 then uc.contact_fit_score
        else null
      end as contact_fit,
      case
        when av.company_fit_score > 1 and av.company_fit_score <= 100 then av.company_fit_score / 100.0
        when av.company_fit_score >= 0 and av.company_fit_score <= 1 then av.company_fit_score
        else null
      end as company_fit,
      least(1.0, greatest(0.0,
        greatest(coalesce(av.readiness_score, 0), coalesce(crs.overall_score::double precision, uc.readiness_score, 0))
        + case
            when coalesce(av.readiness_score, 0) > 0
             and coalesce(crs.overall_score::double precision, uc.readiness_score, 0) > 0
            then 0.1 * least(av.readiness_score, coalesce(crs.overall_score::double precision, uc.readiness_score, 0))
            else 0
          end
      )) as effective_readiness
    from public.user_contacts uc
    left join public.accounts_view av
      on av.id = uc.company_id
     and av.user_id = uc.user_id
    left join public.contact_readiness_snapshots crs
      on crs.contact_id = uc.id
     and crs.user_id = uc.user_id
    where uc.user_id = p_user_id
  )
  update public.user_contacts uc
  set priority_score = case
    when calc.company_fit is null or calc.contact_fit is null then null
    else least(1.0, greatest(0.0, calc.company_fit * calc.contact_fit * (0.5 + 0.5 * calc.effective_readiness)))::numeric
  end
  from calc
  where uc.id = calc.id;
$function$;

revoke all on function public.refresh_contact_priority_scores(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_contact_priority_scores(uuid)
  to service_role;

-- Keep contact_readiness_snapshots.priority_score aligned for contacts that
-- have a snapshot row. Contacts without a snapshot still get a sortable mirror
-- on user_contacts via the RPC/backfill below.
with calc as (
  select
    crs.id,
    case
      when uc.contact_fit_score > 1 and uc.contact_fit_score <= 100 then uc.contact_fit_score / 100.0
      when uc.contact_fit_score >= 0 and uc.contact_fit_score <= 1 then uc.contact_fit_score
      else null
    end as contact_fit,
    case
      when av.company_fit_score > 1 and av.company_fit_score <= 100 then av.company_fit_score / 100.0
      when av.company_fit_score >= 0 and av.company_fit_score <= 1 then av.company_fit_score
      else null
    end as company_fit,
    least(1.0, greatest(0.0,
      greatest(coalesce(av.readiness_score, 0), coalesce(crs.overall_score::double precision, uc.readiness_score, 0))
      + case
          when coalesce(av.readiness_score, 0) > 0
           and coalesce(crs.overall_score::double precision, uc.readiness_score, 0) > 0
          then 0.1 * least(av.readiness_score, coalesce(crs.overall_score::double precision, uc.readiness_score, 0))
          else 0
        end
    )) as effective_readiness
  from public.contact_readiness_snapshots crs
  join public.user_contacts uc
    on uc.id = crs.contact_id
   and uc.user_id = crs.user_id
  left join public.accounts_view av
    on av.id = uc.company_id
   and av.user_id = uc.user_id
)
update public.contact_readiness_snapshots crs
set priority_score = case
  when calc.company_fit is null or calc.contact_fit is null then null
  else least(1.0, greatest(0.0, calc.company_fit * calc.contact_fit * (0.5 + 0.5 * calc.effective_readiness)))::numeric
end
from calc
where crs.id = calc.id;

do $$
declare
  user_row record;
begin
  for user_row in select distinct user_id from public.user_contacts loop
    perform public.refresh_contact_priority_scores(user_row.user_id);
  end loop;
end $$;
