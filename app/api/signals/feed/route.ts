import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

type SignalFeedItem = {
  id: string;
  signalKey: string;
  signalScope: 'company' | 'contact';
  companyId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactJobTitle: string | null;
  contactLinkedinUrl: string | null;
  dimensions: string[];
  buyerFunctions: string[];
  intentMechanisms: string[];
  eventAt: string | null;
  observedAt: string;
  evidenceExcerpt: string | null;
  source: string;
  sourceEventType: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceSummary: string | null;
  sourceExcerpt: string | null;
  sourceMetadata: Record<string, unknown>;
  readiness: {
    overallScore: number | null;
    overallLabel: string | null;
    newBudgetScore: number | null;
    newBudgetLabel: string | null;
    newNeedsScore: number | null;
    newNeedsLabel: string | null;
    newPeopleScore: number | null;
    newPeopleLabel: string | null;
    newStrategyScore: number | null;
    newStrategyLabel: string | null;
    cautionScore: number | null;
    cautionLabel: string | null;
  } | null;
  reason: {
    summaryShort: string | null;
    whyNow: string | null;
    suggestedAngle: string | null;
  } | null;
};

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '25', 10)));
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const scopeParam = searchParams.get('scope');
    const scope = scopeParam === 'contact' || scopeParam === 'company' ? scopeParam : null;
    const companyIdParam = (searchParams.get('company_id') || '').trim() || null;
    const contactIdParam = (searchParams.get('contact_id') || '').trim() || null;

    let query = supabase
      .from('normalized_signals')
      .select(`
        id,
        signal_key,
        signal_scope,
        company_id,
        contact_id,
        dimensions,
        buyer_functions,
        intent_mechanisms,
        event_at,
        observed_at,
        evidence_excerpt,
        source_event:signal_source_events!inner(
          id,
          source,
          source_event_type,
          source_url,
          title,
          summary,
          excerpt,
          metadata
        ),
        company:companies!normalized_signals_company_id_fkey(
          id,
          company_name,
          domain
        ),
        contact:contacts!normalized_signals_contact_id_fkey(
          id,
          full_name,
          email,
          job_title,
          linkedin_url,
          archived_at
        )
      `)
      .eq('user_id', user.id)
      .order('observed_at', { ascending: false })
      .limit(400);

    if (scope) {
      query = query.eq('signal_scope', scope);
    }
    if (companyIdParam) {
      query = query.eq('company_id', companyIdParam);
    }
    if (contactIdParam) {
      query = query.eq('contact_id', contactIdParam);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[GET /api/signals/feed] query error', error);
      return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 });
    }

    const rows = Array.isArray(data) ? data : [];

    // companies.archived_at was dropped in the P1d canonicalisation; archive
    // state lives on user_companies (per-user). Pull the user's archived
    // company_ids in one shot and filter rows whose company appears there.
    const allCompanyIds = [
      ...new Set(rows.map((row: any) => normalizeString(row.company_id)).filter(Boolean)),
    ] as string[];
    const archivedCompanyIds = new Set<string>();
    if (allCompanyIds.length) {
      const { data: archivedRows, error: archivedErr } = await supabase
        .from('user_companies')
        .select('company_id')
        .eq('user_id', user.id)
        .in('company_id', allCompanyIds)
        .not('archived_at', 'is', null);
      if (archivedErr) {
        console.error('[GET /api/signals/feed] user_companies archive lookup error', archivedErr);
      }
      for (const r of (archivedRows ?? []) as Array<{ company_id: string | null }>) {
        if (r.company_id) archivedCompanyIds.add(r.company_id);
      }
    }

    const activeRows = rows.filter((row: any) => {
      const cid = normalizeString(row.company_id);
      if (cid && archivedCompanyIds.has(cid)) return false;
      if (row.contact?.archived_at) return false;
      return true;
    });
    const companyIds = [...new Set(activeRows.map((row: any) => normalizeString(row.company_id)).filter(Boolean))] as string[];
    const contactIds = [...new Set(activeRows.map((row: any) => normalizeString(row.contact_id)).filter(Boolean))] as string[];

    const readinessSelect =
      'company_id,overall_score,overall_label,new_budget_score,new_budget_label,new_needs_score,new_needs_label,new_people_score,new_people_label,new_strategy_score,new_strategy_label,caution_score,caution_label';
    const contactReadinessSelect =
      'contact_id,overall_score,overall_label,new_budget_score,new_budget_label,new_needs_score,new_needs_label,new_people_score,new_people_label,new_strategy_score,new_strategy_label,caution_score,caution_label';

    const [readinessResult, contactReadinessResult, reasonsResult] = await Promise.all([
      companyIds.length
        ? supabase
            .from('account_readiness_snapshots')
            .select(readinessSelect)
            .eq('user_id', user.id)
            .in('company_id', companyIds)
        : Promise.resolve({ data: [], error: null }),
      contactIds.length
        ? supabase
            .from('contact_readiness_snapshots')
            .select(contactReadinessSelect)
            .eq('user_id', user.id)
            .in('contact_id', contactIds)
        : Promise.resolve({ data: [], error: null }),
      companyIds.length
        ? supabase
            .from('account_reason_snapshots')
            .select('company_id,summary_short,why_now,suggested_angle')
            .eq('user_id', user.id)
            .in('company_id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (readinessResult.error) {
      console.error('[GET /api/signals/feed] readiness error', readinessResult.error);
    }
    if (contactReadinessResult.error) {
      console.error('[GET /api/signals/feed] contact readiness error', contactReadinessResult.error);
    }
    if (reasonsResult.error) {
      console.error('[GET /api/signals/feed] reasons error', reasonsResult.error);
    }

    const readinessByCompanyId = new Map((readinessResult.data || []).map((row: any) => [row.company_id, row]));
    const readinessByContactId = new Map((contactReadinessResult.data || []).map((row: any) => [row.contact_id, row]));
    const reasonByCompanyId = new Map((reasonsResult.data || []).map((row: any) => [row.company_id, row]));

    const mapped: SignalFeedItem[] = activeRows.map((row: any) => {
      const companyId = normalizeString(row.company_id);
      const contactId = normalizeString(row.contact_id);
      const readiness =
        contactIdParam && contactId
          ? readinessByContactId.get(contactId) ?? null
          : companyId
            ? readinessByCompanyId.get(companyId) ?? null
            : null;
      const reason = companyId ? reasonByCompanyId.get(companyId) ?? null : null;
      return {
        id: String(row.id),
        signalKey: String(row.signal_key),
        signalScope: row.signal_scope === 'contact' ? 'contact' : 'company',
        companyId,
        companyName: normalizeString(row.company?.company_name),
        companyDomain: normalizeString(row.company?.domain),
        contactId,
        contactName: normalizeString(row.contact?.full_name),
        contactEmail: normalizeString(row.contact?.email),
        contactJobTitle: normalizeString(row.contact?.job_title),
        contactLinkedinUrl: normalizeString(row.contact?.linkedin_url),
        dimensions: normalizeStringArray(row.dimensions),
        buyerFunctions: normalizeStringArray(row.buyer_functions),
        intentMechanisms: normalizeStringArray(row.intent_mechanisms),
        eventAt: normalizeString(row.event_at),
        observedAt: normalizeString(row.observed_at) ?? new Date().toISOString(),
        evidenceExcerpt: normalizeString(row.evidence_excerpt),
        source: normalizeString(row.source_event?.source) ?? 'unknown',
        sourceEventType: normalizeString(row.source_event?.source_event_type) ?? String(row.signal_key),
        sourceUrl: normalizeString(row.source_event?.source_url),
        sourceTitle: normalizeString(row.source_event?.title),
        sourceSummary: normalizeString(row.source_event?.summary),
        sourceExcerpt: normalizeString(row.source_event?.excerpt),
        sourceMetadata:
          row.source_event?.metadata && typeof row.source_event.metadata === 'object'
            ? row.source_event.metadata
            : {},
        readiness: readiness
          ? {
              overallScore: normalizeNullableNumber(readiness.overall_score),
              overallLabel: normalizeString(readiness.overall_label),
              newBudgetScore: normalizeNullableNumber(readiness.new_budget_score),
              newBudgetLabel: normalizeString(readiness.new_budget_label),
              newNeedsScore: normalizeNullableNumber(readiness.new_needs_score),
              newNeedsLabel: normalizeString(readiness.new_needs_label),
              newPeopleScore: normalizeNullableNumber(readiness.new_people_score),
              newPeopleLabel: normalizeString(readiness.new_people_label),
              newStrategyScore: normalizeNullableNumber(readiness.new_strategy_score),
              newStrategyLabel: normalizeString(readiness.new_strategy_label),
              cautionScore: normalizeNullableNumber(readiness.caution_score),
              cautionLabel: normalizeString(readiness.caution_label),
            }
          : null,
        reason: reason
          ? {
              summaryShort: normalizeString(reason.summary_short),
              whyNow: normalizeString(reason.why_now),
              suggestedAngle: normalizeString(reason.suggested_angle),
            }
          : null,
      };
    });

    const filtered = search
      ? mapped.filter((item) => {
          const haystack = [
            item.contactName,
            item.contactEmail,
            item.contactJobTitle,
            item.companyName,
            item.companyDomain,
            item.signalKey,
            item.sourceTitle,
            item.sourceSummary,
            item.source,
            item.dimensions.join(' '),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
      : mapped;

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    return NextResponse.json({ data: paged, total, page, pageSize });
  } catch (error) {
    console.error('[GET /api/signals/feed] fatal', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
