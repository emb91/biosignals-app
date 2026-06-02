-- 'job_surge' is the pre-rename signal_key for what the hiring monitor now emits
-- as 'hiring_expansion' (same source_event_type 'ats_jobs_surge', same dimensions
-- new_people + new_needs). A few normalized_signals rows predate the rename and
-- carry the dead key, so readiness scoring treated them as zero (the key isn't in
-- READINESS_SIGNAL_CATALOG_BY_KEY). Remap them to the current key. Idempotent /
-- no-op where none exist.
UPDATE normalized_signals
SET signal_key = 'hiring_expansion', updated_at = now()
WHERE signal_key = 'job_surge';
