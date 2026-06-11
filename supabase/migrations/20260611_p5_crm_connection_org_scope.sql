-- Phase 5 (expand): CRM connection → org scope (one HubSpot/Nango per org).
--
-- Additive + behavior-preserving: add org_id, backfill from membership, and a permissive
-- org-scoped SELECT policy so token resolution can find the ORG's connection (a member
-- uses the connection the owner set up). Existing per-user policies + writes are untouched,
-- so an owner's current sync keeps working unchanged.
--
-- Safe to add a one-per-org unique constraint now: hubspot_connections is empty (legacy;
-- CRM flows through nango_connections) and no org currently has >1 connection.
--
-- NOT done here (sensitive, needs a live HubSpot test): repointing the direct
-- nango_connections reads in the sync/pull/push/cron/webhook routes from user_id to
-- org_id. Those still resolve per-user; the two token-resolution helpers
-- (getValidAccessToken, getHubSpotTokenForUser) are made org-aware in code.

ALTER TABLE public.hubspot_connections ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.nango_connections   ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.hubspot_connections c SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = c.user_id AND c.org_id IS NULL;
UPDATE public.nango_connections   c SET org_id = m.org_id FROM public.org_members m WHERE m.user_id = c.user_id AND c.org_id IS NULL;

-- One CRM connection per org (safe: no conflicts today).
CREATE UNIQUE INDEX IF NOT EXISTS hubspot_connections_org_idx ON public.hubspot_connections (org_id) WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nango_connections_org_integration_idx ON public.nango_connections (org_id, integration_id) WHERE org_id IS NOT NULL;

-- Permissive org-scoped read so a member can resolve the org's connection/token.
DROP POLICY IF EXISTS hubspot_connections_org_select ON public.hubspot_connections;
CREATE POLICY hubspot_connections_org_select ON public.hubspot_connections
  FOR SELECT TO authenticated USING (org_id = public.user_org_id());

DROP POLICY IF EXISTS nango_connections_org_select ON public.nango_connections;
CREATE POLICY nango_connections_org_select ON public.nango_connections
  FOR SELECT TO authenticated USING (org_id = public.user_org_id());
