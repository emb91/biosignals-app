import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cronDir = join(root, 'app/api/cron');
const adminScript = 'scripts/refresh-monitoring-universes.ts';
const forbiddenCronPatterns = [
  /maybeRefreshMonitoringUniverses/,
  /monitoring-refresh/,
  /refresh_monitoring_universe/,
  /REFRESH_MONITORING_UNIVERSE/,
];

function routeFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...routeFiles(path));
    } else if (path.endsWith('/route.ts')) {
      files.push(path);
    }
  }
  return files;
}

const failures = [];
for (const file of routeFiles(cronDir)) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of forbiddenCronPatterns) {
    if (pattern.test(source)) {
      failures.push(`${file.replace(`${root}/`, '')} still contains ${pattern}`);
    }
  }
}

const adminSource = readFileSync(join(root, adminScript), 'utf8');
if (!adminSource.includes("from '@/lib/billing/monitoring'")) {
  failures.push(`${adminScript} should import the monitoring helper directly from lib/billing/monitoring`);
}
if (!adminSource.includes('refreshAllMonitoringUniverses')) {
  failures.push(`${adminScript} should call refreshAllMonitoringUniverses`);
}
if (!adminSource.includes('SUPABASE_SERVICE_ROLE_KEY')) {
  failures.push(`${adminScript} should require service-role credentials`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Monitoring refresh separation verified.');
