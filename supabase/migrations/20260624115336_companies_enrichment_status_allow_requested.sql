-- Allow 'requested' on companies.enrichment_refresh_status so the company-first
-- import can queue a deep-enrichment pass that a cron drains (mirrors the
-- contacts enrichment-refresh queue). 'requested' = queued, not yet running.
alter table public.companies
  drop constraint if exists companies_enrichment_refresh_status_check;

alter table public.companies
  add constraint companies_enrichment_refresh_status_check
  check (
    enrichment_refresh_status is null
    or enrichment_refresh_status in ('idle', 'running', 'succeeded', 'failed', 'cancelled', 'requested')
  );
