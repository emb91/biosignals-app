import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  buildPersistedAccountReadinessContext,
  generateAccountReason,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';

/**
 * POST /api/readiness/recompute
 *
 * Internal/dev endpoint for exercising the new readiness pipeline for a single company.
 * This does not change any existing user-facing flow; it just recomputes readiness,
 * regenerates reason, and returns the assembled context payload.
 *
 * Body: { company_id: string }
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

    const body = (await request.json()) as { company_id?: string };
    const companyId = body.company_id?.trim();

    if (!companyId) {
      return NextResponse.json({ error: 'company_id required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id')
      .eq('id', companyId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (companyError || !company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const readiness = await recomputeAccountReadiness(supabase, {
      userId: user.id,
      companyId: company.id,
    });

    const reason = await generateAccountReason(supabase, {
      userId: user.id,
      companyId: company.id,
    });

    const context = await buildPersistedAccountReadinessContext(supabase, {
      userId: user.id,
      companyId: company.id,
    });

    return NextResponse.json({
      success: true,
      readiness,
      reason,
      context,
    });
  } catch (error) {
    console.error('[readiness/recompute] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

