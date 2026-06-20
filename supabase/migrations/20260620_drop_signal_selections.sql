-- Retire the vestigial per-ICP / per-persona signal SELECTION system.
--
-- Signals are now applied universally via the signal event feed (signal_source_events /
-- normalized_signals). The selection tables and the denormalized `signals` columns were never
-- read by scoring, readiness, priority, or outreach — they were stored + displayed only.
--
-- All code that wrote/read these was removed first (expand→contract), so this drop is safe:
--   - app/api/icps + app/api/contacts no longer persist or hydrate selections
--   - lib/icp-reenrichment no longer regenerates company/persona signals
--   - lib/signals/selections.ts deleted; recommend-signals endpoints deleted

drop table if exists public.icp_signal_selections;
drop table if exists public.persona_signal_selections;

alter table public.icps drop column if exists signals;
alter table public.personas drop column if exists signals;
