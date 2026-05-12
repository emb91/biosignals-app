import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  buildPersistedAccountReadinessContext,
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { BuyerFunction, SignalKey, SignalScope } from '@/lib/signals/readiness-types';

type IngestBody = {
  entity_scope?: SignalScope;
  company_id?: string;
  contact_id?: string;
  source?: string;
  source_event_type?: string;
  source_event_id?: string;
  source_url?: string;
  title?: string;
  summary?: string;
  excerpt?: string;
  event_at?: string;
  metadata?: Record<string, unknown>;
  signal_keys?: SignalKey[];
  buyer_functions_override?: BuyerFunction[];
};

/**
 * POST /api/readiness/ingest
 *
 * Internal/dev endpoint for inserting a raw readiness source event, normalizing it,
 * recomputing the affected company readiness, regenerating reason, and returning
 * the latest assembled context.
 *
 * Body:
 * {
 *   entity_scope: 'company' | 'contact',
 *   company_id?: string,
 *   contact_id?: string,
 *   source: string,
 *   source_event_type: string,
 *   source_event_id?: string,
 *   source_url?: string,
 *   title?: string,
 *   summary?: string,
 *   excerpt?: string,
 *   event_at?: string,
 *   metadata?: object,
 *   signal_keys?: SignalKey[],
 *   buyer_functions_override?: BuyerFunction[]
 * }
 */
export async function POST(request: Request) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as IngestBody;
    const entityScope = body.entity_scope;
    const companyId = body.company_id?.trim() || null;
    const contactId = body.contact_id?.trim() || null;
    const source = body.source?.trim();
    const sourceEventType = body.source_event_type?.trim();

    if (!entityScope || (entityScope !== 'company' && entityScope !== 'contact')) {
      return NextResponse.json({ error: 'entity_scope required' }, { status: 400 });
    }

    if (!source) {
      return NextResponse.json({ error: 'source required' }, { status: 400 });
    }

    if (!sourceEventType) {
      return NextResponse.json({ error: 'source_event_type required' }, { status: 400 });
    }

    if (entityScope === 'company' && !companyId) {
      return NextResponse.json({ error: 'company_id required for company events' }, { status: 400 });
    }

    if (entityScope === 'contact' && !contactId) {
      return NextResponse.json({ error: 'contact_id required for contact events' }, { status: 400 });
    }

    const supabase = createAdminClient();

    if (companyId) {
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (companyError || !company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
    }

    if (contactId) {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id, company_id')
        .eq('id', contactId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (contactError || !contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }

      if (!companyId && typeof contact.company_id === 'string') {
        body.company_id = contact.company_id;
      }
    }

    const ingestResult = await ingestSignalSourceEvent(supabase, {
      userId: user.id,
      entityScope,
      companyId: body.company_id ?? companyId,
      contactId,
      source,
      sourceEventType,
      sourceEventId: body.source_event_id?.trim() || null,
      sourceUrl: body.source_url?.trim() || null,
      title: body.title ?? null,
      summary: body.summary ?? null,
      excerpt: body.excerpt ?? null,
      eventAt: body.event_at ?? null,
      metadata: body.metadata ?? {},
    });

    const rawEvent = {
      id: ingestResult.sourceEventId,
      userId: user.id,
      entityId:
        entityScope === 'company'
          ? (body.company_id ?? companyId ?? '')
          : (contactId ?? ''),
      entityScope,
      source,
      sourceUrl: body.source_url?.trim() || null,
      sourceEventType,
      sourceEventId: body.source_event_id?.trim() || null,
      title: body.title ?? null,
      summary: body.summary ?? null,
      excerpt: body.excerpt ?? null,
      eventAt: body.event_at ?? null,
      observedAt: new Date().toISOString(),
      metadata: body.metadata ?? {},
    } as const;

    const normalizedResult = await normalizeSignalSourceEvent(supabase, {
      userId: user.id,
      rawEvent,
      signalKeys: body.signal_keys,
      buyerFunctionsOverride: body.buyer_functions_override,
      companyId: body.company_id ?? companyId,
      contactId,
    });

    const affectedCompanyIds = normalizedResult.affectedCompanyIds.filter(Boolean);

    const recomputeResults = await Promise.all(
      affectedCompanyIds.map(async (affectedCompanyId) => {
        const readiness = await recomputeAccountReadiness(supabase, {
          userId: user.id,
          companyId: affectedCompanyId,
        });

        const reason = await generateAccountReason(supabase, {
          userId: user.id,
          companyId: affectedCompanyId,
        });

        const context = await buildPersistedAccountReadinessContext(supabase, {
          userId: user.id,
          companyId: affectedCompanyId,
        });

        return {
          company_id: affectedCompanyId,
          readiness,
          reason,
          context,
        };
      })
    );

    return NextResponse.json({
      success: true,
      ingest: ingestResult,
      normalize: normalizedResult,
      companies: recomputeResults,
    });
  } catch (error) {
    console.error('[readiness/ingest] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

