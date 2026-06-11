-- Phase 3c: ICP visibility — company-wide ("org") vs private ("personal").
--
-- Decision (2026-06-11): owner/admin create company-wide ICPs the whole org sees.
-- Members create PERSONAL ICPs visible only to their creator. Members may delete their
-- own ICPs but not company ones; owner/admin delete company ICPs.
--
-- Implemented as a `scope` column on the single `icps` table (not a separate user_icps
-- table): RLS makes an `org_id`-filtered query return org ICPs + the caller's own
-- personal ICPs, so each rep scores against the company ICPs plus their own, with no
-- duplicate table or scoring rewrite.
--
-- Visibility (SELECT):  (scope='org' AND same org)  OR  (own row, any scope)
-- Create   (INSERT):    own row + same org, and scope='org' requires owner/admin
-- Edit     (UPDATE):    own row (any scope)  OR  owner/admin on an org ICP
-- Delete   (DELETE):    own row (any scope)  OR  owner/admin on an org ICP

ALTER TABLE public.icps
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'org'
  CHECK (scope IN ('org', 'personal'));

-- Existing ICPs were all created by owners → company-wide. The DEFAULT already set them
-- to 'org'; this is just explicit/idempotent.
UPDATE public.icps SET scope = 'org' WHERE scope IS NULL;

CREATE INDEX IF NOT EXISTS icps_scope_idx ON public.icps (org_id, scope);

-- ── SELECT ──────────────────────────────────────────────────────────────────
-- Replace the broad org-select with a scope-aware one. Keep "Users can view own icps"
-- (own row, any scope) so a member always sees their personal ICPs.
DROP POLICY IF EXISTS icps_org_select ON public.icps;
CREATE POLICY icps_org_select ON public.icps FOR SELECT TO authenticated
  USING (
    (scope = 'org' AND org_id = public.user_org_id())
    OR user_id = auth.uid()
  );

-- ── INSERT ──────────────────────────────────────────────────────────────────
-- One policy: you may only insert your own row in your org; making it company-wide
-- (scope='org') requires owner/admin. Members can only insert scope='personal'.
DROP POLICY IF EXISTS "Users can insert own icps" ON public.icps;
DROP POLICY IF EXISTS icps_org_insert ON public.icps;
CREATE POLICY icps_insert ON public.icps FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = public.user_org_id()
    AND (
      scope = 'personal'
      OR (scope = 'org' AND public.user_org_role() IN ('owner', 'admin'))
    )
  );

-- ── UPDATE ──────────────────────────────────────────────────────────────────
-- Keep "Users can update own icps" (own row). Tighten the org-update to company ICPs so
-- admins can't edit a member's personal ICP.
DROP POLICY IF EXISTS icps_org_update ON public.icps;
CREATE POLICY icps_org_update ON public.icps FOR UPDATE TO authenticated
  USING (scope = 'org' AND org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'))
  WITH CHECK (scope = 'org' AND org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'));

-- ── DELETE ──────────────────────────────────────────────────────────────────
-- Members delete their own (personal) ICPs; owner/admin delete company ICPs.
DROP POLICY IF EXISTS icps_org_delete ON public.icps;
CREATE POLICY icps_delete_own ON public.icps FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY icps_delete_org ON public.icps FOR DELETE TO authenticated
  USING (scope = 'org' AND org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'));
