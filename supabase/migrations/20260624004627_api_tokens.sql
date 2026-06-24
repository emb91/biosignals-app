-- Personal Access Tokens for the Arcova MCP server (and any future programmatic API).
-- A token authenticates a single user; every MCP request resolves token -> user_id,
-- then the user's org is resolved fresh (membership can change after mint).
--
-- Auth model: PAT now, OAuth-ready. This table is the "resource server" half — if an
-- OAuth authorization server is layered on later, issued access tokens validate against
-- the same shape (hash lookup + scopes). See memory/project_mcp_server_build.md.

CREATE TABLE IF NOT EXISTS public.api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- org at mint time, for display/audit only. Authorization always re-resolves the
  -- user's current org at request time (do NOT trust this column for scoping).
  org_id       uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- non-secret display fragment, e.g. "arc_mcp_AbCd…" — never the full token
  token_prefix text NOT NULL,
  -- sha256 hex of the full token; the plaintext is shown once and never stored
  token_hash   text NOT NULL UNIQUE,
  -- granted scopes: 'read' (queries), 'write' (icp/target mutations), 'acquire' (paid data jobs)
  scopes       text[] NOT NULL DEFAULT ARRAY['read']::text[],
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON public.api_tokens (user_id);
-- validation lookup path: hash of a live (non-revoked) token
CREATE INDEX IF NOT EXISTS api_tokens_hash_active_idx
  ON public.api_tokens (token_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- Owners manage only their own tokens through the RLS client (the Settings UI).
-- Token *validation* runs through the service-role client and bypasses RLS by design.
DROP POLICY IF EXISTS api_tokens_select_own ON public.api_tokens;
CREATE POLICY api_tokens_select_own ON public.api_tokens
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS api_tokens_insert_own ON public.api_tokens;
CREATE POLICY api_tokens_insert_own ON public.api_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Update is restricted to revocation (setting revoked_at); rotation = revoke + mint new.
DROP POLICY IF EXISTS api_tokens_update_own ON public.api_tokens;
CREATE POLICY api_tokens_update_own ON public.api_tokens
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS api_tokens_delete_own ON public.api_tokens;
CREATE POLICY api_tokens_delete_own ON public.api_tokens
  FOR DELETE USING (auth.uid() = user_id);
