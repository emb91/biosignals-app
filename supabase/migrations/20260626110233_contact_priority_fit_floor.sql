-- Priority should use the weaker available fit as the fit floor, then apply the
-- readiness boost. Multiplying company and contact fit made strong-fit, ready
-- contacts appear artificially low (for example 82/78/100 rendered as 64
-- instead of 78).

create or replace function public.compute_priority_score(
  p_company_fit numeric,
  p_readiness numeric,
  p_contact_fit numeric default 1.0
)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case
    when p_company_fit is null
      or p_readiness is null
      or p_contact_fit is null
    then null
    else least(
      1.0,
      greatest(
        0.0,
        least(p_company_fit, p_contact_fit) * (0.5 + 0.5 * p_readiness)
      )
    )::numeric
  end;
$function$;

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
    else public.compute_priority_score(calc.company_fit::numeric, calc.effective_readiness::numeric, calc.contact_fit::numeric)
  end
  from calc
  where uc.id = calc.id;
$function$;

revoke all on function public.refresh_contact_priority_scores(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_contact_priority_scores(uuid)
  to service_role;

update public.account_readiness_snapshots
set priority_score = public.compute_priority_score(fit_score, overall_score)
where fit_score is not null
  and overall_score is not null;

-- Keep existing snapshot/mirror rows aligned with the corrected policy.
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
  else public.compute_priority_score(calc.company_fit::numeric, calc.effective_readiness::numeric, calc.contact_fit::numeric)
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
