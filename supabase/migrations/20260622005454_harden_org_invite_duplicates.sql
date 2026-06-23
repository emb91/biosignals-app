-- Prevent duplicate pending invites from old data and make same-org invite
-- acceptance complete a pending membership instead of leaving it pending.

update public.org_invites i
   set status = 'revoked'
  from public.org_members m
  join auth.users u on u.id = m.user_id
 where i.org_id = m.org_id
   and i.status = 'pending'
   and lower(i.email) = lower(u.email);

with ranked as (
  select
    id,
    row_number() over (
      partition by org_id, lower(email)
      order by created_at desc, id desc
    ) as rn
  from public.org_invites
  where status = 'pending'
)
update public.org_invites i
   set status = 'revoked'
  from ranked r
 where i.id = r.id
   and r.rn > 1;

create unique index if not exists org_invites_pending_idx
  on public.org_invites (org_id, lower(email)) where status = 'pending';

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
    update public.org_members
       set role = invite_row.role,
           joined_at = coalesce(joined_at, now())
     where user_id = p_user_id;

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

revoke all on function public.accept_org_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_org_invite(uuid, uuid) to service_role;
