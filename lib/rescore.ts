/**
 * Lead rescoring.
 *
 * The lead list currently ranks on contacts.fit_score, but fit is now driven
 * primarily by company-level ICP scoring. This module keeps the public
 * rescore API stable while delegating the actual work to deterministic
 * company-vs-ICP scoring and syncing the winning company score back onto all
 * linked contacts.
 */

import { rescoreAllCompanyFitForUser } from '@/lib/company-fit';

export type RescoreResult = {
  rescored: number;
  failed: number;
  skipped: number;
};

export async function rescoreAllContactsForUser(userId: string): Promise<RescoreResult> {
  const result = await rescoreAllCompanyFitForUser(userId);

  return {
    rescored: result.contactsSynced,
    failed: result.failed,
    skipped: result.skipped,
  };
}
