import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { rescoreAllContactsForUser } from '@/lib/rescore';

/**
 * Wipes all Arcova setup data for the current user: personas (buying groups),
 * ICP rows, and own-company (`user_company`) analysis. Used only from explicit
 * "Start again" in setup.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const uid = user.id;

    const { error: personaError } = await supabase.from('personas').delete().eq('user_id', uid);
    if (personaError) {
      console.error('[setup-reset] personas delete:', personaError);
      return NextResponse.json({ error: 'Failed to reset buying groups' }, { status: 500 });
    }

    const { error: icpError } = await supabase.from('icps').delete().eq('user_id', uid);
    if (icpError) {
      console.error('[setup-reset] icps delete:', icpError);
      return NextResponse.json({ error: 'Failed to reset target profiles' }, { status: 500 });
    }

    const { error: companyError } = await supabase.from('user_company').delete().eq('user_id', uid);
    if (companyError) {
      console.error('[setup-reset] user_company delete:', companyError);
      return NextResponse.json({ error: 'Failed to reset company profile' }, { status: 500 });
    }

    rescoreAllContactsForUser(uid).catch((err) =>
      console.error('[setup-reset] Background rescore failed:', err),
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[setup-reset]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
