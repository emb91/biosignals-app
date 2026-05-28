-- Phase 7 — Outreach sequences.
--
-- One row per generated + exported sequence. Persisted on user export action
-- (CSV download or clipboard copy) — drafts that never reach export are not
-- saved. Used by:
--   * Contact side panel "Past sequences" section (per-contact history)
--   * /outreach pipeline page (cross-cutting view, future)
--
-- The anchor_* fields tell us which signal the rep chose to lead with —
-- useful for "did I already pitch this contact off the Series B?" checks
-- and for analytics on which signal types convert.

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,

  -- The hook the rep chose to anchor the sequence on.
  anchor_signal_event_id uuid,        -- references signal_source_events.id (nullable: not all hooks come from a signal)
  anchor_signal_type text,            -- denormalised, e.g. 'funding_round', 'phase_transition', 'role_change'
  anchor_hook_text text NOT NULL,     -- the picked hook text as shown to the rep

  -- The 7-message sequence. Stored as jsonb for flexibility:
  -- [{ "day_offset": 0, "subject": "…", "body": "…" }, { "day_offset": 3, … }, …]
  messages jsonb NOT NULL,

  -- Export state.
  exported_at timestamptz NOT NULL DEFAULT now(),
  exported_to text NOT NULL,          -- 'csv' | 'clipboard'

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_sequences_user_contact_idx
  ON outreach_sequences (user_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outreach_sequences_user_created_idx
  ON outreach_sequences (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outreach_sequences_anchor_type_idx
  ON outreach_sequences (user_id, anchor_signal_type, created_at DESC);

ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_sequences_select_own" ON outreach_sequences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "outreach_sequences_insert_own" ON outreach_sequences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "outreach_sequences_update_own" ON outreach_sequences
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "outreach_sequences_delete_own" ON outreach_sequences
  FOR DELETE USING (auth.uid() = user_id);
