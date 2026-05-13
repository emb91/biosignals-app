import { after, NextResponse } from 'next/server';
import {
  claimIcpReenrichment,
  runIcpReenrichmentJob,
} from '@/lib/icp-reenrichment';
import { createClient } from '@/lib/supabase-server';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const claim = await claimIcpReenrichment(user.id, id);

    if (claim.state === 'not_found') {
      return NextResponse.json({ error: 'ICP not found' }, { status: 404 });
    }

    if (claim.state === 'claimed') {
      const backgroundTask = () =>
        runIcpReenrichmentJob({
          icpId: id,
          userId: user.id,
        });

      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => {
          void backgroundTask();
        }, 0);
      } else {
        after(backgroundTask);
      }
    }

    return NextResponse.json(
      {
        data: claim.icp,
        alreadyRunning: claim.state === 'already_running',
      },
      { status: 202 },
    );
  } catch (error) {
    console.error('Error in POST /api/icps/[id]/reenrich:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}
