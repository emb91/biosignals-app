-- The original constraint (added in 20260504) only allowed
-- ('idle', 'running', 'succeeded', 'failed').  Two values added since then
-- were not included:
--   'cancelled' — written by applyUserCancellationToLeadEnrichment when the
--                 user clicks "Stop enrichment" in the side panel.
--   'requested' — written by run-job-change-monitor when a contact's company
--                 changes and needs a fresh enrichment pass via the queue cron.
-- Both writes were silently violating the constraint, causing a 500 "Internal
-- server error" on the Stop Enrichment button and silently failing job-change
-- re-enrichment queue insertions.

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_enrichment_refresh_status_check;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_enrichment_refresh_status_check
  CHECK (enrichment_refresh_status IN (
    'idle',
    'requested',
    'running',
    'succeeded',
    'failed',
    'cancelled'
  ));
