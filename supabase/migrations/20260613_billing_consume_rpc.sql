-- billing_consume_contact: atomic contact-meter consumption (Phase 4).
--
-- One call decides whether a contact may be billed to the org and records it:
--   1. Insert into org_billable_contact_events; the UNIQUE(org_id, person_id)
--      constraint makes a re-bill a no-op ('already_billed' — refreshes are free).
--   2. If the new event fits inside the plan's included allowance → 'allowed_included'.
--   3. Otherwise draw one contact from the oldest prepaid pack → 'allowed_pack'.
--   4. Otherwise: enforcing → roll back the event and return 'denied';
--      shadow mode → keep the event and return 'allowed_shadow' (metering only).
--
-- p_period_start NULL means a lifetime allowance (free tier).
-- Service-role only: execute is revoked from anon/authenticated.

create or replace function public.billing_consume_contact(
  p_org_id uuid,
  p_person_id uuid,
  p_user_id uuid default null,
  p_user_contact_id uuid default null,
  p_source text default 'enrichment',
  p_included integer default 0,
  p_period_start timestamptz default null,
  p_enforce boolean default false
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_pack uuid;
begin
  insert into org_billable_contact_events (org_id, person_id, user_id, user_contact_id, source)
  values (p_org_id, p_person_id, p_user_id, p_user_contact_id, p_source)
  on conflict (org_id, person_id) do nothing;
  if not found then
    return 'already_billed';
  end if;

  select count(*) into v_used
  from org_billable_contact_events
  where org_id = p_org_id
    and (p_period_start is null or created_at >= p_period_start);

  if v_used <= p_included then
    return 'allowed_included';
  end if;

  update org_contact_packs
     set contacts_remaining = contacts_remaining - 1
   where id = (
     select id from org_contact_packs
      where org_id = p_org_id and contacts_remaining > 0
      order by purchased_at asc
      limit 1
      for update skip locked
   )
  returning id into v_pack;
  if v_pack is not null then
    return 'allowed_pack';
  end if;

  if p_enforce then
    delete from org_billable_contact_events
     where org_id = p_org_id and person_id = p_person_id;
    return 'denied';
  end if;

  return 'allowed_shadow';
end
$$;

revoke execute on function public.billing_consume_contact(uuid, uuid, uuid, uuid, text, integer, timestamptz, boolean) from public;
revoke execute on function public.billing_consume_contact(uuid, uuid, uuid, uuid, text, integer, timestamptz, boolean) from anon;
revoke execute on function public.billing_consume_contact(uuid, uuid, uuid, uuid, text, integer, timestamptz, boolean) from authenticated;
