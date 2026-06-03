-- User-scoped credentials for outreach tools (lemlist, heyreach, smartlead, …).
--
-- Distinct from `nango_connections` because these tools are API-key auth (not
-- OAuth) — Nango is overkill for static keys, and each customer brings their
-- own account. The app never holds a master key; we just store the per-user
-- key encrypted-at-rest via Supabase's underlying disk encryption + RLS.

CREATE TABLE IF NOT EXISTS user_outreach_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,                 -- 'lemlist' | 'heyreach' | 'smartlead' | …
  api_key text NOT NULL,
  account_label text,                     -- denormalised display name from provider (e.g. team name)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS user_outreach_credentials_user_idx
  ON user_outreach_credentials (user_id);

ALTER TABLE user_outreach_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_outreach_credentials_select_own" ON user_outreach_credentials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_outreach_credentials_insert_own" ON user_outreach_credentials
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_outreach_credentials_update_own" ON user_outreach_credentials
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_outreach_credentials_delete_own" ON user_outreach_credentials
  FOR DELETE USING (auth.uid() = user_id);
