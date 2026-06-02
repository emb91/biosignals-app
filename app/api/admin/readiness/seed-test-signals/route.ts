import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { isAdminEmail } from '@/lib/admin-access';
import { insertCompanySignalEvent, insertContactSignalEvent } from '@/lib/signals/write-signal-event';
import { mirrorSignalEventToReadiness } from '@/lib/signals/readiness-signal-events';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      const url = new URL(request.url);
      const devSeedEnabled =
        process.env.NODE_ENV !== 'production' &&
        url.searchParams.get('dev_seed') === '1' &&
        ['localhost:3000', '127.0.0.1:3000'].includes(url.host);

      if (!devSeedEnabled) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const admin = createAdminClient();
      const { data: fallbackUser, error: fallbackUserError } = await admin
        .from('profiles')
        .select('id, email')
        .eq('email', 'emma@arcova.bio')
        .maybeSingle();

      if (fallbackUserError || !fallbackUser?.id) {
        return NextResponse.json({ error: 'Dev seed fallback user not found' }, { status: 404 });
      }

      return seedSignalsForUser(request, {
        id: fallbackUser.id,
        email: fallbackUser.email ?? 'emma@arcova.bio',
      });
    }

    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return seedSignalsForUser(request, {
      id: user.id,
      email: user.email ?? null,
    });
  } catch (error) {
    console.error('[seed-test-signals] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function seedSignalsForUser(
  request: Request,
  user: { id: string; email: string | null }
) {
  try {
    if (!isAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const companyIdParam = searchParams.get('companyId')?.trim() || null;
    const admin = createAdminClient();

    const companyQuery = admin
      .from('accounts_view')
      .select('id, company_name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: company, error: companyError } = companyIdParam
      ? await admin
          .from('accounts_view')
          .select('id, company_name')
          .eq('id', companyIdParam)
          .eq('user_id', user.id)
          .maybeSingle()
      : await companyQuery.maybeSingle();

    if (companyError || !company) {
      return NextResponse.json({ error: 'No company found for test signal seeding' }, { status: 404 });
    }

    const { data: contact } = await admin
      .from('contacts')
      .select('id, full_name')
      .eq('user_id', user.id)
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const companySignals = [
      {
        signalId: 'open_opportunity_in_crm',
        title: 'Open opportunity created in CRM',
        description: 'A live pipeline opportunity was opened for this account.',
        evidenceUrl: null,
      },
      {
        signalId: 'inbound_enquiry',
        title: 'Inbound enquiry received',
        description: 'The account reached out with direct buying interest.',
        evidenceUrl: null,
      },
    ] as const;

    const insertedCompanyRows = [];
    for (const signal of companySignals) {
      const row = await insertCompanySignalEvent(admin, {
        userId: user.id,
        companyId: company.id,
        signalId: signal.signalId,
        source: 'admin_seed_test_signals',
        title: signal.title,
        description: signal.description,
        evidenceUrl: signal.evidenceUrl,
        detectedAt: new Date().toISOString(),
        eventMetadata: { seeded_for_testing: true },
        rawPayload: { seeded_for_testing: true },
      });
      insertedCompanyRows.push(row);
    }

    const readinessCompanyResults = await Promise.all(
      insertedCompanyRows.map((row) =>
        mirrorSignalEventToReadiness(admin, user.id, row).catch((e) => {
          console.warn('[seed-test-signals] company readiness mirror skipped', e);
          return null;
        })
      )
    );

    let contactRow = null;
    let readinessContactResult = null;

    if (contact?.id) {
      contactRow = await insertContactSignalEvent(admin, {
        userId: user.id,
        contactId: contact.id,
        companyId: company.id,
        signalId: 'responded_to_a_previous_outreach',
        source: 'admin_seed_test_signals',
        title: 'Previous outreach got a response',
        description: 'A contact at this account replied to prior outreach.',
        evidenceUrl: null,
        detectedAt: new Date().toISOString(),
        eventMetadata: { seeded_for_testing: true },
        rawPayload: { seeded_for_testing: true },
      });

      readinessContactResult = await mirrorSignalEventToReadiness(admin, user.id, contactRow).catch((e) => {
        console.warn('[seed-test-signals] contact readiness mirror skipped', e);
        return null;
      });
    }

    return NextResponse.json({
      success: true,
      company,
      contact,
      inserted_company_signals: insertedCompanyRows,
      inserted_contact_signal: contactRow,
      readiness_company_results: readinessCompanyResults,
      readiness_contact_result: readinessContactResult,
    });
  } catch (error) {
    console.error('[seed-test-signals] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
