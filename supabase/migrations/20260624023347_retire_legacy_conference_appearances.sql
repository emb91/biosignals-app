-- Retire the older, unwired conference-appearances model (empty, no runtime
-- code; superseded by the clean shared-mirror model in
-- 20260624013137_conference_exhibitor_signal.sql). Its richer presenter scope
-- (appearance_type, speaker_name, matched_contact_id) will return as a
-- presenting_at_conference extension of conference_exhibitors_local, built the
-- same pattern. Supersedes 20260521_company_conference_appearances.sql and
-- 20260526_drop_confidence_columns.sql.
drop table if exists company_conference_appearances;
drop table if exists conferences_sync_runs;
