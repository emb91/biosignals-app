-- Phase 3b: lock ICP deletion to owner/admin.
--
-- Decision (2026-06-11): members may ADD ICPs (and edit their own) but may NOT delete
-- any ICP. Deletion is owner/admin only.
--
-- The org-scoped delete policy `icps_org_delete` (owner/admin) already exists from
-- 20260611_p3. The original per-user policy "Users can delete own icps"
-- (USING auth.uid() = user_id) still let a member delete ICPs they created — drop it so
-- delete requires owner/admin. INSERT/UPDATE are untouched: the original per-user
-- insert/update policies remain, so a member can still add an ICP and edit their own.

DROP POLICY IF EXISTS "Users can delete own icps" ON public.icps;
