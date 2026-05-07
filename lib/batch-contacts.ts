export const BATCH_CONTACTS_KEY = 'arcova_batch_contacts_companies';

export interface BatchCompany {
  id: string;
  name: string;
  icpId?: string | null;
}
