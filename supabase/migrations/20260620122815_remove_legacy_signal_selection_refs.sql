begin;

-- The per-ICP/persona signal-selection tables were retired once every signal
-- became eligible for every account/contact. Keep workspace departure atomic
-- without referencing those dropped tables.
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

  update public.personas set user_id = p_to where user_id = p_from;
  update public.icps set user_id = p_to where user_id = p_from;

  delete from public.contact_readiness_snapshots where user_id = p_from;
  delete from public.account_readiness_snapshots where user_id = p_from;
  delete from public.contact_attribution_snapshots where user_id = p_from;
end;
$$;

revoke all on function public.reassign_member_data_to(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reassign_member_data_to(uuid, uuid) to service_role;

commit;
