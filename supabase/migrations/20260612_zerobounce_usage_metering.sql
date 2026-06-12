-- Extend retroactive provider usage view with ZeroBounce counts from contact_emails.

drop view if exists public.data_provider_usage_by_user;

create or replace view public.data_provider_usage_by_user
with (security_invoker = true) as
with c as (
  select
    user_id,
    count(*) filter (where apify_profile_raw is not null) as apify_profile_scrapes,
    count(*) filter (where apify_company_raw is not null) as apify_company_scrapes,
    count(*) filter (where apollo_person_raw is not null) as apollo_person_enrichments,
    count(*) filter (where apollo_organization_raw is not null) as apollo_org_enrichments
  from public.contacts
  group by user_id
),
r as (
  select
    user_id,
    count(*) as phone_reveal_requests,
    count(*) filter (where status = 'received') as phone_reveals_received
  from public.apollo_phone_reveal_requests
  group by user_id
),
z as (
  select
    user_id,
    count(*) filter (
      where email_deliverability_provider = 'zerobounce'
        and email_deliverability_checked_at is not null
    ) as zerobounce_email_validations,
    count(*) filter (where source_provider = 'zerobounce_finder') as zerobounce_email_finder_successes
  from public.contact_emails
  group by user_id
)
select
  coalesce(c.user_id, r.user_id, z.user_id) as user_id,
  coalesce(c.apify_profile_scrapes, 0) as apify_profile_scrapes,
  coalesce(c.apify_company_scrapes, 0) as apify_company_scrapes,
  coalesce(c.apollo_person_enrichments, 0) as apollo_person_enrichments,
  coalesce(c.apollo_org_enrichments, 0) as apollo_org_enrichments,
  coalesce(r.phone_reveal_requests, 0) as phone_reveal_requests,
  coalesce(r.phone_reveals_received, 0) as phone_reveals_received,
  coalesce(z.zerobounce_email_validations, 0) as zerobounce_email_validations,
  coalesce(z.zerobounce_email_finder_successes, 0) as zerobounce_email_finder_successes
from c
full outer join r on c.user_id = r.user_id
full outer join z on coalesce(c.user_id, r.user_id) = z.user_id;
