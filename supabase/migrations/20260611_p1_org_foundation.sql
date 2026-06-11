-- Phase 1: Org / seats foundation.
--
-- Introduces the org layer the multi-tenancy build depends on:
--   organizations  — one row per team (or per solo user)
--   org_members    — seat = (org_id, user_id, role). UNIQUE(user_id) => one org per
--                    user for MVP, which makes user_org_id() deterministic (audit #1).
--   org_invites    — pending invites for already-registered emails (copy-link accept).
--
-- Helper functions (all SECURITY DEFINER with a pinned search_path so RLS policies
-- can call them without recursion — the functions run as owner and bypass RLS):
--   user_org_id()   — the caller's org (NULL if none yet)
--   user_org_role() — the caller's role in their org
--   ensure_user_org(user_id, name) — idempotent solo-org creation (audit #5)
--
-- Backfill: every existing auth.users row gets a solo org (owner). All current users
-- are test accounts, so this is safe.

-- ──────────────────────────────────────────────────────────────────────────
-- Tables
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.org_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_at timestamptz,
  joined_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id),
  UNIQUE (user_id)                       -- one org per user (MVP); makes user_org_id() deterministic
);

CREATE INDEX IF NOT EXISTS org_members_org_idx ON public.org_members (org_id);

CREATE TABLE IF NOT EXISTS public.org_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

CREATE INDEX IF NOT EXISTS org_invites_org_idx   ON public.org_invites (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_idx ON public.org_invites (token);
-- At most one live invite per (org, email).
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_pending_idx
  ON public.org_invites (org_id, lower(email)) WHERE status = 'pending';

-- ──────────────────────────────────────────────────────────────────────────
-- Helper functions
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.user_org_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.org_members WHERE user_id = auth.uid()
$$;

-- Idempotent: returns the user's existing org, or creates a solo org + owner seat.
CREATE OR REPLACE FUNCTION public.ensure_user_org(p_user_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM public.org_members WHERE user_id = p_user_id;
  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  INSERT INTO public.organizations (name)
    VALUES (COALESCE(NULLIF(btrim(p_name), ''), 'My organization'))
    RETURNING id INTO v_org_id;

  INSERT INTO public.org_members (org_id, user_id, role, joined_at)
    VALUES (v_org_id, p_user_id, 'owner', now())
    ON CONFLICT (user_id) DO NOTHING;

  -- Lost a race: another call created the membership. Drop the orphan org and
  -- return the winner's org.
  IF NOT FOUND THEN
    DELETE FROM public.organizations WHERE id = v_org_id;
    SELECT org_id INTO v_org_id FROM public.org_members WHERE user_id = p_user_id;
  END IF;

  RETURN v_org_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites   ENABLE ROW LEVEL SECURITY;

-- organizations: members read their own org; owner/admin can rename/archive.
DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.user_org_id());

DROP POLICY IF EXISTS organizations_update ON public.organizations;
CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'))
  WITH CHECK (id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'));

-- org_members: members read all seats in their org; owner/admin manage seats.
-- (user_org_id()/user_org_role() are SECURITY DEFINER → no RLS recursion.)
DROP POLICY IF EXISTS org_members_select ON public.org_members;
CREATE POLICY org_members_select ON public.org_members
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS org_members_write ON public.org_members;
CREATE POLICY org_members_write ON public.org_members
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'));

-- org_invites: members of the org can see/manage; service role (invite API) bypasses RLS.
DROP POLICY IF EXISTS org_invites_select ON public.org_invites;
CREATE POLICY org_invites_select ON public.org_invites
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS org_invites_write ON public.org_invites;
CREATE POLICY org_invites_write ON public.org_invites
  FOR ALL TO authenticated
  USING (org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'))
  WITH CHECK (org_id = public.user_org_id() AND public.user_org_role() IN ('owner', 'admin'));

-- ──────────────────────────────────────────────────────────────────────────
-- Backfill: solo org per existing user
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      u.id AS user_id,
      COALESCE(
        (SELECT uc.company_name FROM public.user_company uc
          WHERE uc.user_id = u.id AND uc.company_name IS NOT NULL
          ORDER BY uc.updated_at DESC NULLS LAST LIMIT 1),
        split_part(u.email, '@', 1)
      ) AS org_name
    FROM auth.users u
  LOOP
    PERFORM public.ensure_user_org(r.user_id, r.org_name);
  END LOOP;
END $$;
