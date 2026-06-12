-- Phase 8b: cooldown / auto-release for outreach claims.
--
-- A 'sent' sequence whose prospect never replies must not hold the org-wide
-- one-active-outreach-per-person claim forever. Claims now expire by AGE, with the hard
-- guarantee preserved: the partial unique index gains `claim_released_at IS NULL`, and a
-- stale claim is RELEASED EXPLICITLY (claim_released_at stamped) by the next dispatch
-- attempt once it's past its window — never silently bypassed. Windows (in
-- lib/org-outreach.ts, shared by the badge, Today exclusion, and the dispatch gate):
--   queued  1 hour   (a send that crashed mid-flight)
--   sent    30 days  (sequence steps span ~21 days)
--   replied 90 days  (the rep owns the conversation)
-- The sequence row itself keeps its real status — history views are unaffected.

ALTER TABLE public.outreach_sequences
  ADD COLUMN IF NOT EXISTS claim_released_at timestamptz;

DROP INDEX IF EXISTS outreach_sequences_org_person_inflight_idx;
CREATE UNIQUE INDEX outreach_sequences_org_person_inflight_idx
  ON public.outreach_sequences (org_id, person_id)
  WHERE org_id IS NOT NULL
    AND person_id IS NOT NULL
    AND dispatch_status IN ('queued', 'sent', 'replied')
    AND claim_released_at IS NULL;
