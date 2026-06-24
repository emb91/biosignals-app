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
import { orgIdForUser } from '@/lib/org-context';

const DEFAULT_DAYS = 30;
const MAX_ROWS = 400;
const HIDDEN_CRM_SIGNAL_SOURCES = new Set(['hubspot_crm_contacts', 'hubspot_crm_deals']);
const HIDDEN_CRM_SIGNAL_KEYS = new Set([
  'recently_changed_company',
  'recently_promoted',
  'new_internal_role',
  'title_change',
  'new_contact_added_in_crm',
  'open_opportunity_in_crm',
  'closed_lost_in_crm',
]);

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

type SourceEventRow = {
  id: string;
  title: string | null;
  summary: string | null;
  excerpt: string | null;
  source: string | null;
  source_url: string | null;
  event_at: string | null;
  metadata: Record<string, unknown> | null;
};

/** A hiring-surge metadata.all_roles entry: every scraped open posting. */
type SurgeRole = { title?: string | null; url?: string | null };

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

// Patent title fallback when metadata.patent_title is missing — the summary is
// "Patent filing/grant activity detected for {Company}: {Title}."
function patentTitleFromSummary(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const idx = summary.indexOf(': ');
  if (idx === -1) return null;
  return summary.slice(idx + 2).replace(/\.+$/, '').trim() || null;
}

function prettyEnum(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
function formatTrialPhase(p: string): string {
  const m = p.match(/PHASE\s*(\d)/i);
  return m ? `Phase ${m[1]}` : prettyEnum(p);
}
// Compact USD: 1399878 -> "$1.4M", 5000000 -> "$5M", 250000 -> "$250K".
function formatUsd(n: unknown): string | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}
function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = typeof v === 'number' ? v : null;
    if (n != null && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// Pull a SPECIFIC title + detail out of a signal's source metadata. A null
// title means "keep whatever title the caller derived" (e.g. a real press-release
// headline) and only swap in the richer detail line. Covers clinical trials,
// patents, FDA decisions, grants, and funding rounds.
function specificFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): { title: string | null; detail: string | null } {
  if (!meta) return { title: null, detail: null };

  // Clinical trial
  if (typeof meta.study_title === 'string' && meta.study_title) {
    const phase = Array.isArray(meta.phases) && meta.phases.length ? formatTrialPhase(String(meta.phases[0])) : null;
    const cond = Array.isArray(meta.conditions) && meta.conditions.length ? String(meta.conditions[0]) : null;
    const status = typeof meta.study_status === 'string' ? prettyEnum(meta.study_status) : null;
    const nct = typeof meta.nct_id === 'string' ? meta.nct_id : null;
    const detail = [phase, cond, status, nct].filter(Boolean).join(' · ') || null;
    return { title: meta.study_title, detail };
  }

  // Patent
  if (typeof meta.patent_title === 'string' && meta.patent_title) {
    return { title: meta.patent_title, detail: typeof meta.patent_id === 'string' ? meta.patent_id : null };
  }

  // FDA decision (openFDA): trade name + what it is + dossier number.
  if (typeof meta.trade_name === 'string' && meta.trade_name) {
    const generic = typeof meta.generic_name === 'string' ? meta.generic_name : null;
    const dossier =
      (typeof meta.pma_number === 'string' && meta.pma_number) ||
      (typeof meta.k_number === 'string' && meta.k_number) ||
      (typeof meta.application_number === 'string' && meta.application_number) ||
      null;
    const detail = [generic ? generic.slice(0, 90) : null, dossier].filter(Boolean).join(' · ') || null;
    return { title: meta.trade_name, detail };
  }

  // Grant (NIH RePORTER): project title + agency · amount · grant number.
  if (typeof meta.project_title === 'string' && meta.project_title) {
    const agency = typeof meta.agency_ic_abbr === 'string' ? meta.agency_ic_abbr : null;
    const amount = formatUsd(meta.award_amount);
    const num = typeof meta.project_num === 'string' ? meta.project_num : null;
    const detail = [agency, amount, num].filter(Boolean).join(' · ') || null;
    return { title: meta.project_title, detail };
  }

  // Funding round (press release amount_usd/investors, or SEC offering amount).
  // Keep the existing title (a real press headline) — only add the money line.
  const fundingAmount = formatUsd(
    firstNum(meta.amount_usd, meta.total_offering_amount, meta.total_amount_sold),
  );
  const investors = Array.isArray(meta.investors)
    ? (meta.investors as unknown[]).filter((v): v is string => typeof v === 'string' && !!v).slice(0, 3)
    : [];
  if (fundingAmount || investors.length > 0) {
    const detail = [fundingAmount, investors.join(', ') || null].filter(Boolean).join(' · ') || null;
    return { title: null, detail };
  }

  return { title: null, detail: null };
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
  const orgId = await orgIdForUser(supabase as any, user.id);
  const archivedCompaniesQuery = orgId
    ? supabase
        .from('org_companies')
        .select('company_id')
        .eq('org_id', orgId)
        .not('archived_at', 'is', null)
    : supabase
        .from('user_companies')
        .select('company_id')
        .eq('user_id', user.id)
        .not('archived_at', 'is', null);

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
    archivedCompaniesQuery,
    sourceEventIds.length
      ? supabase
          .from('signal_source_events')
          .select('id, title, summary, excerpt, source, source_url, event_at, metadata')
          .in('id', sourceEventIds)
      : Promise.resolve({
          data: [] as Array<SourceEventRow>,
        }),
  ]);

  const sourceById = new Map(
    ((sourceRes.data ?? []) as Array<SourceEventRow>).map((s) => [s.id, s]),
  );
  const visibleRows = rows.filter((row) => {
    const source = row.source_event_id ? sourceById.get(row.source_event_id)?.source : null;
    return !(source && HIDDEN_CRM_SIGNAL_SOURCES.has(source) && HIDDEN_CRM_SIGNAL_KEYS.has(row.signal_key));
  });

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
  // One signal row → its expandable children. Normally a single child, but a
  // hiring-surge (hiring_expansion) row whose source metadata carries the full
  // posting list (all_roles) expands into one child PER open role, so the surge
  // lists every role instead of a single generic line. (all_roles is only
  // present after the monitor change + a hiring run; older surges fall back to
  // the single child.)
  const childrenForRow = (r: SignalRow): Child[] => {
    const src = r.source_event_id ? sourceById.get(r.source_event_id) : null;

    const allRoles = Array.isArray(src?.metadata?.all_roles)
      ? (src!.metadata!.all_roles as SurgeRole[])
      : null;
    if (allRoles && allRoles.length > 0) {
      return allRoles
        .filter((role) => role && (role.title || role.url))
        .map((role, i) => ({
          id: `${r.id}:${i}`,
          title: role.title ? decodeEntities(role.title) : 'Open role',
          detail: null,
          source: src?.source ?? null,
          url: role.url ?? null,
          eventAt: src?.event_at ?? r.event_at ?? r.observed_at,
        }));
    }

    const rawDetail = src?.summary || src?.excerpt || r.evidence_excerpt || null;
    const specificTitle = src?.title && !isGenericTitle(src.title) ? decodeEntities(src.title) : null;
    const meta = specificFromMetadata(src?.metadata);
    const derivedTitle =
      specificTitle ?? meta.title ?? roleFromSummary(src?.summary) ?? roleFromUrl(src?.source_url);
    // Fall back to the (generic) source title only if nothing better was found.
    const title = derivedTitle ?? (src?.title ? decodeEntities(src.title) : null);
    // Prefer the structured metadata detail (e.g. "Phase 4 · COVID-19 ·
    // Recruiting") over the raw summary.
    const detail = meta.detail ?? (rawDetail ? decodeEntities(rawDetail).slice(0, 280) : null);

    return [{
      id: r.id,
      title,
      detail,
      source: src?.source ?? null,
      url: src?.source_url ?? null,
      eventAt: src?.event_at ?? r.event_at ?? r.observed_at,
    }];
  };

  for (const r of visibleRows) {
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
      existing.children.push(...childrenForRow(r));
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
      children: childrenForRow(r),
    });
  }

  // `rows` is already sorted by signal date desc, so insertion order keeps the
  // list newest-first by the signal's own event date.
  const items = [...groups.values()];

  // Patent-velocity rows (assignee_portfolio_acceleration) summarise "N patents
  // in the last 90 days" but don't store the list. The individual patents ARE
  // stored as their own events (with patent_title + Google Patents URL), so
  // fetch the company's recent patents and list them as the row's children —
  // one bullet (title + link) per patent. No monitor change / re-scrape needed.
  const velocityItems = items.filter(
    (it) => it.signalKey === 'assignee_portfolio_acceleration' && it.companyId,
  );
  if (velocityItems.length > 0) {
    const velCompanyIds = [...new Set(velocityItems.map((it) => it.companyId).filter((v): v is string => !!v))];
    // Generous 120-day window so the 90-day velocity window is fully covered.
    const patentCutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const { data: patentRows } = await supabase
      .from('signal_source_events')
      .select('entity_company_id, source_url, event_at, summary, metadata')
      .eq('user_id', user.id)
      .in('entity_company_id', velCompanyIds)
      .in('source_event_type', ['patent_filed_or_granted', 'patent_application_published', 'patent_granted'])
      .gte('event_at', patentCutoff)
      .order('event_at', { ascending: false });

    const patentsByCompany = new Map<string, Child[]>();
    const seenPatent = new Map<string, Set<string>>();
    for (const p of (patentRows ?? []) as Array<{
      entity_company_id: string | null;
      source_url: string | null;
      event_at: string | null;
      summary: string | null;
      metadata: Record<string, unknown> | null;
    }>) {
      const cid = p.entity_company_id;
      if (!cid) continue;
      const meta = p.metadata ?? {};
      const patentId = (typeof meta.patent_id === 'string' && meta.patent_id) || p.source_url || '';
      // Dedup the same patent across filed/published/granted events.
      if (!seenPatent.has(cid)) seenPatent.set(cid, new Set());
      if (patentId && seenPatent.get(cid)!.has(patentId)) continue;
      if (patentId) seenPatent.get(cid)!.add(patentId);

      const title =
        (typeof meta.patent_title === 'string' && meta.patent_title) ||
        patentTitleFromSummary(p.summary) ||
        'Patent';
      const arr = patentsByCompany.get(cid) ?? [];
      arr.push({
        id: `${cid}:patent:${patentId || arr.length}`,
        title: decodeEntities(title),
        detail: typeof meta.patent_id === 'string' ? meta.patent_id : null,
        source: 'patentsview',
        url: p.source_url,
        eventAt: (typeof meta.patent_date === 'string' && meta.patent_date) || p.event_at,
      });
      patentsByCompany.set(cid, arr);
    }

    for (const it of velocityItems) {
      const kids = it.companyId ? patentsByCompany.get(it.companyId) : null;
      if (kids && kids.length > 0) it.children = kids;
    }
  }

  return NextResponse.json({ items, days });
}
