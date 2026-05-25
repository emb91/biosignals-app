-- Stored priority_score on the readiness snapshot tables.
--
-- Until now, priority was computed in JS on every /api/accounts and /contacts
-- render (formula: fit × (0.5 + 0.5 × readiness)). That forced a full contact
-- scan + in-memory rollup per request and made global "sort by priority"
-- impossible across paginated pages.
--
-- Priority is a pure function of fit + readiness, both already pipeline-only
-- (never user-edited), so we can compute it at the same moment we write
-- readiness and store it for indexed sort/filter at read time. The existing
-- readiness crons own all the inputs, so no new write path is needed.
--
-- The stored priority is the *raw* fit×readiness value; read-time business
-- rules (e.g. CRM-won/lost deprioritisation) stay in the API layer so they
-- can change without rewriting snapshots.

-- ── Account snapshots ──────────────────────────────────────────────────────
alter table public.account_readiness_snapshots
  add column if not exists priority_score numeric(5,4) null;

create index if not exists account_readiness_snapshots_user_priority_idx
  on public.account_readiness_snapshots (user_id, priority_score desc nulls last, updated_at desc);

-- One-time backfill: priority = fit × (0.5 + 0.5 × readiness) where both exist.
update public.account_readiness_snapshots
  set priority_score = least(
    1.0,
    greatest(0.0, fit_score * (0.5 + 0.5 * overall_score))
  )
  where priority_score is null
    and fit_score is not null
    and overall_score is not null;

-- ── Contact snapshots ──────────────────────────────────────────────────────
-- Contact snapshots didn't carry a fit_score column (accounts did). Add one
-- so contact priority can be computed at write time without joining contacts.
alter table public.contact_readiness_snapshots
  add column if not exists fit_score      numeric(5,4) null,
  add column if not exists priority_score numeric(5,4) null;

create index if not exists contact_readiness_snapshots_user_priority_idx
  on public.contact_readiness_snapshots (user_id, priority_score desc nulls last, updated_at desc);

-- Backfill fit_score from contacts.contact_fit_score (source of truth).
update public.contact_readiness_snapshots snap
  set fit_score = c.contact_fit_score
  from public.contacts c
  where c.id = snap.contact_id
    and snap.fit_score is null
    and c.contact_fit_score is not null;

-- Then derive priority where both inputs are present.
update public.contact_readiness_snapshots
  set priority_score = least(
    1.0,
    greatest(0.0, fit_score * (0.5 + 0.5 * overall_score))
  )
  where priority_score is null
    and fit_score is not null
    and overall_score is not null;
