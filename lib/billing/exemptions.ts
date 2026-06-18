import { createAdminClient } from '@/lib/supabase-admin';
import type { OrgRole } from '@/lib/org-context';

export const ARCOVA_INTERNAL_EMAIL_DOMAIN = 'arcova.bio';

export function isArcovaInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  return separator > 0 && normalized.slice(separator + 1) === ARCOVA_INTERNAL_EMAIL_DOMAIN;
}

export async function isOrgBillingExempt(orgId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('organizations')
    .select('billing_exempt')
    .eq('id', orgId)
    .maybeSingle<{ billing_exempt: boolean }>();
  if (error) {
    throw new Error(`Unable to determine workspace billing exemption: ${error.message}`);
  }
  return Boolean(data?.billing_exempt);
}

/**
 * Arcova-owned workspaces are complimentary. Only an Arcova-domain owner
 * activates the exemption: inviting an Arcova employee into a customer
 * workspace must not make that customer's workspace free.
 */
export async function ensureArcovaOwnerWorkspaceExempt(params: {
  orgId: string;
  email: string | null | undefined;
  role: OrgRole;
}): Promise<void> {
  if (params.role !== 'owner' || !isArcovaInternalEmail(params.email)) return;

  const { error } = await createAdminClient()
    .from('organizations')
    .update({ billing_exempt: true })
    .eq('id', params.orgId)
    .eq('billing_exempt', false);
  if (error) {
    console.error('[billing] failed to mark Arcova workspace complimentary:', error);
  }
}
