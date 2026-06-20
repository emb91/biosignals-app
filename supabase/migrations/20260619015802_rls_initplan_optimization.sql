-- Performance: stop RLS policies re-evaluating auth.uid() once per row.
--
-- Supabase advisor `auth_rls_initplan` flags 92 public policies that call
-- auth.uid() unwrapped, so Postgres re-runs it for every row. Wrapping it as
-- (select auth.uid()) makes the planner hoist it to a one-time InitPlan. This is
-- the Supabase-recommended fix and is SEMANTICS-PRESERVING: the subselect returns
-- the same scalar, only evaluated once.
--
-- We use ALTER POLICY (not DROP/CREATE) so each policy keeps its exact command,
-- roles, and permissive/restrictive flag — only the expression text changes.
--
-- The rewrite is idempotent: we first normalise any already-wrapped call back to
-- auth.uid(), then wrap all occurrences, so re-running yields the same result and
-- never double-wraps.
DO $$
DECLARE
  r record;
  v_using text;
  v_check text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ~ 'auth\.uid\(\)' OR with_check ~ 'auth\.uid\(\)')
  LOOP
    v_using := CASE WHEN r.qual IS NOT NULL THEN
      regexp_replace(
        regexp_replace(r.qual, '\(\s*select\s+auth\.uid\(\)\s*\)', 'auth.uid()', 'g'),
        'auth\.uid\(\)', '(select auth.uid())', 'g')
    END;
    v_check := CASE WHEN r.with_check IS NOT NULL THEN
      regexp_replace(
        regexp_replace(r.with_check, '\(\s*select\s+auth\.uid\(\)\s*\)', 'auth.uid()', 'g'),
        'auth\.uid\(\)', '(select auth.uid())', 'g')
    END;

    EXECUTE format(
      'ALTER POLICY %I ON %I.%I%s%s',
      r.policyname, r.schemaname, r.tablename,
      CASE WHEN v_using IS NOT NULL THEN ' USING (' || v_using || ')' ELSE '' END,
      CASE WHEN v_check IS NOT NULL THEN ' WITH CHECK (' || v_check || ')' ELSE '' END
    );
  END LOOP;
END $$;
