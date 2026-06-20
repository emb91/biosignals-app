-- Legacy development/test workspaces could be left active after their final
-- membership disappeared. They are inaccessible and make ownership health
-- checks noisy, so archive only truly empty, unowned workspaces.
update public.organizations o
   set archived_at = now()
 where o.archived_at is null
   and not exists (
     select 1 from public.org_members m where m.org_id = o.id
   )
   and not exists (
     select 1 from public.user_company c where c.org_id = o.id
   )
   and not exists (
     select 1 from public.icps i where i.org_id = o.id
   )
   and not exists (
     select 1 from public.org_subscriptions s where s.org_id = o.id
   )
   and not exists (
     select 1 from public.org_credit_transactions t where t.org_id = o.id
   );
