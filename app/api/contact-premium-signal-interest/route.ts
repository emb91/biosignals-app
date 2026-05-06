import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isContactSignalComingSoon } from '@/lib/signals/catalog';

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

    const body = await request.json();
    const signalId = typeof body.signalId === 'string' ? body.signalId.trim() : '';
    const rawPersonaId = body.personaId;
    let personaId: string | null = null;
    if (typeof rawPersonaId === 'string') {
      const trimmed = rawPersonaId.trim();
      personaId = trimmed || null;
    } else if (rawPersonaId != null) {
      return NextResponse.json({ error: 'Invalid persona' }, { status: 400 });
    }

    if (!signalId || !isContactSignalComingSoon(signalId)) {
      return NextResponse.json({ error: 'Invalid signal' }, { status: 400 });
    }

    if (personaId) {
      const { data: persona, error: personaError } = await supabase
        .from('personas')
        .select('id')
        .eq('id', personaId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (personaError || !persona) {
        return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
      }
    }

    const { error } = await supabase.from('contact_premium_signal_interest').insert({
      user_id: user.id,
      signal_id: signalId,
      persona_id: personaId,
    });

    if (error) {
      console.error('[contact-premium-signal-interest]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('contact-premium-signal-interest POST:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
