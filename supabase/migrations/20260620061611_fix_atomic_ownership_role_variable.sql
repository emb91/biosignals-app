-- `current_role` is a PostgreSQL special expression. Using it as a PL/pgSQL
-- variable caused the ownership check to compare the database role (for
-- example `service_role`) with the workspace role `owner`.
create or replace function public.transfer_org_ownership(
  p_org_id uuid,
  p_current_owner uuid,
  p_new_owner uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_role text;
  v_target_user_id uuid;
begin
  if p_current_owner = p_new_owner then
    raise exception 'same_owner';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  select role
    into v_current_member_role
    from public.org_members
   where org_id = p_org_id
     and user_id = p_current_owner
   for update;

  if v_current_member_role is distinct from 'owner' then
    raise exception 'current_user_not_owner';
  end if;

  select user_id
    into v_target_user_id
    from public.org_members
   where org_id = p_org_id
     and user_id = p_new_owner
   for update;

  if v_target_user_id is null then
    raise exception 'target_not_found';
  end if;

  update public.org_members
     set role = case
       when user_id = p_current_owner then 'admin'
       when user_id = p_new_owner then 'owner'
       else role
     end
   where org_id = p_org_id
     and user_id in (p_current_owner, p_new_owner);

  if not exists (
    select 1
      from public.org_members
     where org_id = p_org_id
       and user_id = p_new_owner
       and role = 'owner'
  ) then
    raise exception 'ownership_transfer_failed';
  end if;
end;
$$;

revoke all on function public.transfer_org_ownership(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transfer_org_ownership(uuid, uuid, uuid)
  to service_role;
