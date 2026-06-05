import { rescoreAllContactFitForUser } from '@/lib/contact-fit';
import { rescoreAllCompanyFitForUser } from '@/lib/company-fit';
import { createAdminClient } from '@/lib/supabase-admin';

export type RescoreResult = {
  rescored: number;
  failed: number;
  skipped: number;
};

export async function rescoreAllContactsForUser(userId: string): Promise<RescoreResult> {
  const [companyResult, contactResult] = await Promise.all([
    rescoreAllCompanyFitForUser(userId),
    rescoreAllContactFitForUser(userId),
  ]);

  // Fit just changed (e.g. an ICP edit shifted company fit) but readiness wasn't
  // recomputed, so the stored contacts.priority_score mirror is now stale — and
  // the contacts list paginates in SQL on that column. Refresh it from the fresh
  // fit + readiness so page placement matches the live (displayed) priority.
  // Best-effort: a failure here doesn't fail the rescore (the route still
  // recomputes priority live for display).
  try {
    await createAdminClient().rpc('refresh_contact_priority_scores', { p_user_id: userId });
  } catch (err) {
    console.warn('refresh_contact_priority_scores failed after rescore:', err);
  }

  return {
    rescored: Math.max(companyResult.contactsSynced, contactResult.contactsScored),
    failed: companyResult.failed + contactResult.failed,
    skipped: companyResult.skipped + contactResult.skipped,
  };
}
