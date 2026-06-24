-- Drift fix: the canonical schema (20260320_arcova_schema.sql) declares
-- raw_uploads.uploaded_at, but the live DB had drifted to created_at. The
-- pending-lead triage workspace (migration 20260624203758 + app/api/triage)
-- references uploaded_at, so the unapplied triage migration's indexes would
-- have failed and the import route 500'd. Add uploaded_at back (additive,
-- non-destructive) and backfill from created_at so queue ordering is preserved.
--
-- Must run before 20260624203758_triage_pending_contact_overrides.sql.
alter table public.raw_uploads
  add column if not exists uploaded_at timestamp with time zone default now();

update public.raw_uploads
set uploaded_at = created_at
where uploaded_at is null and created_at is not null;
