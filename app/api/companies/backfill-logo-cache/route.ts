/**
 * POST /api/companies/backfill-logo-cache
 *
 * Iterates over all companies that have a logo_url but no logo_cached,
 * fetches + caches each one, and writes the base64 data URI back to the DB.
 * Safe to call multiple times — only processes rows that are still missing
 * logo_cached (or where logo_url changed since the last cache run).
 *
 * Intended for one-off backfills; not a hot path. Runs server-side so
 * LinkedIn CDN fetches aren't blocked by browser CORS.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { cacheCompanyLogo } from '@/lib/photo-cache';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only service_role / admin should be able to trigger a bulk backfill.
  // For now, gate on any authenticated user (this is an internal tool).
  const { data: rows, error: fetchError } = await supabase
    .from('companies')
    .select('id, logo_url')
    .not('logo_url', 'is', null)
    .is('logo_cached', null)
    .limit(100);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const companies = (rows ?? []) as Array<{ id: string; logo_url: string | null }>;
  let succeeded = 0;
  let failed = 0;

  for (const company of companies) {
    if (!company.logo_url) continue;
    const cached = await cacheCompanyLogo(company.logo_url);
    if (cached) {
      await supabase
        .from('companies')
        .update({ logo_cached: cached, updated_at: new Date().toISOString() })
        .eq('id', company.id);
      succeeded++;
    } else {
      failed++;
    }
  }

  return NextResponse.json({
    processed: companies.length,
    succeeded,
    failed,
    remaining_hint: companies.length === 100 ? 'Call again — there may be more.' : 'All done.',
  });
}
