-- Per-user outreach preferences that shape generation (distinct from
-- user_outreach_credentials, which holds the provider API keys).
--
-- Currently: tone-of-voice guidance + worked examples that get injected into
-- the hook + sequence generation prompts so a customer's outreach sounds like
-- THEM, not a generic Sonnet default. One row per user.

CREATE TABLE IF NOT EXISTS user_outreach_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-text guidance: "warm but direct, no jargon, short sentences, sign off
  -- as just my first name", etc. Injected verbatim into the generation prompt.
  tone_guidance text,
  -- Worked examples of messages the user likes — the model mirrors their
  -- cadence/phrasing. Stored as an array of full message strings.
  tone_examples text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS user_outreach_settings_user_idx
  ON user_outreach_settings (user_id);

ALTER TABLE user_outreach_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_outreach_settings_select_own" ON user_outreach_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_outreach_settings_insert_own" ON user_outreach_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_outreach_settings_update_own" ON user_outreach_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_outreach_settings_delete_own" ON user_outreach_settings
  FOR DELETE USING (auth.uid() = user_id);
