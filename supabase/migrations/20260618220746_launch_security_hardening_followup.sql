-- Follow-up for the remaining database security advisor warnings.

ALTER FUNCTION public.increment_org_export_count(uuid, uuid)
  SET search_path = public, pg_temp;

-- Keep recursive-RLS-safe helpers outside the exposed API schema. Public
-- SECURITY INVOKER wrappers preserve all existing policy expressions while
-- preventing the privileged implementation from being exposed as an RPC.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT org_id
  FROM public.org_members
  WHERE user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION private.user_org_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT role
  FROM public.org_members
  WHERE user_id = auth.uid()
$function$;

REVOKE ALL ON FUNCTION private.user_org_id()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.user_org_role()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.user_org_id()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.user_org_role()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = private, pg_temp
AS $function$
  SELECT private.user_org_id()
$function$;

CREATE OR REPLACE FUNCTION public.user_org_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = private, pg_temp
AS $function$
  SELECT private.user_org_role()
$function$;

REVOKE ALL ON FUNCTION public.user_org_id()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.user_org_role()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_org_id()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_org_role()
  TO authenticated, service_role;

-- Supabase convention is to keep extensions out of the exposed public schema.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- These two functions use pg_trgm's similarity() function.
ALTER FUNCTION public.resolve_company_candidates(text, integer, double precision)
  SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.backfill_candidate_rows(text, text[], text, timestamptz, text, text, text, text, text, text[], double precision, integer)
  SET search_path = public, extensions, pg_temp;
