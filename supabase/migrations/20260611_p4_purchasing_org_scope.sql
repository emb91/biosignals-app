-- Phase 4: purchasing org scope — concurrent-dedup gate + org billing.
--
-- 1. criteria_hash on data_acquisition_jobs + a PARTIAL UNIQUE index over in-flight
--    statuses so two reps in the same org firing the SAME buy concurrently collapse to one
--    job (race-proof at the DB; the app catches the unique violation and attaches). Audit #2.
-- 2. Backfill org_id on jobs + usage events from membership (column added nullable in
--    20260610_org_id_hedge_usage_tables; now populated).
-- 3. org_billing_limits — org-level monthly credit cap (mirrors user_billing_limits).
--    Advisory ceiling enforced by the runner's credit guard; full billing stays a later project.

-- ── 1. criteria_hash + gate index ───────────────────────────────────────────
ALTER TABLE public.data_acquisition_jobs
  ADD COLUMN IF NOT EXISTS criteria_hash text;

-- One in-flight job per (org, criteria). NULLs (legacy rows / no org) are excluded, so
-- they never trip the gate.
CREATE UNIQUE INDEX IF NOT EXISTS data_acquisition_jobs_org_criteria_inflight_idx
  ON public.data_acquisition_jobs (org_id, criteria_hash)
  WHERE org_id IS NOT NULL
    AND criteria_hash IS NOT NULL
    AND status IN ('queued', 'discovering', 'importing', 'enriching');

-- ── 2. Backfill org_id from membership ──────────────────────────────────────
UPDATE public.data_acquisition_jobs j
   SET org_id = m.org_id
  FROM public.org_members m
 WHERE m.user_id = j.user_id AND j.org_id IS NULL;

UPDATE public.data_acquisition_usage_events e
   SET org_id = m.org_id
  FROM public.org_members m
 WHERE m.user_id = e.user_id AND e.org_id IS NULL;

UPDATE public.provider_usage_events e
   SET org_id = m.org_id
  FROM public.org_members m
 WHERE m.user_id = e.user_id AND e.org_id IS NULL;

-- ── 3. org_billing_limits ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_billing_limits (
  org_id              uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  monthly_credit_limit numeric(12,2),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_billing_limits ENABLE ROW LEVEL SECURITY;

-- Members can read their org's limit; writes are service-role only (set via admin/billing).
DROP POLICY IF EXISTS org_billing_limits_select ON public.org_billing_limits;
CREATE POLICY org_billing_limits_select ON public.org_billing_limits
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
