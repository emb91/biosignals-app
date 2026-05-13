import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { insertCompanySignalEvent, insertContactSignalEvent } from '@/lib/signals/write-signal-event';
import { listLeadEvents } from '@/lib/signals/events';
import { mirrorSignalEventToReadiness } from '@/lib/signals/readiness-signal-events';
import {
  persistCompanyIntentForCompanyRow,
  persistContactIntentScore,
} from '@/lib/signals/persist-intent';

/** GET: recent user's events / or lead-scoped bundles. POST: authenticated insert (+ optional intent persist). */

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
    const companyId = searchParams.get('companyId');
    const contactId = searchParams.get('contactId');
    const recent = searchParams.get('recent');

    if (recent === '1' || recent === 'true') {
      const lim = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '12', 10)));
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('user_id', user.id)
        .order('detected_at', { ascending: false })
        .limit(lim);

      if (error) {
        console.error('[GET /api/signal-events] recent:', error);
        return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
      }

      return NextResponse.json({ data: data || [] });
    }

    const leadPack = await listLeadEvents(supabase, user.id, {
      companyId: companyId || null,
      contactId: contactId || null,
    });

    return NextResponse.json(leadPack);
  } catch (e) {
    console.error('[GET /api/signal-events]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type PostBody =
  | {
      scope: 'company';
      signalId: string;
      companyId: string;
      source?: string | null;
      title?: string | null;
      description?: string | null;
      evidenceUrl?: string | null;
      confidence?: number | null;
      detectedAt?: string | null;
      eventMetadata?: Record<string, unknown> | null;
      rawPayload?: Record<string, unknown> | null;
    }
  | {
      scope: 'contact';
      signalId: string;
      contactId: string;
      companyId?: string | null;
      source?: string | null;
      title?: string | null;
      description?: string | null;
      evidenceUrl?: string | null;
      confidence?: number | null;
      detectedAt?: string | null;
      eventMetadata?: Record<string, unknown> | null;
      rawPayload?: Record<string, unknown> | null;
    };

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as PostBody;

    if (body.scope === 'company') {
      const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
      if (!companyId) {
        return NextResponse.json({ error: 'companyId required' }, { status: 400 });
      }

      const { data: owned, error: ownErr } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (ownErr || !owned) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }

      try {
        const row = await insertCompanySignalEvent(supabase, {
          userId: user.id,
          companyId,
          signalId: body.signalId,
          source: body.source,
          title: body.title,
          description: body.description,
          evidenceUrl: body.evidenceUrl,
          confidence: body.confidence,
          detectedAt: body.detectedAt,
          eventMetadata: body.eventMetadata,
          rawPayload: body.rawPayload,
        });

        await persistCompanyIntentForCompanyRow(supabase, user.id, companyId).catch((e) =>
          console.warn('[POST signal-events] company intent persist skipped', e)
        );

        const readinessAdmin = createAdminClient();
        const readinessMirror = await mirrorSignalEventToReadiness(readinessAdmin, user.id, row).catch((e) => {
          console.warn('[POST signal-events] readiness mirror skipped', e);
          return null;
        });

        return NextResponse.json({ data: row, readiness: readinessMirror });
      } catch (insertErr: unknown) {
        const code =
          insertErr && typeof insertErr === 'object' && 'code' in insertErr
            ? String((insertErr as { code?: unknown }).code)
            : '';
        if (code === '23505') {
          return NextResponse.json(
            { error: 'Duplicate event for this dedupe window' },
            { status: 409 }
          );
        }
        console.error(insertErr);
        return NextResponse.json(
          {
            error: insertErr instanceof Error ? insertErr.message : 'Insert failed',
          },
          { status: 400 }
        );
      }
    }

    if (body.scope === 'contact') {
      const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : '';
      if (!contactId) {
        return NextResponse.json({ error: 'contactId required' }, { status: 400 });
      }

      const { data: contact, error: cErr } = await supabase
        .from('contacts')
        .select('id, company_id')
        .eq('id', contactId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cErr || !contact) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }

      try {
        const row = await insertContactSignalEvent(supabase, {
          userId: user.id,
          contactId,
          companyId: body.companyId ?? (typeof contact.company_id === 'string' ? contact.company_id : null),
          signalId: body.signalId,
          source: body.source,
          title: body.title,
          description: body.description,
          evidenceUrl: body.evidenceUrl,
          confidence: body.confidence,
          detectedAt: body.detectedAt,
          eventMetadata: body.eventMetadata,
          rawPayload: body.rawPayload,
        });

        await persistContactIntentScore(supabase, user.id, { contactId }).catch((e) =>
          console.warn('[POST signal-events] contact intent persist skipped', e)
        );

        const readinessAdmin = createAdminClient();
        const readinessMirror = await mirrorSignalEventToReadiness(readinessAdmin, user.id, row).catch((e) => {
          console.warn('[POST signal-events] readiness mirror skipped', e);
          return null;
        });

        return NextResponse.json({ data: row, readiness: readinessMirror });
      } catch (insertErr: unknown) {
        const code =
          insertErr && typeof insertErr === 'object' && 'code' in insertErr
            ? String((insertErr as { code?: unknown }).code)
            : '';
        if (code === '23505') {
          return NextResponse.json(
            { error: 'Duplicate event for this dedupe window' },
            { status: 409 }
          );
        }
        console.error(insertErr);
        return NextResponse.json(
          {
            error: insertErr instanceof Error ? insertErr.message : 'Insert failed',
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
  } catch (e) {
    console.error('[POST /api/signal-events]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
