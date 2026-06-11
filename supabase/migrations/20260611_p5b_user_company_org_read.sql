-- Phase 5b: org-scope the company profile (user_company) so the whole team sees ONE
-- company profile — the org's. The profile is still authored by the owner/admin; members
-- read it (the My Company page hides edit for non-admins, and the write APIs are role-gated).
--
-- Expand step (additive): add org_id, backfill, auto-fill on insert, and permissive
-- org-scoped policies (SELECT for any member; write for owner/admin) alongside the existing
-- per-user policies. user_id stays. Reads switch to org scope in code.

ALTER TABLE public.user_company ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.user_company c SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = c.user_id AND c.org_id IS NULL;

CREATE INDEX IF NOT EXISTS user_company_org_idx ON public.user_company (org_id);

-- Reuse the generic BEFORE-INSERT org-id filler (created in 20260611_p3).
DROP TRIGGER IF EXISTS user_company_set_org_id ON public.user_company;
CREATE TRIGGER user_company_set_org_id BEFORE INSERT ON public.user_company
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id_from_user();

-- Any org member can READ the org's company profile.
DROP POLICY IF EXISTS user_company_org_select ON public.user_company;
CREATE POLICY user_company_org_select ON public.user_company
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

-- Only owner/admin may WRITE the org company profile (the API also enforces this).
DROP POLICY IF EXISTS user_company_org_write ON public.user_company;
CREATE POLICY user_company_org_write ON public.user_company
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'));
