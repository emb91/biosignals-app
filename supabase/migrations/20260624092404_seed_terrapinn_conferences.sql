-- Seed two Terrapinn-platform US life-science shows so the (already-built)
-- terrapinn exhibitor adapter has rows to poll. Idempotent on slug.
--
-- Applied via Supabase MCP apply_migration (remote version 20260624092404);
-- this local file is the matching forward migration. Dates/venues verified live
-- from the event landing pages 2026-06-24 (Festival of Biologics USA moved to
-- Boston for 2027). social_tags left empty for now — Terrapinn show hashtags are
-- low-confidence; revisit nearer each event before enabling the LinkedIn sweep.
insert into conferences (
  name, slug, platform, event_url, exhibitor_source_url,
  start_date, end_date, venue, country,
  relevance_tags, access_status, tos_status, social_tags
)
select v.* from (values
  (
    'Festival of Biologics USA 2027', 'festival-of-biologics-usa-2027', 'terrapinn',
    'https://www.terrapinn.com/conference/festival-of-biologics-usa/',
    'https://www.terrapinn.com/conference/festival-of-biologics-usa/sponsors-and-exhibitors.stm',
    date '2027-04-13', date '2027-04-14', 'Boston, MA', 'US',
    array['biologics','antibodies','bioprocessing']::text[], 'clean', 'unreviewed', array[]::text[]
  ),
  (
    'World Vaccine Congress Washington 2027', 'world-vaccine-congress-washington-2027', 'terrapinn',
    'https://www.terrapinn.com/conference/world-vaccine-congress-washington/',
    'https://www.terrapinn.com/conference/world-vaccine-congress-washington/sponsors-and-exhibitors.stm',
    date '2027-03-08', date '2027-03-11', 'Washington, DC', 'US',
    array['vaccines','immunology','infectious-disease']::text[], 'clean', 'unreviewed', array[]::text[]
  )
) as v(
  name, slug, platform, event_url, exhibitor_source_url,
  start_date, end_date, venue, country,
  relevance_tags, access_status, tos_status, social_tags
)
where not exists (select 1 from conferences c where c.slug = v.slug);
