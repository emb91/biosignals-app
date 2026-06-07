/**
 * GET /api/signals/activity
 *
 * Board-wide, per-user log of actual signal EVENTS (not run diagnostics) for
 * the /log "Signal activity" section. Each row is a plain sentence —
 * "Illumina filed a new patent", "Chong Ma started a new role at Moderna".
 *
 * Window: last N days (default 30) by observed_at — i.e. when the signal was
 * pulled into the system, matching "logged as we pull them in". Archived
 * companies + archived contacts are excluded. Ordered most-recent-first.
 *
 * Query: ?days=30 (1–90)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { formatSignalSentence } from '@/lib/signal-activity';

const DEFAULT_DAYS = 30;
const MAX_ROWS = 400;

interface SignalRow {
  id: string;
  signal_key: string;
  signal_scope: 'company' | 'contact' | string;
  company_id: string | null;
  contact_id: string | null;
  source_event_id: string | null;
  event_at: string | null;
  observed_at: string | null;
  evidence_excerpt: string | null;
}

/** One underlying event shown when a grouped row is expanded. */
type Child = {
  id: string;
  title: string | null;
  detail: string | null;
  source: string | null;
  url: string | null;
  eventAt: string | null;
};

// Decode the handful of HTML entities that show up in scraped titles/abstracts
// (numeric refs + a few named ones) so they render as text, not "&#x2009;".
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Some signal types store a GENERIC source title like "cmc_hiring detected at
// Moderna" instead of the specific thing (the actual job role). Detect that so
// we can swap in a better label.
function isGenericTitle(t: string | null | undefined): boolean {
  return !!t && /\bdetected at\b/i.test(t);
}

// Pull the specific role out of a hiring summary's "e.g. {role}" example, e.g.
//   "…E.g. Scientist, Process Development (Formulation)."        → "Scientist, Process Development (Formulation)"
//   "1 open … role detected … (e.g. Senior Engineer I, …)."      → "Senior Engineer I, …"
function roleFromSummary(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const m = summary.match(/\be\.?\s*g\.?[:.]?\s+(.+)$/i);
  if (!m) return null;
  let role = m[1].trim().replace(/\.+$/, '').trim();
  // Drop a trailing ")" left unbalanced by stripping the wrapping "(e.g. …)".
  if (role.endsWith(')') && (role.split('(').length - 1) < (role.split(')').length - 1)) {
    role = role.slice(0, -1).trim();
  }
  return role || null;
}

// Last-resort: derive a role from a LinkedIn job URL slug
// (".../jobs/view/{role}-at-{company}-{id}") → title-cased words.
function roleFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const slug = rawUrl.match(/\/jobs\/view\/([^?]+)/i)?.[1];
  if (!slug) return null;
  const rolePart = slug.split('-at-')[0];
  if (!rolePart || rolePart === slug) return null; // no "-at-" → can't isolate the role
  const words = rolePart.split('-').filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get('days') ?? '', 10);
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, daysRaw)) : DEFAULT_DAYS;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // The log is dated by the SIGNAL'S OWN event date (when the patent was filed,
  // the paper published), NOT when we ingested it. So we window + sort on
  // event_at, falling back to observed_at only for signals that have no event
  // date at all. Because event_at predates observed_at, we can't filter at the
  // DB layer cheaply (a row's event can be old while its ingest is recent) —
  // pull the user's recent signals and apply the date logic in JS. The
  // per-user set is small.
  const { data: rowsRaw, error } = await supabase
    .from('normalized_signals')
    .select('id, signal_key, signal_scope, company_id, contact_id, source_event_id, event_at, observed_at, evidence_excerpt')
    .eq('user_id', user.id)
    .order('event_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const allRows = (rowsRaw ?? []) as SignalRow[];

  // Effective signal date = event_at, else observed_at. Window + order by it.
  const signalDateMs = (r: SignalRow): number | null => {
    const iso = r.event_at ?? r.observed_at;
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const rows = allRows
    .map((r) => ({ r, ms: signalDateMs(r) }))
    .filter((x): x is { r: SignalRow; ms: number } => x.ms != null && x.ms >= cutoffMs)
    .sort((a, b) => b.ms - a.ms)
    .map((x) => x.r);

  if (rows.length === 0) {
    return NextResponse.json({ items: [], days });
  }

  // Resolve company + contact names, source events (per-event detail), and the
  // user's archived companies to filter.
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter((v): v is string => !!v))];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((v): v is string => !!v))];
  const sourceEventIds = [...new Set(rows.map((r) => r.source_event_id).filter((v): v is string => !!v))];

  const [companiesRes, contactsRes, archivedRes, sourceRes] = await Promise.all([
    companyIds.length
      ? supabase.from('companies').select('id, company_name').in('id', companyIds)
      : Promise.resolve({ data: [] as Array<{ id: string; company_name: string | null }> }),
    contactIds.length
      ? supabase
          .from('contacts')
          .select('id, full_name, first_name, last_name, company_name, archived_at')
          .eq('user_id', user.id)
          .in('id', contactIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            full_name: string | null;
            first_name: string | null;
            last_name: string | null;
            company_name: string | null;
            archived_at: string | null;
          }>,
        }),
    supabase
      .from('user_companies')
      .select('company_id')
      .eq('user_id', user.id)
      .not('archived_at', 'is', null),
    sourceEventIds.length
      ? supabase
          .from('signal_source_events')
          .select('id, title, summary, excerpt, source, source_url, event_at')
          .in('id', sourceEventIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            title: string | null;
            summary: string | null;
            excerpt: string | null;
            source: string | null;
            source_url: string | null;
            event_at: string | null;
          }>,
        }),
  ]);

  const sourceById = new Map(
    ((sourceRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      summary: string | null;
      excerpt: string | null;
      source: string | null;
      source_url: string | null;
      event_at: string | null;
    }>).map((s) => [s.id, s]),
  );

  const companyName = new Map<string, string>(
    ((companiesRes.data ?? []) as Array<{ id: string; company_name: string | null }>).map((c) => [
      c.id,
      c.company_name ?? '',
    ]),
  );
  const contactById = new Map(
    ((contactsRes.data ?? []) as Array<{
      id: string;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
      archived_at: string | null;
    }>).map((c) => [c.id, c]),
  );
  const archivedCompanyIds = new Set(
    ((archivedRes.data ?? []) as Array<{ company_id: string }>).map((r) => r.company_id),
  );

  // Group repeats: one row per (scope, company|contact, signal_key) so 15
  // "Moderna published new research" events collapse to a single counted line.
  // Rows are already observed_at-desc, so the first hit per group is the latest.
  type Item = {
    id: string;
    sentence: string;
    scope: 'company' | 'contact';
    signalKey: string;
    companyId: string | null;
    companyName: string;
    contactId: string | null;
    contactName: string;
    eventAt: string | null;
    observedAt: string | null;
    /** The date to show = the signal's own event date (else ingest date). */
    displayAt: string | null;
    evidence: string | null;
    count: number;
    /** Per-event detail, shown when the row is expanded. */
    children: Child[];
  };
  const groups = new Map<string, Item>();

  // Build a child (title + detail) from a signal row + its source. For signals
  // whose source title is generic ("cmc_hiring detected at Moderna"), swap in
  // the specific thing — the actual job role, parsed from the summary's
  // "e.g. {role}" example or the LinkedIn URL slug — so two different postings
  // read distinctly instead of as identical rows.
  const toChild = (r: SignalRow): Child => {
    const src = r.source_event_id ? sourceById.get(r.source_event_id) : null;
    const rawDetail = src?.summary || src?.excerpt || r.evidence_excerpt || null;

    const specificTitle = src?.title && !isGenericTitle(src.title) ? decodeEntities(src.title) : null;
    const derivedTitle = specificTitle ?? roleFromSummary(src?.summary) ?? roleFromUrl(src?.source_url);
    // Fall back to the (generic) source title only if nothing better was found.
    const title = derivedTitle ?? (src?.title ? decodeEntities(src.title) : null);

    return {
      id: r.id,
      title,
      detail: rawDetail ? decodeEntities(rawDetail).slice(0, 280) : null,
      source: src?.source ?? null,
      url: src?.source_url ?? null,
      eventAt: src?.event_at ?? r.event_at ?? r.observed_at,
    };
  };

  for (const r of rows) {
    // Drop signals on archived companies or archived contacts.
    if (r.company_id && archivedCompanyIds.has(r.company_id)) continue;
    const contact = r.contact_id ? contactById.get(r.contact_id) : null;
    if (contact?.archived_at) continue;

    const scope: 'company' | 'contact' = r.signal_scope === 'contact' ? 'contact' : 'company';
    const contactName = contact
      ? contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || ''
      : '';
    const coName =
      (r.company_id ? companyName.get(r.company_id) : '') || contact?.company_name || '';

    const groupKey = `${scope}|${r.contact_id ?? r.company_id ?? '?'}|${r.signal_key}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.count += 1;
      existing.children.push(toChild(r));
      continue;
    }
    groups.set(groupKey, {
      id: r.id,
      sentence: formatSignalSentence({ signalKey: r.signal_key, scope, companyName: coName, contactName }),
      scope,
      signalKey: r.signal_key,
      companyId: r.company_id,
      companyName: coName,
      contactId: r.contact_id,
      contactName,
      eventAt: r.event_at,
      observedAt: r.observed_at,
      displayAt: r.event_at ?? r.observed_at,
      evidence: r.evidence_excerpt,
      count: 1,
      children: [toChild(r)],
    });
  }

  // `rows` is already sorted by signal date desc, so insertion order keeps the
  // list newest-first by the signal's own event date.
  const items = [...groups.values()];

  return NextResponse.json({ items, days });
}
