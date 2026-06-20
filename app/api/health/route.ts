import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const startedAt = Date.now();
  try {
    const { error } = await createAdminClient()
      .from('organizations')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;

    return NextResponse.json(
      {
        ok: true,
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local',
        dependency: 'available',
        latencyMs: Date.now() - startedAt,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'local',
        dependency: 'unavailable',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}
