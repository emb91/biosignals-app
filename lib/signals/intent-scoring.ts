import { getSignalById, CONTACT_SIGNALS } from '@/lib/signals/catalog';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const RECENCY_HALF_LIFE_DAYS = 21;

/** 0–1; 1 today, decays with half-life. */
export function recencyMultiplier(detectedAtIso: string): number {
  const t = new Date(detectedAtIso).getTime();
  if (Number.isNaN(t)) return 0.5;

  const days = Math.max(0, (Date.now() - t) / MS_PER_DAY);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

type SelectionWeighted = { signalId: string; weight: number };

type ObservedRow = {
  signal_type: string;
  detected_at: string | null;
};

function selectionWeightMap(rows: SelectionWeighted[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.signalId, r.weight);
  }
  return m;
}

/** Raw intent mass (before normalization). Weighted sum of matching observed events. */
export function accumulateIntentMass(
  selections: SelectionWeighted[],
  events: ObservedRow[],
  allowedScope?: 'company' | 'contact'
): number {
  const selMap = selectionWeightMap(selections);
  let raw = 0;

  for (const ev of events) {
    const sig = ev.signal_type;
    if (!selMap.has(sig)) continue;

    const def = getSignalById(sig);
    if (!def) continue;

    if (allowedScope && def.scope !== allowedScope) continue;

    const base = Math.max(def.baseWeight ?? 1, 0.05);
    const sel = selMap.get(sig) ?? 0;
    const at = ev.detected_at || new Date().toISOString();
    const rc = recencyMultiplier(at);

    raw += base * sel * rc;
  }
  return raw;
}

/** Theoretical ceiling if each selected catalog signal fired at weight 1.0 recency — for scaling. */
function selectionMassCeiling(selections: SelectionWeighted[], scope: 'company' | 'contact'): number {
  let cap = 0;
  for (const { signalId, weight } of selections) {
    const def = getSignalById(signalId);
    if (!def || def.scope !== scope) continue;
    const base = Math.max(def.baseWeight ?? 1, 0.05);
    cap += base * Math.max(weight, 0);
  }
  return cap;
}

/**
 * Normalize raw intent mass to 0–1 for DB compatibility (contacts.intent_score, companies.company_intent_score).
 * Uses adaptive ceiling based on selections; empty selections → null.
 */
export function normalizeIntent(raw: number, ceiling: number): number | null {
  if (ceiling <= 0 || raw <= 0) return null;
  const scaled = raw / ceiling;
  return Math.max(0, Math.min(1, scaled));
}

export function computeCompanyIntent01(
  icpSelections: SelectionWeighted[],
  companyEvents: ObservedRow[]
): number | null {
  const raw = accumulateIntentMass(icpSelections, companyEvents, 'company');
  const cap = selectionMassCeiling(icpSelections, 'company');
  return normalizeIntent(raw, cap || 1);
}

/**
 * Contact intent score — uses all catalog contact signals at their natural baseWeight.
 * All contact signals apply universally; signal strength is an intrinsic property of
 * the signal itself, not of the persona being matched.
 */
export function computePersonIntent01(
  contactEvents: ObservedRow[]
): number | null {
  const catalogSelections: SelectionWeighted[] = CONTACT_SIGNALS.map((s) => ({
    signalId: s.id,
    weight: 1,
  }));
  const raw = accumulateIntentMass(catalogSelections, contactEvents, 'contact');
  const cap = selectionMassCeiling(catalogSelections, 'contact');
  return normalizeIntent(raw, cap || 1);
}
