-- Denormalize priority_score onto the contacts table.
--
-- contact_readiness_snapshots already carries the canonical priority (added in
-- 20260526_readiness_priority_scores.sql) plus dimension breakdowns / top
-- signals — that's the scoring story. But /api/leads paginates DB-side via
-- .range(), and PostgREST can't ORDER the outer list by a foreign table's
-- column. Mirroring priority_score onto contacts lets the endpoint sort &
-- paginate in a single indexed query without an RPC or view.
--
-- Single write path: the readiness cron writes both rows in the same
-- recompute step. The snapshot stays the source of truth; contacts.priority_score
-- is a hot-lookup mirror.

alter table public.contacts
  add column if not exists priority_score numeric(5,4) null;

create index if not exists contacts_user_priority_idx
  on public.contacts (user_id, priority_score desc nulls last, overall_fit_score desc nulls last);

-- Backfill from existing snapshots.
update public.contacts c
  set priority_score = snap.priority_score
  from public.contact_readiness_snapshots snap
  where snap.contact_id = c.id
    and snap.user_id = c.user_id
    and c.priority_score is null
    and snap.priority_score is not null;
