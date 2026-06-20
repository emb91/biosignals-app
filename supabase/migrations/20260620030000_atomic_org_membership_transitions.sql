begin;

create or replace function public.reassign_member_data_to(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_from = p_to then return; end if;

  update public.outreach_sequences os
     set contact_id = tgt.id
    from public.user_contacts dup
    join public.user_contacts tgt on tgt.user_id = p_to and tgt.person_id = dup.person_id
   where dup.user_id = p_from and os.contact_id = dup.id;
  update public.outreach_sequences set user_id = p_to where user_id = p_from;

  update public.contact_emails set user_id = p_to where user_id = p_from;
  update public.contact_phones set user_id = p_to where user_id = p_from;

  update public.user_contacts uc set user_id = p_to
   where uc.user_id = p_from
     and not exists (
       select 1 from public.user_contacts t
        where t.user_id = p_to and t.person_id = uc.person_id
     );
  delete from public.user_contacts where user_id = p_from;

  update public.user_companies ucp set user_id = p_to
   where ucp.user_id = p_from
     and not exists (
       select 1 from public.user_companies t
        where t.user_id = p_to and t.company_id = ucp.company_id
     );
  delete from public.user_companies where user_id = p_from;

  -- Personal setup authored by the departing member stays with the workspace.
  update public.icp_signal_selections set user_id = p_to where user_id = p_from;
  update public.persona_signal_selections set user_id = p_to where user_id = p_from;
  update public.personas set user_id = p_to where user_id = p_from;
  update public.icps set user_id = p_to where user_id = p_from;

  delete from public.contact_readiness_snapshots where user_id = p_from;
  delete from public.account_readiness_snapshots where user_id = p_from;
  delete from public.contact_attribution_snapshots where user_id = p_from;
end;
$$;

revoke all on function public.reassign_member_data_to(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reassign_member_data_to(uuid, uuid) to service_role;

create or replace function public.leave_org_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_role text;
  owner_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  select role into member_role
    from public.org_members
   where org_id = p_org_id and user_id = p_user_id
   for update;

  if member_role is null then raise exception 'member_not_found'; end if;
  if member_role = 'owner' then raise exception 'owner_cannot_leave'; end if;

  select user_id into owner_id
    from public.org_members
   where org_id = p_org_id and role = 'owner'
   for update;

  if owner_id is null then raise exception 'owner_not_found'; end if;

  perform public.reassign_member_data_to(p_user_id, owner_id);
  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_org_member(
  p_org_id uuid,
  p_actor_id uuid,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  target_role text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  select role into actor_role
    from public.org_members
   where org_id = p_org_id and user_id = p_actor_id
   for update;
  if actor_role is distinct from 'owner' then raise exception 'actor_not_owner'; end if;

  select role into target_role
    from public.org_members
   where org_id = p_org_id and user_id = p_target_id
   for update;
  if target_role is null then raise exception 'member_not_found'; end if;
  if target_role = 'owner' then raise exception 'owner_cannot_be_removed'; end if;

  perform public.reassign_member_data_to(p_target_id, p_actor_id);
  delete from public.org_members where org_id = p_org_id and user_id = p_target_id;
end;
$$;

create or replace function public.accept_org_invite(
  p_invite_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invite_row public.org_invites%rowtype;
  previous_org_id uuid;
  previous_role text;
  previous_member_count integer;
  previous_has_setup boolean;
begin
  select * into invite_row
    from public.org_invites
   where id = p_invite_id
   for update;

  if invite_row.id is null then raise exception 'invite_not_found'; end if;
  if invite_row.status <> 'pending' then raise exception 'invite_not_pending'; end if;
  if invite_row.expires_at is not null and invite_row.expires_at < now() then
    update public.org_invites set status = 'revoked' where id = p_invite_id;
    raise exception 'invite_expired';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(invite_row.org_id::text, 0));

  select org_id, role into previous_org_id, previous_role
    from public.org_members
   where user_id = p_user_id
   for update;

  if previous_org_id = invite_row.org_id then
    update public.org_invites
       set status = 'accepted', accepted_at = now()
     where id = p_invite_id;
    return invite_row.org_id;
  end if;

  if previous_org_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(previous_org_id::text, 0));

    select count(*) into previous_member_count
      from public.org_members
     where org_id = previous_org_id;

    if previous_member_count <> 1 or previous_role <> 'owner' then
      raise exception 'existing_team_workspace';
    end if;

    select
      exists(select 1 from public.user_company where org_id = previous_org_id)
      or exists(select 1 from public.icps where org_id = previous_org_id)
      or exists(select 1 from public.hubspot_connections where org_id = previous_org_id)
      or exists(select 1 from public.nango_connections where org_id = previous_org_id)
      or exists(select 1 from public.org_subscriptions where org_id = previous_org_id)
      into previous_has_setup;

    if previous_has_setup then
      raise exception 'existing_workspace_has_data';
    end if;

    update public.org_members
       set org_id = invite_row.org_id,
           role = invite_row.role,
           joined_at = now()
     where user_id = p_user_id;

    update public.organizations set archived_at = now() where id = previous_org_id;
  else
    insert into public.org_members (org_id, user_id, role, joined_at)
    values (invite_row.org_id, p_user_id, invite_row.role, now());
  end if;

  update public.org_invites
     set status = 'accepted', accepted_at = now()
   where id = p_invite_id;

  return invite_row.org_id;
end;
$$;

revoke all on function public.leave_org_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_org_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.accept_org_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_org_member(uuid, uuid) to service_role;
grant execute on function public.remove_org_member(uuid, uuid, uuid) to service_role;
grant execute on function public.accept_org_invite(uuid, uuid) to service_role;

commit;
