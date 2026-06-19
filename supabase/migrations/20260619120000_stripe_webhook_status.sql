-- Pre-launch billing hardening: make Stripe webhook processing idempotent under retries.
--
-- The old handler deleted the dedupe row on failure so Stripe would retry, but a
-- partially-succeeded handler could then re-run and double-apply side effects.
-- We add an explicit processing status so a retry can tell "already done" from
-- "failed mid-flight, safe to reprocess" (handlers are idempotent).
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'done'));

-- Backfill: the old code deleted rows on failure, so any surviving row was
-- processed successfully. Mark them done.
UPDATE public.stripe_webhook_events
  SET status = 'done'
  WHERE status = 'processing';
