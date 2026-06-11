-- Phase 1b: lock down ensure_user_org().
--
-- ensure_user_org(p_user_id, p_name) takes an arbitrary user_id and creates an org +
-- owner membership for it. As a SECURITY DEFINER function exposed via PostgREST it was
-- callable by anon/authenticated, letting a signed-in user mint orgs for other user ids.
-- Only the service role (admin client, used by getOrgContext + the invite flow) should
-- call it. RLS does NOT reference this function, so revoking EXECUTE is safe.
--
-- user_org_id() / user_org_role() are intentionally left executable by authenticated:
-- RLS policies call them, and they only ever read the *caller's own* membership
-- (WHERE user_id = auth.uid()), so there is nothing to leak.

REVOKE EXECUTE ON FUNCTION public.ensure_user_org(uuid, text) FROM anon, authenticated;
