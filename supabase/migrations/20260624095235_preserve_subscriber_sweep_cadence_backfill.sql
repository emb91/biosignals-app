-- Preserve legacy monitor cadence when per-source sweep state is backfilled.
--
-- The source-subscriber sweep migration created rows with next_sweep_at = now().
-- For existing monitored companies/contacts, that can make monthly subscribers
-- immediately due even when the legacy org monitor had a future next_sweep_at.

update public.account_source_subscriber_sweeps ass
set
  last_sweep_at = coalesce(ass.last_sweep_at, oma.last_sweep_at),
  next_sweep_at = greatest(ass.next_sweep_at, oma.next_sweep_at),
  updated_at = now()
from public.org_monitored_accounts oma
where ass.org_id = oma.org_id
  and ass.company_id = oma.company_id
  and (
    (ass.last_sweep_at is null and oma.last_sweep_at is not null)
    or oma.next_sweep_at > ass.next_sweep_at
  );

update public.contact_source_subscriber_sweeps css
set
  last_sweep_at = coalesce(css.last_sweep_at, omc.last_sweep_at),
  next_sweep_at = greatest(css.next_sweep_at, omc.next_sweep_at),
  updated_at = now()
from public.org_monitored_contacts omc
where css.org_id = omc.org_id
  and css.person_id = omc.person_id
  and (
    (css.last_sweep_at is null and omc.last_sweep_at is not null)
    or omc.next_sweep_at > css.next_sweep_at
  );

with account_next_due as (
  select
    mas.company_id,
    min(oma.next_sweep_at) as next_sweep_at
  from public.monitored_account_subscribers mas
  join public.org_monitored_accounts oma
    on oma.org_id = mas.org_id
   and oma.company_id = mas.company_id
  where mas.status = 'active'
  group by mas.company_id
)
update public.account_source_sweep_targets ast
set
  next_sweep_at = account_next_due.next_sweep_at,
  updated_at = now()
from account_next_due
where ast.company_id = account_next_due.company_id
  and ast.status = 'active'
  and account_next_due.next_sweep_at > ast.next_sweep_at;

with contact_next_due as (
  select
    mcs.person_id,
    min(omc.next_sweep_at) as next_sweep_at
  from public.monitored_contact_subscribers mcs
  join public.org_monitored_contacts omc
    on omc.org_id = mcs.org_id
   and omc.person_id = mcs.person_id
  where mcs.status = 'active'
  group by mcs.person_id
)
update public.contact_source_sweep_targets cst
set
  next_sweep_at = contact_next_due.next_sweep_at,
  updated_at = now()
from contact_next_due
where cst.person_id = contact_next_due.person_id
  and cst.status = 'active'
  and contact_next_due.next_sweep_at > cst.next_sweep_at;
