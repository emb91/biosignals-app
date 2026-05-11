import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';

/**
 * Latest saved seller profile from the API (same shape as `user_company` row, normalized).
 */
export async function fetchLatestUserCompanyRow(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch('/api/user-company');
    if (!res.ok) return null;
    const body = (await res.json()) as { analyses?: Record<string, unknown>[] };
    const row = body.analyses?.[0];
    if (!row) return null;
    return normalizePlatformTaxonomyFields(row);
  } catch {
    return null;
  }
}
