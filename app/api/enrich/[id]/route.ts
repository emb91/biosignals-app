import { after, NextResponse } from 'next/server';
import { runContactResolutionPipelineForContact } from '@/lib/contact-resolution-pipeline';
import { createAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase-server';

type ContactJobRow = {
  id: string;
  linkedin_resolution_status: string | null;
  profile_enrichment_status: string | null;
};

function isLeadEnrichmentRunning(row: ContactJobRow | null): boolean {
  if (!row) return false;

  return (
    ['pending', 'processing'].includes(row.linkedin_resolution_status || '') ||
    ['pending', 'processing'].includes(row.profile_enrichment_status || '')
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: claimedRows, error: claimError } = await admin
      .from('contacts')
      .update({
        linkedin_resolution_status: 'processing',
        linkedin_resolution_started_at: now,
        linkedin_resolution_completed_at: null,
        linkedin_resolution_last_error: null,
        profile_enrichment_status: 'pending',
        profile_enrichment_started_at: null,
        profile_enrichment_completed_at: null,
        profile_enrichment_last_error: null,
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('id', id)
      .neq('linkedin_resolution_status', 'processing')
      .not('profile_enrichment_status', 'in', '(pending,processing)')
      .select('id, linkedin_resolution_status, profile_enrichment_status');

    if (claimError) {
      throw claimError;
    }

    if ((claimedRows || []).length > 0) {
      const backgroundTask = () =>
        runContactResolutionPipelineForContact(admin, {
          contactId: id,
          userId: user.id,
        });

      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          void backgroundTask();
        }, 0);
      } else {
        after(backgroundTask);
      }

      return NextResponse.json(
        {
          ok: true,
          alreadyRunning: false,
        },
        { status: 202 },
      );
    }

    const { data: current, error: currentError } = await admin
      .from('contacts')
      .select('id, linkedin_resolution_status, profile_enrichment_status')
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();

    if (currentError) {
      throw currentError;
    }

    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        alreadyRunning: isLeadEnrichmentRunning(current as ContactJobRow),
      },
      { status: 202 },
    );
  } catch (error) {
    console.error('Error in enrich POST:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
