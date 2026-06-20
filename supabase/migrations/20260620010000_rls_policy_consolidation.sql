-- Consolidate overlapping permissive RLS policies and close legacy user_id
-- write paths that bypass org role checks.
--
-- Goals:
--   * one permissive policy per role/action, avoiding Supabase's
--     multiple_permissive_policies warning;
--   * members may manage configuration belonging to their own personal ICPs;
--   * only owners/admins may manage shared org ICP configuration and the org
--     company profile;
--   * service-only HubSpot backup metadata remains inaccessible to clients.

-- ── ICPs ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own icps" ON public.icps;

DROP POLICY IF EXISTS "Users can update own icps" ON public.icps;
DROP POLICY IF EXISTS icps_org_update ON public.icps;
DROP POLICY IF EXISTS icps_update ON public.icps;
CREATE POLICY icps_update ON public.icps
  FOR UPDATE TO authenticated
  USING (
    (scope = 'personal' AND user_id = (SELECT auth.uid()))
    OR (
      scope = 'org'
      AND org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    (scope = 'personal' AND user_id = (SELECT auth.uid()) AND org_id = public.user_org_id())
    OR (
      scope = 'org'
      AND org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS icps_delete_own ON public.icps;
DROP POLICY IF EXISTS icps_delete_org ON public.icps;
DROP POLICY IF EXISTS icps_delete ON public.icps;
CREATE POLICY icps_delete ON public.icps
  FOR DELETE TO authenticated
  USING (
    (scope = 'personal' AND user_id = (SELECT auth.uid()))
    OR (
      scope = 'org'
      AND org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
    )
  );

-- ── Personas / buying groups ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can manage their own contacts" ON public.personas;
DROP POLICY IF EXISTS "Users can only access their own data" ON public.personas;
DROP POLICY IF EXISTS personas_org_select ON public.personas;
CREATE POLICY personas_org_select ON public.personas
  FOR SELECT TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      AND (
        icp_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = personas.icp_id
            AND i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
        )
      )
    )
    OR (
      org_id = public.user_org_id()
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = personas.icp_id
          AND i.scope = 'org'
          AND i.org_id = public.user_org_id()
      )
    )
  );
DROP POLICY IF EXISTS personas_org_write ON public.personas;

DROP POLICY IF EXISTS personas_insert ON public.personas;
CREATE POLICY personas_insert ON public.personas
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND (
      (
        user_id = (SELECT auth.uid())
        AND (
          icp_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.icps i
            WHERE i.id = personas.icp_id
              AND i.scope = 'personal'
              AND i.user_id = (SELECT auth.uid())
              AND i.org_id = public.user_org_id()
          )
        )
      )
      OR (
        public.user_org_role() IN ('owner', 'admin')
        AND EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = personas.icp_id
            AND i.scope = 'org'
            AND i.org_id = public.user_org_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS personas_update ON public.personas;
CREATE POLICY personas_update ON public.personas
  FOR UPDATE TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      AND (
        icp_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = personas.icp_id
            AND i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
        )
      )
    )
    OR (
      org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = personas.icp_id
          AND i.scope = 'org'
          AND i.org_id = public.user_org_id()
      )
    )
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND (
      (
        user_id = (SELECT auth.uid())
        AND (
          icp_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.icps i
            WHERE i.id = personas.icp_id
              AND i.scope = 'personal'
              AND i.user_id = (SELECT auth.uid())
              AND i.org_id = public.user_org_id()
          )
        )
      )
      OR (
        public.user_org_role() IN ('owner', 'admin')
        AND EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = personas.icp_id
            AND i.scope = 'org'
            AND i.org_id = public.user_org_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS personas_delete ON public.personas;
CREATE POLICY personas_delete ON public.personas
  FOR DELETE TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      AND (
        icp_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = personas.icp_id
            AND i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
        )
      )
    )
    OR (
      org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = personas.icp_id
          AND i.scope = 'org'
          AND i.org_id = public.user_org_id()
      )
    )
  );

-- ── ICP signal selections ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can only access their own icp signal selections"
  ON public.icp_signal_selections;
DROP POLICY IF EXISTS icp_signal_selections_org_select
  ON public.icp_signal_selections;
CREATE POLICY icp_signal_selections_org_select
  ON public.icp_signal_selections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.icps i
      WHERE i.id = icp_signal_selections.icp_id
        AND (
          (
            i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
          )
          OR (
            i.scope = 'org'
            AND i.org_id = public.user_org_id()
          )
        )
    )
  );
DROP POLICY IF EXISTS icp_signal_selections_org_write
  ON public.icp_signal_selections;

DROP POLICY IF EXISTS icp_signal_selections_insert ON public.icp_signal_selections;
CREATE POLICY icp_signal_selections_insert ON public.icp_signal_selections
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND (
      (
        user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = icp_signal_selections.icp_id
            AND i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
        )
      )
      OR (
        public.user_org_role() IN ('owner', 'admin')
        AND EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = icp_signal_selections.icp_id
            AND i.scope = 'org'
            AND i.org_id = public.user_org_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS icp_signal_selections_update ON public.icp_signal_selections;
CREATE POLICY icp_signal_selections_update ON public.icp_signal_selections
  FOR UPDATE TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = icp_signal_selections.icp_id
          AND i.scope = 'personal'
          AND i.user_id = (SELECT auth.uid())
          AND i.org_id = public.user_org_id()
      )
    )
    OR (
      org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = icp_signal_selections.icp_id
          AND i.scope = 'org'
          AND i.org_id = public.user_org_id()
      )
    )
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND (
      (
        user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = icp_signal_selections.icp_id
            AND i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
        )
      )
      OR (
        public.user_org_role() IN ('owner', 'admin')
        AND EXISTS (
          SELECT 1
          FROM public.icps i
          WHERE i.id = icp_signal_selections.icp_id
            AND i.scope = 'org'
            AND i.org_id = public.user_org_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS icp_signal_selections_delete ON public.icp_signal_selections;
CREATE POLICY icp_signal_selections_delete ON public.icp_signal_selections
  FOR DELETE TO authenticated
  USING (
    (
      user_id = (SELECT auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = icp_signal_selections.icp_id
          AND i.scope = 'personal'
          AND i.user_id = (SELECT auth.uid())
          AND i.org_id = public.user_org_id()
      )
    )
    OR (
      org_id = public.user_org_id()
      AND public.user_org_role() IN ('owner', 'admin')
      AND EXISTS (
        SELECT 1
        FROM public.icps i
        WHERE i.id = icp_signal_selections.icp_id
          AND i.scope = 'org'
          AND i.org_id = public.user_org_id()
      )
    )
  );

-- ── Persona signal selections ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can only access their own persona signal selections"
  ON public.persona_signal_selections;
DROP POLICY IF EXISTS persona_signal_selections_org_select
  ON public.persona_signal_selections;
CREATE POLICY persona_signal_selections_org_select
  ON public.persona_signal_selections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.personas p
      JOIN public.icps i ON i.id = p.icp_id
      WHERE p.id = persona_signal_selections.persona_id
        AND (
          (
            i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND i.org_id = public.user_org_id()
          )
          OR (
            i.scope = 'org'
            AND i.org_id = public.user_org_id()
          )
        )
    )
  );
DROP POLICY IF EXISTS persona_signal_selections_org_write
  ON public.persona_signal_selections;

DROP POLICY IF EXISTS persona_signal_selections_insert ON public.persona_signal_selections;
CREATE POLICY persona_signal_selections_insert ON public.persona_signal_selections
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.personas p
      JOIN public.icps i ON i.id = p.icp_id
      WHERE p.id = persona_signal_selections.persona_id
        AND (
          (
            i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND persona_signal_selections.user_id = (SELECT auth.uid())
          )
          OR (
            i.scope = 'org'
            AND i.org_id = public.user_org_id()
            AND public.user_org_role() IN ('owner', 'admin')
          )
        )
    )
  );

DROP POLICY IF EXISTS persona_signal_selections_update ON public.persona_signal_selections;
CREATE POLICY persona_signal_selections_update ON public.persona_signal_selections
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.personas p
      JOIN public.icps i ON i.id = p.icp_id
      WHERE p.id = persona_signal_selections.persona_id
        AND (
          (
            i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND persona_signal_selections.user_id = (SELECT auth.uid())
          )
          OR (
            i.scope = 'org'
            AND i.org_id = public.user_org_id()
            AND public.user_org_role() IN ('owner', 'admin')
          )
        )
    )
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.personas p
      JOIN public.icps i ON i.id = p.icp_id
      WHERE p.id = persona_signal_selections.persona_id
        AND (
          (
            i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND persona_signal_selections.user_id = (SELECT auth.uid())
          )
          OR (
            i.scope = 'org'
            AND i.org_id = public.user_org_id()
            AND public.user_org_role() IN ('owner', 'admin')
          )
        )
    )
  );

DROP POLICY IF EXISTS persona_signal_selections_delete ON public.persona_signal_selections;
CREATE POLICY persona_signal_selections_delete ON public.persona_signal_selections
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND EXISTS (
      SELECT 1
      FROM public.personas p
      JOIN public.icps i ON i.id = p.icp_id
      WHERE p.id = persona_signal_selections.persona_id
        AND (
          (
            i.scope = 'personal'
            AND i.user_id = (SELECT auth.uid())
            AND persona_signal_selections.user_id = (SELECT auth.uid())
          )
          OR (
            i.scope = 'org'
            AND i.org_id = public.user_org_id()
            AND public.user_org_role() IN ('owner', 'admin')
          )
        )
    )
  );

-- ── Org company profile ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view own analyses" ON public.user_company;
DROP POLICY IF EXISTS "Users can insert own analyses" ON public.user_company;
DROP POLICY IF EXISTS "Users can update own analyses" ON public.user_company;
DROP POLICY IF EXISTS "Users can delete own analyses" ON public.user_company;
DROP POLICY IF EXISTS user_company_org_write ON public.user_company;

DROP POLICY IF EXISTS user_company_insert ON public.user_company;
CREATE POLICY user_company_insert ON public.user_company
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS user_company_update ON public.user_company;
CREATE POLICY user_company_update ON public.user_company
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS user_company_delete ON public.user_company;
CREATE POLICY user_company_delete ON public.user_company
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );

-- ── Org membership and invitations ─────────────────────────────────────────

DROP POLICY IF EXISTS org_members_write ON public.org_members;
DROP POLICY IF EXISTS org_members_insert ON public.org_members;
CREATE POLICY org_members_insert ON public.org_members
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );
DROP POLICY IF EXISTS org_members_update ON public.org_members;
CREATE POLICY org_members_update ON public.org_members
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );
DROP POLICY IF EXISTS org_members_delete ON public.org_members;
CREATE POLICY org_members_delete ON public.org_members
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS org_invites_write ON public.org_invites;
DROP POLICY IF EXISTS org_invites_insert ON public.org_invites;
CREATE POLICY org_invites_insert ON public.org_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );
DROP POLICY IF EXISTS org_invites_update ON public.org_invites;
CREATE POLICY org_invites_update ON public.org_invites
  FOR UPDATE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  )
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );
DROP POLICY IF EXISTS org_invites_delete ON public.org_invites;
CREATE POLICY org_invites_delete ON public.org_invites
  FOR DELETE TO authenticated
  USING (
    org_id = public.user_org_id()
    AND public.user_org_role() IN ('owner', 'admin')
  );

-- ── User profiles ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS user_profiles_write ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;
CREATE POLICY user_profiles_insert ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
CREATE POLICY user_profiles_update ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_profiles_delete ON public.user_profiles;
CREATE POLICY user_profiles_delete ON public.user_profiles
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── CRM connections ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users manage own HubSpot connection"
  ON public.hubspot_connections;
DROP POLICY IF EXISTS hubspot_connections_insert ON public.hubspot_connections;
CREATE POLICY hubspot_connections_insert ON public.hubspot_connections
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS hubspot_connections_update ON public.hubspot_connections;
CREATE POLICY hubspot_connections_update ON public.hubspot_connections
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS hubspot_connections_delete ON public.hubspot_connections;
CREATE POLICY hubspot_connections_delete ON public.hubspot_connections
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own Nango connections"
  ON public.nango_connections;
DROP POLICY IF EXISTS nango_connections_insert ON public.nango_connections;
CREATE POLICY nango_connections_insert ON public.nango_connections
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS nango_connections_update ON public.nango_connections;
CREATE POLICY nango_connections_update ON public.nango_connections
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS nango_connections_delete ON public.nango_connections;
CREATE POLICY nango_connections_delete ON public.nango_connections
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ── Outreach sequences ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS outreach_sequences_select_own ON public.outreach_sequences;
DROP POLICY IF EXISTS outreach_sequences_org_select ON public.outreach_sequences;
CREATE POLICY outreach_sequences_org_select ON public.outreach_sequences
  FOR SELECT TO authenticated
  USING (
    org_id = public.user_org_id()
    OR user_id = (SELECT auth.uid())
  );

-- ── Service-only HubSpot backup ledger ─────────────────────────────────────

-- The service role bypasses RLS. An explicit deny policy documents the intended
-- client behavior and avoids the rls_enabled_no_policy advisor finding.
DROP POLICY IF EXISTS hubspot_backups_deny_client_access ON public.hubspot_backups;
CREATE POLICY hubspot_backups_deny_client_access ON public.hubspot_backups
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Refuse to commit a partial cleanup. This mirrors the effective-role/action
-- expansion used by the Supabase multiple-permissive-policies advisor.
DO $$
BEGIN
  IF EXISTS (
    WITH expanded AS (
      SELECT
        tablename,
        policyname,
        cmd,
        unnest(
          CASE
            WHEN roles = '{public}'::name[]
              THEN ARRAY['anon', 'authenticated']::name[]
            ELSE roles
          END
        ) AS effective_role
      FROM pg_policies
      WHERE schemaname = 'public'
        AND permissive = 'PERMISSIVE'
    ),
    actions AS (
      SELECT
        tablename,
        policyname,
        effective_role,
        unnest(
          CASE
            WHEN cmd = 'ALL'
              THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
            ELSE ARRAY[cmd]
          END
        ) AS action
      FROM expanded
    )
    SELECT 1
    FROM actions
    GROUP BY tablename, effective_role, action
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'RLS consolidation incomplete: multiple permissive policies remain';
  END IF;
END
$$;
