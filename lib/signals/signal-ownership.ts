import type { SupabaseClient } from '@supabase/supabase-js';
import { userHasActiveCompany } from '../org-company-state';

type DatabaseClient = SupabaseClient<any, 'public', any>;

export type SignalOwnershipCheck = {
  ok: boolean;
  reason: string;
};

export async function assertUserOwnsSignalEntity(
  supabase: DatabaseClient,
  input: {
    userId: string;
    companyId?: string | null;
    contactId?: string | null;
    requireContactCompanyMatch?: boolean;
  },
): Promise<SignalOwnershipCheck> {
  if (input.companyId) {
    const hasCompany = await userHasActiveCompany(supabase, input.userId, input.companyId);
    if (!hasCompany) {
      return { ok: false, reason: 'company is not an active tracked company for this user' };
    }
  }

  if (input.contactId) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('user_id', input.userId)
      .eq('id', input.contactId)
      .is('archived_at', null)
      .maybeSingle();
    if (error || !data) {
      return { ok: false, reason: 'contact is not an active contact for this user' };
    }
    if (
      input.requireContactCompanyMatch &&
      input.companyId &&
      data.company_id !== input.companyId
    ) {
      return { ok: false, reason: 'contact is not associated with the target company' };
    }
  }

  return { ok: true, reason: 'user owns active signal entity' };
}
