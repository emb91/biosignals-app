-- Phase 2: self-profile storage (My details).
--
-- Every seat gets a self-profile: a per-user row pointing at a canonical `people` row
-- (the same shared identity table prospects live in — so Arcova "owns" the data once,
-- and a paying user's own details become part of the living people DB). The canonical
-- identity/enrichment lives in `people`; `user_profiles` holds the link + the user's
-- own overrides.
--
-- `edited_fields` records which fields the user manually set, so a later re-enrichment
-- never clobbers a value the user declared as truth (sticky-identity pattern, mirrors
-- lib/company-merge.ts). person_id is nullable until enrichment resolves a LinkedIn URL
-- / creates the canonical row (deferred to Phase 6).

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id       uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  person_id    uuid REFERENCES public.people(id) ON DELETE SET NULL,
  email        text,
  full_name    text,
  role_title   text,
  linkedin_url text,
  -- which fields the user overrode by hand; re-enrichment must not clobber these
  edited_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  enriched_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_org_idx ON public.user_profiles (org_id);
CREATE INDEX IF NOT EXISTS user_profiles_person_idx ON public.user_profiles (person_id) WHERE person_id IS NOT NULL;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Team members can see each other's basic profile (team product); only you edit yours.
DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO authenticated
  USING (org_id = public.user_org_id() OR user_id = auth.uid());

DROP POLICY IF EXISTS user_profiles_write ON public.user_profiles;
CREATE POLICY user_profiles_write ON public.user_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
