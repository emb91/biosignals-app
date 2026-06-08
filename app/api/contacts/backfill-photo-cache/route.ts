import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { cacheProfilePhoto } from '@/lib/photo-cache';

// POST /api/contacts/backfill-photo-cache
// Fetches and caches profile photos for all people rows that have a
// profile_photo_url but no profile_photo_cached yet.
// Processes in batches to avoid timeouts — call repeatedly until done=true.
export async function POST(req: Request) {
  const supabase = createAdminClient();
  const body = await req.json().catch(() => ({}));
  const batchSize: number = Math.min(Number(body.batchSize) || 20, 50);

  const { data: rows, error } = await supabase
    .from('people')
    .select('id, profile_photo_url')
    .not('profile_photo_url', 'is', null)
    .is('profile_photo_cached', null)
    .limit(batchSize);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ done: true, processed: 0 });

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const cached = await cacheProfilePhoto(row.profile_photo_url!);
    if (cached) {
      await supabase.from('people').update({ profile_photo_cached: cached }).eq('id', row.id);
      ok++;
    } else {
      // Mark with empty string so we don't keep retrying an unfetchable URL
      await supabase.from('people').update({ profile_photo_cached: '' }).eq('id', row.id);
      failed++;
    }
  }

  return NextResponse.json({ done: rows.length < batchSize, processed: ok, failed });
}
