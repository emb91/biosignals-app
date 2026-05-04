import { rescoreAllContactFitForUser } from '@/lib/contact-fit';
import { rescoreAllCompanyFitForUser } from '@/lib/company-fit';

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

  return {
    rescored: Math.max(companyResult.contactsSynced, contactResult.contactsScored),
    failed: companyResult.failed + contactResult.failed,
    skipped: companyResult.skipped + contactResult.skipped,
  };
}
