/**
 * Outreach signal context — fetches a contact's (and their company's) recent
 * detected signals for the SEQUENCE GENERATOR.
 *
 * Per the signals briefing: signals choose WHO and WHEN; they are NOT recited in
 * the copy. But the copy agent still needs each signal's SPECIFICS (not just the
 * category label) to silently judge relevance + angle — "Illumina published a
 * genomics-tech method" vs "Illumina registered an NGS patient trial" are the
 * same category but point at different sellers. So we pass category + the actual
 * detail (title/summary). The detail feeds the model's reasoning, never the words.
 *
 * Categories are normalised to a stable taxonomy (new_paper, new_patent,
 * new_hiring, new_funding, trial_registered, lab_buildout, …) rather than raw
 * source_event_type keys.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (t: string) => any };

const LOOKBACK_DAYS = 30;
const MAX_SIGNALS = 12;

// CRM-internal bookkeeping (a deal logged, contact added, deal lost) is the
// seller's OWN pipeline, never a market signal about the prospect. Excluded.
const CRM_INTERNAL_EVENT_TYPES = new Set<string>([
  'open_opportunity_in_crm',
  'new_contact_added_in_crm',
  'closed_lost_in_crm',
  'lapsed_customer',
  'terminated_deal',
]);

export type ContactSignal = {
  /** Normalised taxonomy category, e.g. new_paper, new_patent, new_hiring. */
  category: string;
  /** What the signal actually is — the cleaned title (the detail that matters). */
  detail: string;
  /** Optional longer summary, when present. */
  summary: string | null;
  /** True for signals about the person; false for company-level. */
  isContactLevel: boolean;
  /** ISO event date. */
  date: string | null;
};

/** Map a raw source_event_type to the stable taxonomy. Pattern-based so it's
 *  robust to the many variant keys (publication, pubmed_publication, …). */
export function toSignalCategory(rawType: string | null): string {
  const s = (rawType ?? '').toLowerCase();
  if (!s) return 'other';
  if (s.includes('pub') || s.includes('paper') || s.includes('preprint')) return 'new_paper';
  if (s.includes('patent')) return 'new_patent';
  if (s.includes('hir') || s.includes('job') || s.includes('role') || s.includes('headcount')) return 'new_hiring';
  if (s.includes('fund') || s.includes('raise') || s.includes('series') || s.includes('financ') || s.includes('grant'))
    return 'new_funding';
  if (s.includes('trial') || s.includes('study')) return 'trial_registered';
  if (s.includes('lab') || s.includes('site') || s.includes('buildout') || s.includes('facility') || s.includes('manufactur') || s.includes('expansion'))
    return 'lab_buildout';
  if (s.includes('approval') || s.includes('clearance') || s.includes('fda') || s.includes('regulat')) return 'regulatory_milestone';
  if (s.includes('deal') || s.includes('partnership') || s.includes('collaborat') || s.includes('license')) return 'new_deal';
  return s.replace(/_/g, ' ').trim();
}

type SignalRow = {
  id: string;
  source_event_type: string | null;
  title: string | null;
  summary: string | null;
  event_at: string | null;
  entity_company_id: string | null;
  entity_contact_id: string | null;
};

function cleanDetail(title: string | null): string {
  if (!title) return '';
  let t = title.trim();
  const detected = t.match(/^([a-z0-9_]+)\s+detected\s+(?:at|from)\b/i);
  if (detected) return '';
  t = t.replace(/&#x[0-9a-f]+;/gi, '').replace(/&[a-z]+;/gi, '').replace(/\.+$/, '').trim();
  return t.length > 180 ? t.slice(0, 179).trimEnd() + '…' : t;
}

/**
 * Fetch the contact's + company's recent signals as normalised context for the
 * generator. Deduped by (category, scope), contact-level first, newest first.
 * Best-effort: returns [] on any error (generation still runs, sans signals).
 */
export async function fetchContactSignals(
  supabase: SupabaseLike,
  userId: string,
  contactId: string,
  companyId: string | null,
): Promise<ContactSignal[]> {
  try {
    const cutoffIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const filterExpr = companyId
      ? `entity_contact_id.eq.${contactId},entity_company_id.eq.${companyId}`
      : `entity_contact_id.eq.${contactId}`;

    const { data, error } = await supabase
      .from('signal_source_events')
      .select('id, source_event_type, title, summary, event_at, entity_company_id, entity_contact_id')
      .eq('user_id', userId)
      .or(filterExpr)
      .gte('event_at', cutoffIso)
      .order('event_at', { ascending: false })
      .limit(40);
    if (error || !data) return [];

    const rows = data as SignalRow[];
    // Dedupe by category + scope; keep contact-scope, then most recent.
    const best = new Map<string, ContactSignal>();
    for (const s of rows) {
      if (!s.source_event_type || !s.title) continue;
      if (CRM_INTERNAL_EVENT_TYPES.has(s.source_event_type)) continue;
      const isContactLevel = s.entity_contact_id === contactId;
      const category = toSignalCategory(s.source_event_type);
      const detail = cleanDetail(s.title);
      if (!detail) continue;
      const key = `${category}|${isContactLevel ? 'c' : 'co'}`;
      const existing = best.get(key);
      const time = s.event_at ? Date.parse(s.event_at) : 0;
      if (!existing) {
        best.set(key, { category, detail, summary: s.summary, isContactLevel, date: s.event_at });
        continue;
      }
      const existingTime = existing.date ? Date.parse(existing.date) : 0;
      if (time > existingTime) {
        best.set(key, { category, detail, summary: s.summary, isContactLevel, date: s.event_at });
      }
    }

    return [...best.values()]
      .sort((a, b) => {
        if (a.isContactLevel !== b.isContactLevel) return a.isContactLevel ? -1 : 1;
        return (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0);
      })
      .slice(0, MAX_SIGNALS);
  } catch {
    return [];
  }
}

/** Render the signals as a prompt fragment for the model's silent reasoning. */
export function renderSignalContext(signals: ContactSignal[]): string {
  if (!signals.length) return '(no recent signals on file — write to the persona and the seller offer.)';
  return signals
    .map((s) => {
      const scope = s.isContactLevel ? 'about the contact' : 'about their company';
      const summary = s.summary ? ` — ${s.summary.slice(0, 200)}` : '';
      return `- [${s.category}, ${scope}] ${s.detail}${summary}`;
    })
    .join('\n');
}
