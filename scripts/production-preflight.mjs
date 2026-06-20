const required = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'LEMLIST_WEBHOOK_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'APIFY_API_KEY',
  'APOLLO_API_KEY',
  'ZEROBOUNCE_API_KEY',
  'NANGO_SECRET_KEY',
  'RESEND_API_KEY',
  'RESEND_AUTH_FROM',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_AUTH_TOKEN',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
];

const stripe = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_STARTER_WORKSPACE',
  'STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL',
  'STRIPE_PRICE_STARTER_CREDITS_1000',
  'STRIPE_PRICE_GROWTH_WORKSPACE',
  'STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL',
  'STRIPE_PRICE_GROWTH_CREDITS_1000',
];

const backup = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (process.env.ARCOVA_CREDIT_ENFORCEMENT === 'true' || process.env.STRIPE_SECRET_KEY) {
  missing.push(...stripe.filter((name) => !process.env[name]?.trim()));
}
if (process.env.HUBSPOT_BACKUP_REQUIRED !== 'false') {
  missing.push(...backup.filter((name) => !process.env[name]?.trim()));
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const invalidUrls = [appUrl, siteUrl]
  .filter(Boolean)
  .filter((value) => {
    try {
      return new URL(value).protocol !== 'https:';
    } catch {
      return true;
    }
  });

if (invalidUrls.length > 0) {
  console.error('Production URLs must be valid HTTPS URLs:', invalidUrls.join(', '));
  process.exitCode = 1;
}

for (const [name, value] of [
  ['NEXT_PUBLIC_APP_URL', appUrl],
  ['NEXT_PUBLIC_SITE_URL', siteUrl],
]) {
  if (value && /localhost|127\.0\.0\.1|vercel\.app/i.test(value)) {
    console.error(`${name} must use the production Arcova domain, not ${value}`);
    process.exitCode = 1;
  }
}

for (const name of ['CRON_SECRET', 'LEMLIST_WEBHOOK_TOKEN', 'STRIPE_WEBHOOK_SECRET']) {
  const value = process.env[name];
  if (value && value.length < 32) {
    console.error(`${name} must be at least 32 characters.`);
    process.exitCode = 1;
  }
}

if (process.env.REQUIRE_LIVE_BILLING === 'true') {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
    console.error('REQUIRE_LIVE_BILLING=true requires a live Stripe secret key.');
    process.exitCode = 1;
  }
  for (const name of stripe.filter((entry) => entry.startsWith('STRIPE_PRICE_'))) {
    if (!process.env[name]?.startsWith('price_')) {
      console.error(`${name} must be a Stripe price ID.`);
      process.exitCode = 1;
    }
  }
}

if (missing.length > 0) {
  console.error('Missing production environment variables:');
  for (const name of [...new Set(missing)].sort()) console.error(`- ${name}`);
  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log('Production environment preflight passed.');
}
