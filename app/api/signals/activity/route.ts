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
  event_at: string | null;
  observed_at: string | null;
  evidence_excerpt: string | null;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get('days') ?? '', 10);
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, daysRaw)) : DEFAULT_DAYS;
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: rowsRaw, error } = await supabase
    .from('normalized_signals')
    .select('id, signal_key, signal_scope, company_id, contact_id, event_at, observed_at, evidence_excerpt')
    .eq('user_id', user.id)
    .gte('observed_at', cutoffIso)
    .order('observed_at', { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (rowsRaw ?? []) as SignalRow[];
  if (rows.length === 0) {
    return NextResponse.json({ items: [], days });
  }

  // Resolve company + contact names, and the user's archived companies to filter.
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter((v): v is string => !!v))];
  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((v): v is string => !!v))];

  const [companiesRes, contactsRes, archivedRes] = await Promise.all([
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
  ]);

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
    evidence: string | null;
    count: number;
  };
  const groups = new Map<string, Item>();

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
      evidence: r.evidence_excerpt,
      count: 1,
    });
  }

  // Map preserves insertion order = observed_at desc, so the list stays recent-first.
  const items = [...groups.values()];

  return NextResponse.json({ items, days });
}
