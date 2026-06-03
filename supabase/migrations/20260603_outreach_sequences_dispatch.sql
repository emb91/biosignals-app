-- Phase 7+ — outreach_sequences gains a dispatch lifecycle.
--
-- The original table assumed sequences only "exited" the app via CSV download
-- or clipboard copy. We now push directly into outreach tools (lemlist first,
-- HeyReach + Smartlead later), so a row needs to track:
--   * which channel it left via
--   * whether it's still queued / sent / replied / failed
--   * the foreign id(s) we got back, so we can deep-link + handle reply webhooks
--   * any failure message
--
-- We keep `exported_to` (legacy) for backfill safety — the API reads from
-- dispatch_channel when present and falls back to exported_to otherwise.

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS dispatch_channel text,                -- 'lemlist' | 'heyreach' | 'smartlead' | 'csv' | 'clipboard'
  ADD COLUMN IF NOT EXISTS dispatch_status  text NOT NULL DEFAULT 'exported',
                                                                 -- 'exported' | 'queued' | 'sent' | 'replied' | 'failed'
  ADD COLUMN IF NOT EXISTS external_ref     jsonb,               -- { lemlist_lead_id, lemlist_campaign_id, … }
  ADD COLUMN IF NOT EXISTS dispatch_error   text,
  ADD COLUMN IF NOT EXISTS last_status_at   timestamptz;

-- Backfill: existing rows had exported_to='csv'|'clipboard' — surface those as
-- dispatch_channel so the /outreach view can show a unified history.
UPDATE outreach_sequences
   SET dispatch_channel = exported_to
 WHERE dispatch_channel IS NULL
   AND exported_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS outreach_sequences_dispatch_channel_idx
  ON outreach_sequences (user_id, dispatch_channel, created_at DESC);
CREATE INDEX IF NOT EXISTS outreach_sequences_dispatch_status_idx
  ON outreach_sequences (user_id, dispatch_status, created_at DESC);
