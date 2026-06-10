/**
 * Stable fingerprint of a data-acquisition request's criteria, used by the org-level
 * concurrent-dedup gate: two reps in the same org firing the SAME buy at the same time
 * collapse to one in-flight job (enforced by a partial unique index on
 * (org_id, criteria_hash) over in-flight statuses).
 *
 * The hash MUST be canonical so near-identical requests produce the same hash:
 * keys sorted, strings lowercased/trimmed, arrays sorted, defaults materialised. Anything
 * that changes WHAT data is bought belongs in the criteria; presentation/metadata does not.
 */
import { createHash } from 'crypto';

export type DataRequestCriteria = {
  requestType: string;
  icpId: string;
  targetCompanyCount?: number | null;
  targetContactCount?: number | null;
  /** Present for contacts_at_company — the specific company being deepened. */
  companyId?: string | null;
};

function norm(v: unknown): unknown {
  if (typeof v === 'string') return v.trim().toLowerCase();
  if (Array.isArray(v)) return v.map(norm).sort();
  if (v && typeof v === 'object') return canonicalize(v as Record<string, unknown>);
  return v ?? null;
}

function canonicalize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = norm(obj[key]);
  }
  return out;
}

/** Deterministic sha256 of the canonicalised criteria. Same inputs → same hash. */
export function computeCriteriaHash(criteria: DataRequestCriteria): string {
  const canonical = canonicalize({
    requestType: criteria.requestType,
    icpId: criteria.icpId,
    targetCompanyCount: criteria.targetCompanyCount ?? null,
    targetContactCount: criteria.targetContactCount ?? null,
    companyId: criteria.companyId ?? null,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
