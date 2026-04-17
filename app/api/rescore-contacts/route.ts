import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { rescoreAllContactsForUser } from '@/lib/rescore';

/**
 * POST /api/rescore-contacts
 *
 * Triggers a full rescore of all contacts for the authenticated user against
 * their current persona profiles. Called automatically after a persona is
 * updated, or can be triggered manually from the UI.
 *
 * Returns immediately with a job count, or waits for completion if the
 * contact volume is small (< 500). For large volumes the caller should
 * treat this as fire-and-forget and poll the leads view for updated scores.
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

    const result = await rescoreAllContactsForUser(user.id);

    return NextResponse.json({
      success: true,
      rescored: result.rescored,
      failed: result.failed,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error('Error in rescore-contacts POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
