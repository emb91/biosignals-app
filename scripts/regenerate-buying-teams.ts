/**
 * One-off: backfill the multi-persona buying groups onto the user's existing
 * ICPs. Regenerates buying teams from stored ICP data (no website re-scrape),
 * then re-scores all contacts once so each lands on its best-matching team.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/regenerate-buying-teams.ts
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { regenerateBuyingTeamsForIcp } from '@/lib/icp-reenrichment';
import { rescoreAllContactsForUser } from '@/lib/rescore';

const USER_ID = '3f166004-174b-4fc6-88f0-7cd47332f6ee';

async function main() {
  const admin = createAdminClient();
  const { data: icps } = await admin
    .from('icps')
    .select('id, name')
    .eq('user_id', USER_ID);

  console.log(`Regenerating buying teams for ${(icps ?? []).length} ICPs…`);
  for (const icp of (icps ?? []) as Array<{ id: string; name: string | null }>) {
    try {
      const r = await regenerateBuyingTeamsForIcp(USER_ID, icp.id);
      console.log(`  ${(icp.name ?? icp.id).padEnd(48)} → ${r.teams} team(s)`);
    } catch (e) {
      console.warn(`  ${(icp.name ?? icp.id).padEnd(48)} → FAIL: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log('Re-scoring all contacts against the new personas…');
  const res = await rescoreAllContactsForUser(USER_ID);
  console.log('  rescore:', JSON.stringify(res));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
