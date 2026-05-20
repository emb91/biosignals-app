-- Per-company list of known legal-entity names, subsidiaries, and common
-- variations. Populated by lib/signals/company-aliases.ts (LLM-driven on
-- company creation; manual edits allowed via UI later).
--
-- Used by signal monitors (patents, FDA, clinical trials) to OR-search across
-- all known names, so e.g. a company saved as "Moderna" still matches FDA
-- records sponsored by "ModernaTx, Inc.".
alter table companies
  add column if not exists aliases text[] not null default '{}',
  add column if not exists aliases_updated_at timestamptz;

-- GIN index for fast "is any alias a match" queries.
create index if not exists companies_aliases_gin on companies using gin (aliases);
