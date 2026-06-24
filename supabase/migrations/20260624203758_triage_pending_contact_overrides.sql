-- Pending-import triage state.
--
-- `triage_group` remains the model-owned baseline. User edits live in
-- `triage_override_group`, scoped to the shared pending raw row, so an org sees
-- one effective triage category: coalesce(triage_override_group, triage_group).

alter table public.raw_uploads
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists triage_override_group text
    check (triage_override_group is null or triage_override_group in ('high', 'medium', 'low')),
  add column if not exists triage_overridden_by uuid references auth.users(id) on delete set null,
  add column if not exists triage_overridden_at timestamptz,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references auth.users(id) on delete set null;

update public.raw_uploads ru
set org_id = om.org_id
from public.org_members om
where ru.user_id = om.user_id
  and ru.org_id is null;

create index if not exists raw_uploads_org_triage_queue_idx
  on public.raw_uploads (
    org_id,
    status,
    coalesce(triage_override_group, triage_group),
    pinned_at desc nulls last,
    triage_scored_at desc nulls last,
    uploaded_at desc nulls last
  )
  where status in ('awaiting_triage', 'awaiting_enrichment');

create index if not exists raw_uploads_triage_user_idx
  on public.raw_uploads (user_id, status, uploaded_at desc)
  where status in ('awaiting_triage', 'awaiting_enrichment');

comment on column public.raw_uploads.triage_override_group is
  'Org-visible user override for pending import triage. Effective triage is override over model triage_group.';
