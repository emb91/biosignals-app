-- billing_exempt: internal/complimentary workspaces (e.g. Arcova's own org).
-- Exempt orgs get unlimited seats and contacts, are never blocked by
-- enforcement, and are never asked to pay — resolved in
-- lib/billing/entitlements.ts before any plan/usage lookup.
-- Set per org with a manual UPDATE (admin-only; no UI on purpose).

alter table public.organizations
  add column if not exists billing_exempt boolean not null default false;
