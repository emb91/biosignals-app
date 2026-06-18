-- Arcova-owned workspaces are permanently complimentary.
--
-- The exemption follows an owner whose verified auth email is on the exact
-- arcova.bio domain. Arcova members invited into customer workspaces do not
-- exempt those customer workspaces.

create or replace function public.mark_arcova_owner_org_billing_exempt()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
begin
  if new.role = 'owner' and exists (
    select 1
    from auth.users u
    where u.id = new.user_id
      and split_part(lower(coalesce(u.email, '')), '@', 2) = 'arcova.bio'
  ) then
    update public.organizations
       set billing_exempt = true
     where id = new.org_id
       and billing_exempt = false;
  end if;
  return new;
end;
$function$;

revoke all on function public.mark_arcova_owner_org_billing_exempt()
  from public, anon, authenticated;
grant execute on function public.mark_arcova_owner_org_billing_exempt()
  to service_role;

drop trigger if exists org_members_arcova_billing_exemption
  on public.org_members;
create trigger org_members_arcova_billing_exemption
after insert or update of org_id, user_id, role
on public.org_members
for each row execute function public.mark_arcova_owner_org_billing_exempt();

create or replace function public.mark_arcova_email_owner_orgs_billing_exempt()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
begin
  if split_part(lower(coalesce(new.email, '')), '@', 2) = 'arcova.bio' then
    update public.organizations o
       set billing_exempt = true
      from public.org_members om
     where om.org_id = o.id
       and om.user_id = new.id
       and om.role = 'owner'
       and o.billing_exempt = false;
  end if;
  return new;
end;
$function$;

revoke all on function public.mark_arcova_email_owner_orgs_billing_exempt()
  from public, anon, authenticated;
grant execute on function public.mark_arcova_email_owner_orgs_billing_exempt()
  to service_role;

drop trigger if exists auth_users_arcova_billing_exemption
  on auth.users;
create trigger auth_users_arcova_billing_exemption
after insert or update of email
on auth.users
for each row execute function public.mark_arcova_email_owner_orgs_billing_exempt();

-- Backfill current Arcova-owned workspaces.
update public.organizations o
   set billing_exempt = true
  from public.org_members om
  join auth.users u on u.id = om.user_id
 where om.org_id = o.id
   and om.role = 'owner'
   and split_part(lower(coalesce(u.email, '')), '@', 2) = 'arcova.bio'
   and o.billing_exempt = false;
