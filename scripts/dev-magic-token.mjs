// TEMP dev helper: mint a single-use magic-link token_hash for a user via the
// Supabase service-role admin API. Does NOT send an email (generateLink returns
// the token directly). Feed the printed token_hash to /auth/confirm in a browser:
//   /auth/confirm?token_hash=<hash>&type=magiclink&next=/accounts
// Run: node --env-file=.env.local scripts/dev-magic-token.mjs emma@arcova.bio
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2] || 'emma@arcova.bio';
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (error) {
  console.error('generateLink failed:', error.message);
  process.exit(1);
}
console.log(data?.properties?.hashed_token ?? '(no token)');
