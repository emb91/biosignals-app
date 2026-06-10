-- Phase 3 (EXPAND): move ICPs (and their persona + signal-selection siblings) to org scope.
--
-- Expand-and-contract step 1 (audit #3): add org_id, backfill, keep user_id. Existing
-- code that filters by user_id keeps working unchanged; this migration only ADDS the
-- org_id column, an auto-fill trigger, and PERMISSIVE org-scoped RLS policies so that a
-- teammate can read the org's shared ICPs. user_id is dropped later (Phase 7), after the
-- code has switched to org_id and been verified.
--
-- Tables in scope: icps, personas, icp_signal_selections, persona_signal_selections.
-- NOT in scope (stay per-rep): company_icp_scores, contact_persona_scores — scores are
-- per-seat.

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE public.icps                     ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.personas                 ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.icp_signal_selections    ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.persona_signal_selections ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS icps_org_idx                     ON public.icps (org_id);
CREATE INDEX IF NOT EXISTS personas_org_idx                 ON public.personas (org_id);
CREATE INDEX IF NOT EXISTS icp_signal_selections_org_idx    ON public.icp_signal_selections (org_id);
CREATE INDEX IF NOT EXISTS persona_signal_selections_org_idx ON public.persona_signal_selections (org_id);

-- ── 2. Backfill from membership ─────────────────────────────────────────────
UPDATE public.icps i                     SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = i.user_id AND i.org_id IS NULL;
UPDATE public.personas p                 SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = p.user_id AND p.org_id IS NULL;
UPDATE public.icp_signal_selections s    SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = s.user_id AND s.org_id IS NULL;
UPDATE public.persona_signal_selections s SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = s.user_id AND s.org_id IS NULL;

-- ── 3. Auto-fill trigger ───────────────────────────────────────────────────
-- Existing INSERT paths only set user_id. Until the code sets org_id explicitly, fill
-- it from the inserting user's membership so every new row is org-attributed.
CREATE OR REPLACE FUNCTION public.set_org_id_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT org_id INTO NEW.org_id FROM public.org_members WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS icps_set_org_id ON public.icps;
CREATE TRIGGER icps_set_org_id BEFORE INSERT ON public.icps
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_user();

DROP TRIGGER IF EXISTS personas_set_org_id ON public.personas;
CREATE TRIGGER personas_set_org_id BEFORE INSERT ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_user();

DROP TRIGGER IF EXISTS icp_signal_selections_set_org_id ON public.icp_signal_selections;
CREATE TRIGGER icp_signal_selections_set_org_id BEFORE INSERT ON public.icp_signal_selections
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_user();

DROP TRIGGER IF EXISTS persona_signal_selections_set_org_id ON public.persona_signal_selections;
CREATE TRIGGER persona_signal_selections_set_org_id BEFORE INSERT ON public.persona_signal_selections
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_user();

-- ── 4. Permissive org-scoped RLS (added alongside existing user_id policies) ──
-- SELECT: any org member can read the org's shared rows.
-- WRITE:  only owner/admin (role matrix). Members reach these tables read-only; the
--         API also enforces the role, this is the DB backstop.

-- icps
DROP POLICY IF EXISTS icps_org_select ON public.icps;
CREATE POLICY icps_org_select ON public.icps FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS icps_org_insert ON public.icps;
CREATE POLICY icps_org_insert ON public.icps FOR INSERT TO authenticated
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'));
DROP POLICY IF EXISTS icps_org_update ON public.icps;
CREATE POLICY icps_org_update ON public.icps FOR UPDATE TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'));
DROP POLICY IF EXISTS icps_org_delete ON public.icps;
CREATE POLICY icps_org_delete ON public.icps FOR DELETE TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'));

-- personas
DROP POLICY IF EXISTS personas_org_select ON public.personas;
CREATE POLICY personas_org_select ON public.personas FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS personas_org_write ON public.personas;
CREATE POLICY personas_org_write ON public.personas FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'));

-- icp_signal_selections
DROP POLICY IF EXISTS icp_signal_selections_org_select ON public.icp_signal_selections;
CREATE POLICY icp_signal_selections_org_select ON public.icp_signal_selections FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS icp_signal_selections_org_write ON public.icp_signal_selections;
CREATE POLICY icp_signal_selections_org_write ON public.icp_signal_selections FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'));

-- persona_signal_selections
DROP POLICY IF EXISTS persona_signal_selections_org_select ON public.persona_signal_selections;
CREATE POLICY persona_signal_selections_org_select ON public.persona_signal_selections FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());
DROP POLICY IF EXISTS persona_signal_selections_org_write ON public.persona_signal_selections;
CREATE POLICY persona_signal_selections_org_write ON public.persona_signal_selections FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner','admin'));
