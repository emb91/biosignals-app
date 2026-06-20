# Supabase migration conventions

## Current production state

The Arcova workspace-credit rollout and legacy-pricing cleanup are applied to
Supabase project `sbubqrsycbledkxjumjg`.

The current sequence is:

1. `20260618074230_add_triage_columns_to_user_contacts.sql`
2. `20260618204018_arcova_workspace_credits.sql`
3. `20260618204127_arcova_credit_rpc_service_role.sql`
4. `20260618204312_arcova_credit_indexes.sql`
5. `20260618220625_launch_security_hardening.sql`
6. `20260618220746_launch_security_hardening_followup.sql`
7. `20260618224543_arcova_domain_billing_exemption.sql`
8. `20260618225522_remove_legacy_pricing_schema.sql`

The cleanup migration has already run. It removed the retired contact packs,
billable-contact meter, export counter, related functions, and obsolete
subscription allowance columns.

## Rules for new migrations

- Create migrations with `supabase migration new <descriptive_name>` so the
  filename receives a unique 14-digit UTC timestamp:
  `YYYYMMDDHHMMSS_descriptive_name.sql`.
- Never reuse a date-only prefix for multiple new files.
- Do not delete or rewrite an applied migration to change production state.
  Add a new forward migration instead.
- Prefer `supabase db push` for file-backed migrations. It records the local
  file's version in remote migration history.
- Supabase MCP `apply_migration` generates its own remote version; it does not
  preserve a local filename's timestamp. If MCP is used, immediately rename
  the matching local file to the exact version returned by MCP.
- Before migration work is complete, compare local versions with remote
  migration history and resolve every mismatch. Do not execute migration SQL
  again merely to reconcile versions.
- Verify the resulting migration entry, schema objects, RLS, and security
  advisors after applying production DDL.

Older files with date-only prefixes predate this convention and remain as
historical artifacts. Do not rename them casually; their remote versions must
be reconciled first.
