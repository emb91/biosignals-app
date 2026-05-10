-- Row-level security for contact_emails (matches contacts ownership via user_id).

alter table public.contact_emails enable row level security;

drop policy if exists "contact_emails_select_own" on public.contact_emails;
drop policy if exists "contact_emails_insert_own" on public.contact_emails;
drop policy if exists "contact_emails_update_own" on public.contact_emails;
drop policy if exists "contact_emails_delete_own" on public.contact_emails;

create policy "contact_emails_select_own"
on public.contact_emails for select
to authenticated
using (user_id = auth.uid());

create policy "contact_emails_insert_own"
on public.contact_emails for insert
to authenticated
with check (user_id = auth.uid());

create policy "contact_emails_update_own"
on public.contact_emails for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "contact_emails_delete_own"
on public.contact_emails for delete
to authenticated
using (user_id = auth.uid());
