-- HubSpot backup ledger.
--
-- Tracks every snapshot of a customer's HubSpot account that Arcova captures before/while it
-- writes into their CRM. The actual data lives in Cloudflare R2 (gzipped NDJSON); this table is
-- the index + source-of-truth for which snapshot is canonical.
--
--   kind = 'baseline'  -> the immutable pre-touch capture (one per scope, WORM-locked in R2)
--   kind = 'rolling'   -> daily snapshots (R2 lifecycle auto-expires the objects after 30 days)
--
-- "scope" is the CRM owner: an org (one HubSpot connection per org) or a solo user.
-- scope_key is `org:<uuid>` or `user:<uuid>`.

create table if not exists public.hubspot_backups (
  id             uuid primary key default gen_random_uuid(),
  scope_key      text not null,
  org_id         uuid,
  user_id        uuid,
  kind           text not null check (kind in ('baseline', 'rolling')),
  status         text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  snapshot_id    uuid not null,
  date_key       date,                 -- rolling: the day captured (for once-per-day idempotency)
  contacts_key   text,                 -- R2 object key for contacts.ndjson.gz
  companies_key  text,                 -- R2 object key for companies.ndjson.gz
  manifest_key   text,                 -- R2 object key for manifest.json
  contacts_count integer,
  companies_count integer,
  bytes          bigint,
  error          text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- Exactly one baseline per scope (pending OR complete). Failed baseline rows are deleted by the
-- app so a retry can re-claim, so they don't occupy the slot.
create unique index if not exists hubspot_backups_one_baseline_per_scope
  on public.hubspot_backups (scope_key)
  where kind = 'baseline';

create index if not exists hubspot_backups_scope_kind_status
  on public.hubspot_backups (scope_key, kind, status);

create index if not exists hubspot_backups_lookup
  on public.hubspot_backups (kind, created_at desc);

-- Service-role only. No client should ever read or write this table directly; RLS on with no
-- policies means only the service-role key (crons/guards) can touch it.
alter table public.hubspot_backups enable row level security;
