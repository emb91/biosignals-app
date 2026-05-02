/**
 * Lead rescoring.
 *
 * Company fit and contact fit now run as adjacent layers:
 * - company-vs-ICP scoring writes the account fit mirror onto contacts.fit_score
 * - contact-vs-persona scoring writes a separate contact_fit_score summary
 * - priority score is recomputed after both layers: company_fit × (0.5 + 0.5 × contact_fit) × intent
 */

import { rescoreAllContactFitForUser } from '@/lib/contact-fit';
import { rescoreAllCompanyFitForUser } from '@/lib/company-fit';
import { createAdminClient } from '@/lib/supabase-admin';

export type RescoreResult = {
  rescored: number;
  failed: number;
  skipped: number;
};

type ContactScoreSnapshot = {
  id: string;
  fit_score: number | null;
  contact_fit_score: number | null;
  intent_score: number | null;
};

function computePriority(snapshot: ContactScoreSnapshot): number {
  const companyFit = snapshot.fit_score ?? 0;
  const contactFit = snapshot.contact_fit_score ?? 0;
  const intent = snapshot.intent_score ?? 1;
  return Math.round(companyFit * (0.5 + 0.5 * contactFit) * intent * 1000) / 1000;
}

export async function recalculatePriorityScoresForUser(userId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('id, fit_score, contact_fit_score, intent_score')
    .eq('user_id', userId);

  if (error) throw error;

  const rows = (data || []) as ContactScoreSnapshot[];
  const now = new Date().toISOString();

  await Promise.all(
    rows.map((row) =>
      supabase
        .from('contacts')
        .update({ priority_score: computePriority(row), updated_at: now })
        .eq('id', row.id)
        .eq('user_id', userId),
    ),
  );
}

export async function rescoreAllContactsForUser(userId: string): Promise<RescoreResult> {
  const [companyResult, contactResult] = await Promise.all([
    rescoreAllCompanyFitForUser(userId),
    rescoreAllContactFitForUser(userId),
  ]);

  await recalculatePriorityScoresForUser(userId);

  return {
    rescored: Math.max(companyResult.contactsSynced, contactResult.contactsScored),
    failed: companyResult.failed + contactResult.failed,
    skipped: companyResult.skipped + contactResult.skipped,
  };
}
