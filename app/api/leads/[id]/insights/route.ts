import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-server';
import { listLeadEvents } from '@/lib/signals/events';
import {
  loadIcpSignalSelectionsDetailed,
  loadPersonaSignalSelectionsDetailed,
} from '@/lib/signals/selections';
import {
  computeCompanyIntent01,
  computePersonIntent01,
} from '@/lib/signals/intent-scoring';

type Slim = { signal_type: string; detected_at: string | null };

function toSlim(events: Record<string, unknown>[]): Slim[] {
  return events.map((e) => ({
    signal_type: String(e.signal_type ?? ''),
    detected_at:
      typeof e.detected_at === 'string'
        ? e.detected_at
        : typeof e.created_at === 'string'
          ? e.created_at
          : null,
  }));
}

async function personaForContact(
  supabase: SupabaseClient<any>,
  userId: string,
  contactRow: { scored_against_persona_id?: string | null; company_id?: string | null }
) {
  if (contactRow.scored_against_persona_id) return contactRow.scored_against_persona_id;

  if (contactRow.company_id) {
    const { data } = await supabase
      .from('contacts')
      .select('scored_against_persona_id')
      .eq('user_id', userId)
      .eq('company_id', contactRow.company_id)
      .not('scored_against_persona_id', 'is', null)
      .limit(1)
      .maybeSingle();
    const pid =
      typeof data?.scored_against_persona_id === 'string'
        ? data.scored_against_persona_id
        : null;
    if (pid) return pid;
  }

  const { data: p } = await supabase
    .from('personas')
    .select('id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return typeof p?.id === 'string' ? p.id : null;
}

/** Lead detail: observable signal events plus model intent used for overlays (stored DB scores unchanged here). */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leadId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: row, error: rowErr } = await supabase
      .from('contacts')
      .select(
        'id, company_id, scored_against_persona_id, fit_score, intent_score, priority_score'
      )
      .eq('user_id', user.id)
      .eq('id', leadId)
      .maybeSingle();

    if (rowErr || !row) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const contactId = row.id as string;
    const companyId = typeof row.company_id === 'string' ? row.company_id : null;

    const bundle = await listLeadEvents(supabase, user.id, {
      companyId,
      contactId,
    });

    const personaId = await personaForContact(supabase, user.id, {
      scored_against_persona_id: row.scored_against_persona_id as string | null,
      company_id: companyId,
    });

    let icpId: string | null = null;
    if (personaId) {
      const { data: p } = await supabase
        .from('personas')
        .select('icp_id')
        .eq('user_id', user.id)
        .eq('id', personaId)
        .maybeSingle();
      icpId = typeof p?.icp_id === 'string' ? p.icp_id : null;
    }

    let icpSel: Array<{ signalId: string; weight: number }> = [];
    if (icpId) {
      const selMap = await loadIcpSignalSelectionsDetailed(supabase, user.id, [icpId]);
      icpSel = (selMap.get(icpId) ?? []).map((r) => ({ signalId: r.signalId, weight: r.weight }));
    }

    let personaSel: Array<{ signalId: string; weight: number }> = [];
    if (personaId) {
      const pmap = await loadPersonaSignalSelectionsDetailed(supabase, user.id, [personaId]);
      personaSel = (pmap.get(personaId) ?? []).map((r) => ({
        signalId: r.signalId,
        weight: r.weight,
      }));
    }

    const companyIntentModel = computeCompanyIntent01(icpSel, toSlim(bundle.companyEvents as Record<string, unknown>[]));
    const contactIntentModel = computePersonIntent01(
      personaSel,
      toSlim(bundle.contactEvents as Record<string, unknown>[])
    );

    return NextResponse.json({
      lead: row,
      companyEvents: bundle.companyEvents,
      contactEvents: bundle.contactEvents,
      modelScores: {
        companyIntent01: companyIntentModel,
        contactIntent01: contactIntentModel,
        /** Simple blended headline intent (display only). Contact row still tracks buyer intent only. */
        blendedIntent01:
          typeof companyIntentModel === 'number' && typeof contactIntentModel === 'number'
            ? (companyIntentModel + contactIntentModel) / 2
            : (companyIntentModel ?? contactIntentModel ?? null),
      },
    });
  } catch (e) {
    console.error('[GET /api/leads/[id]/insights]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
