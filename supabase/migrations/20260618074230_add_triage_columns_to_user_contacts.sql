-- Preserve the migration already applied to production as
-- `add_triage_columns_to_user_contacts`.
--
-- These fields store the latest import-triage result on the workspace-owned
-- contact row. The statements are idempotent so a fresh database can safely
-- replay the migration.

alter table public.user_contacts
  add column if not exists triage_group text,
  add column if not exists triage_scored_at timestamptz,
  add column if not exists triage_version text;
