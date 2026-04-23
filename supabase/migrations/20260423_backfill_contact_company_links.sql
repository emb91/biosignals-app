insert into public.companies (
  user_id,
  domain,
  company_name,
  linkedin_url,
  source,
  last_enriched_at,
  updated_at
)
select distinct
  c.user_id,
  nullif(
    lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(trim(coalesce(c.resolved_current_company_domain, c.company_domain, '')), '^https?://', '', 'i'),
          '^www\.',
          '',
          'i'
        ),
        '/.*$',
        ''
      )
    ),
    ''
  ) as domain,
  nullif(trim(coalesce(c.resolved_current_company_name, c.company_name, '')), '') as company_name,
  nullif(trim(c.company_linkedin_url), '') as linkedin_url,
  'contact_backfill',
  coalesce(c.updated_at, now()),
  now()
from public.contacts c
where nullif(
  lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(trim(coalesce(c.resolved_current_company_domain, c.company_domain, '')), '^https?://', '', 'i'),
        '^www\.',
        '',
        'i'
      ),
      '/.*$',
      ''
    )
  ),
  ''
) is not null
on conflict (user_id, domain) do update
set
  company_name = coalesce(excluded.company_name, public.companies.company_name),
  linkedin_url = coalesce(excluded.linkedin_url, public.companies.linkedin_url),
  updated_at = now();

update public.contacts c
set
  company_id = companies.id,
  updated_at = now()
from public.companies companies
where c.company_id is null
  and companies.user_id = c.user_id
  and companies.domain = nullif(
    lower(
      regexp_replace(
        regexp_replace(
          regexp_replace(trim(coalesce(c.resolved_current_company_domain, c.company_domain, '')), '^https?://', '', 'i'),
          '^www\.',
          '',
          'i'
        ),
        '/.*$',
        ''
      )
    ),
    ''
  );
