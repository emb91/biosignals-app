-- Seed one abstractsonline/OASIS PRESENTER (agenda) conference so the live
-- company-first presenter adapter (lib/signals/conference/presenters/abstractsonline-adapter.ts)
-- has an in-window event to poll. Until now NO abstractsonline conference was
-- seeded + in-window, so the adapter emitted nothing in production.
--
-- SNIS 23rd Annual Meeting (Society of NeuroInterventional Surgery), eventId 21550.
-- Verified live 2026-06-24 via the OASIS meeting endpoint
-- (GET oe3/program/meeting/21550): Status "Active", Dates "July 20-24, 2026",
-- Location "Seattle, WA". A Presentation search for "Medtronic" returned Count=49
-- (real dated sessions on Jul 20 2026) — proof the program has data loaded.
--
-- This is an AGENDA/PRESENTER seed: agenda_* fields are set; exhibitor_source_url
-- and event_url are left null. `platform` is a legacy NOT NULL exhibitor column
-- with no default, so it must carry a value; set to 'abstractsonline' (self-
-- consistent with the upstream platform). The exhibitor sync's
-- getConferenceAdapter('abstractsonline') returns no adapter and safely skips this
-- row, while the presenter sync picks it up via agenda_platform.
--
-- Applied via Supabase MCP apply_migration (remote version 20260624104032);
-- this local file is the matching forward migration. Idempotent on slug.
insert into conferences (
  name, slug, platform, agenda_platform, agenda_source_url, platform_params,
  start_date, end_date, venue, country,
  relevance_tags, access_status, tos_status, social_tags
)
select
  'SNIS 23rd Annual Meeting 2026', 'snis-2026', 'abstractsonline', 'abstractsonline',
  'https://www.abstractsonline.com/pp8/#!/21550', '{"eventId": 21550}'::jsonb,
  date '2026-07-20', date '2026-07-24', 'Seattle, WA', 'US',
  array['neurointervention','stroke','neurovascular','interventional-neurology']::text[],
  'clean', 'unreviewed', array[]::text[]
where not exists (select 1 from conferences c where c.slug = 'snis-2026');
