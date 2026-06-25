import {
  markAccountSubscriberSourceSweep,
  markContactSubscriberSourceSweep,
  type AccountSweepSubscriber,
  type ContactSweepSubscriber,
} from '@/lib/billing/monitoring';

type SweepStatus = 'succeeded' | 'failed';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function markAccountSubscriberSweeps(params: {
  items: AccountSweepSubscriber[];
  statusForItem: (item: AccountSweepSubscriber) => SweepStatus;
  resultCountForItem?: (item: AccountSweepSubscriber) => number;
  providerCostUsdForItem?: (item: AccountSweepSubscriber) => number;
  onFailure?: (failure: { user_id: string; company_id: string; error: string }) => void;
}): Promise<Set<string>> {
  const unmarked = new Set<string>();
  await Promise.all(params.items.map(async (item) => {
    try {
      await markAccountSubscriberSourceSweep({
        orgId: item.orgId,
        companyId: item.companyId,
        source: item.source,
        cadenceDays: item.cadenceDays,
        status: params.statusForItem(item),
        resultCount: params.resultCountForItem?.(item) ?? 0,
        providerCostUsd: params.providerCostUsdForItem?.(item) ?? 0,
      });
    } catch (error) {
      unmarked.add(item.companyId);
      params.onFailure?.({
        user_id: item.userId,
        company_id: item.companyId,
        error: messageFromUnknown(error),
      });
    }
  }));
  return unmarked;
}

export async function markContactSubscriberSweeps(params: {
  items: ContactSweepSubscriber[];
  statusForItem: (item: ContactSweepSubscriber) => SweepStatus;
  providerCostUsdForItem?: (item: ContactSweepSubscriber) => number;
  onFailure?: (failure: { user_id: string; person_id: string; contact_id: string; error: string }) => void;
}): Promise<Set<string>> {
  const unmarked = new Set<string>();
  await Promise.all(params.items.map(async (item) => {
    try {
      await markContactSubscriberSourceSweep({
        orgId: item.orgId,
        personId: item.personId,
        source: item.source,
        cadenceDays: item.cadenceDays,
        status: params.statusForItem(item),
        providerCostUsd: params.providerCostUsdForItem?.(item) ?? 0,
      });
    } catch (error) {
      unmarked.add(item.personId);
      params.onFailure?.({
        user_id: item.userId,
        person_id: item.personId,
        contact_id: item.contactId,
        error: messageFromUnknown(error),
      });
    }
  }));
  return unmarked;
}
