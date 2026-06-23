-- Prevent browser/PostgREST clients from bypassing the org membership APIs.
-- Ownership changes must go through the service-role transfer_org_ownership RPC.

DROP POLICY IF EXISTS org_members_update ON public.org_members;
CREATE POLICY org_members_update ON public.org_members
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
    AND role <> 'owner'
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
    AND role IN ('admin', 'member')
  );

DROP POLICY IF EXISTS org_members_delete ON public.org_members;
CREATE POLICY org_members_delete ON public.org_members
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() = 'owner'
    AND role <> 'owner'
  );
