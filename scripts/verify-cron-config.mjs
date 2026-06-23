import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const seen = new Set();
const failures = [];

for (const cron of config.crons ?? []) {
  if (seen.has(cron.path)) failures.push(`Duplicate cron path: ${cron.path}`);
  seen.add(cron.path);

  const routeFile = path.join(root, 'app', cron.path, 'route.ts');
  if (!fs.existsSync(routeFile)) {
    failures.push(`Scheduled route does not exist: ${cron.path}`);
    continue;
  }

  const source = fs.readFileSync(routeFile, 'utf8');
  if (!source.includes('CRON_SECRET')) {
    failures.push(`Scheduled route does not check CRON_SECRET: ${cron.path}`);
  }
  if (/if\s*\(\s*!\s*(?:expected|cronSecret|process\.env\.CRON_SECRET)\s*\)\s*return\s+true/.test(source)) {
    failures.push(`Scheduled route fails open when CRON_SECRET is unset: ${cron.path}`);
  }
  if (!source.includes('observeCron')) {
    failures.push(`Scheduled route is missing run observability: ${cron.path}`);
  }
}

if (failures.length) {
  console.error('Cron configuration verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Cron configuration verified: ${seen.size} scheduled routes.`);
