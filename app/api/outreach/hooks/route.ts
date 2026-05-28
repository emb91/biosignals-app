/**
 * GET /api/outreach/hooks?contactId=…
 *
 * Returns the list of recent signals (last 14d) that can anchor an outreach
 * sequence for this contact. Pure DB query — NO LLM call.
 *
 * Ordering:
 *   1. Contact-level signals first (job change, promotion, new role)
 *   2. Then company-level signals, newest first
 *
 * Output: { hooks: Hook[] } where Hook = {
 *   source_type: 'signal' | 'derived',
 *   source_event_id: string | null,
 *   source_event_at: string | null,
 *   signal_type: string | null,
 *   is_contact_level: boolean,
 *   title: string,
 *   summary: string | null,
 * }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const LOOKBACK_DAYS = 14;
const MAX_HOOKS = 10;

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Internal server error';
}

type Hook = {
  source_type: 'signal' | 'derived';
  source_event_id: string | null;
  source_event_at: string | null;
  signal_type: string | null;
  is_contact_level: boolean;
  title: string;
  summary: string | null;
};

type SignalRow = {
  id: string;
  source_event_type: string | null;
  title: string | null;
  summary: string | null;
  event_at: string | null;
  entity_company_id: string | null;
  entity_contact_id: string | null;
};

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

    const url = new URL(request.url);
    const contactId = (url.searchParams.get('contactId') ?? '').trim();
    if (!contactId) {
      return NextResponse.json({ error: 'contactId required' }, { status: 400 });
    }

    // Look up the contact's company_id so we can pull company-level signals.
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('user_id', user.id)
      .eq('id', contactId)
      .maybeSingle();
    if (contactErr) {
      return NextResponse.json({ error: contactErr.message }, { status: 500 });
    }
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const companyId = (contact as { company_id?: string | null }).company_id ?? null;

    // Pull signals from last 14 days — contact-scoped OR company-scoped.
    const cutoffIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const filterExpr = companyId
      ? `entity_contact_id.eq.${contactId},entity_company_id.eq.${companyId}`
      : `entity_contact_id.eq.${contactId}`;

    const { data: signals, error: signalsErr } = await supabase
      .from('signal_source_events')
      .select('id, source_event_type, title, summary, event_at, entity_company_id, entity_contact_id')
      .eq('user_id', user.id)
      .or(filterExpr)
      .gte('event_at', cutoffIso)
      .order('event_at', { ascending: false })
      .limit(MAX_HOOKS * 2); // grab extra; we'll dedupe + cap below
    if (signalsErr) {
      return NextResponse.json({ error: signalsErr.message }, { status: 500 });
    }

    // Build hooks. Contact-level first, then company-level. Dedupe by
    // (event_type, title) so the same announcement doesn't repeat.
    const seen = new Set<string>();
    const contactLevel: Hook[] = [];
    const companyLevel: Hook[] = [];
    for (const s of (signals ?? []) as SignalRow[]) {
      const key = `${s.source_event_type}|${s.title ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!s.title) continue;
      const isContactLevel = s.entity_contact_id === contactId;
      const hook: Hook = {
        source_type: 'signal',
        source_event_id: s.id,
        source_event_at: s.event_at,
        signal_type: s.source_event_type,
        is_contact_level: isContactLevel,
        title: s.title,
        summary: s.summary,
      };
      if (isContactLevel) contactLevel.push(hook);
      else companyLevel.push(hook);
    }

    const hooks = [...contactLevel, ...companyLevel].slice(0, MAX_HOOKS);
    return NextResponse.json({ hooks });
  } catch (error) {
    console.error('Error in outreach/hooks GET:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
