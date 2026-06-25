/**
 * Admin-only maintenance script.
 *
 * Rebuilds Arcova's derived monitoring universe tables for every org, then
 * reconciles the shared account/contact sweep cadences. This is intentionally
 * not callable from signal cron routes; run it deliberately during engineering
 * maintenance after imports, billing fixes, or monitoring backfills.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/refresh-monitoring-universes.ts
 */
import { refreshAllMonitoringUniverses } from '@/lib/billing/monitoring';

const REQUIRED_ENV = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function assertServiceRoleEnvironment() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required service-role environment: ${missing.join(', ')}`);
  }
}

async function main() {
  assertServiceRoleEnvironment();
  console.log('[monitoring-refresh] rebuilding monitoring universes for all orgs...');
  const failures = await refreshAllMonitoringUniverses();
  if (failures.length === 0) {
    console.log('[monitoring-refresh] complete with no org failures.');
    return;
  }

  console.error(`[monitoring-refresh] ${failures.length} org refresh(es) failed:`);
  for (const failure of failures) {
    console.error(`- ${failure.org_id}: ${failure.error}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('[monitoring-refresh] fatal:', error);
  process.exit(1);
});
