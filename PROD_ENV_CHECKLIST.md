# Production Environment Variables — Vercel (biosignals-app)

Checklist for the `biosignals-app` Vercel project (Production environment). Non-secret values
are pre-filled; secrets are left blank with a link to generate/mint a fresh **prod** credential.

Known IDs: Supabase project `sbubqrsycbledkxjumjg` · Stripe account `acct_1ThdlWRtS8JGduGe`
· Sentry `arcova-bio-ltd / javascript-react`.

- ⚠️ = prod value differs from `.env.local` (which holds dev/test values).
- Self-generated secrets: run `openssl rand -hex 32` and paste the output.
- Do not paste secrets into git — this file is a checklist, fill values in Vercel only.

---

## A. Core platform — required
```
NEXT_PUBLIC_APP_URL=https://arcova.bio          # ⚠️ local is http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=                        # https://supabase.com/dashboard/project/sbubqrsycbledkxjumjg/settings/api
NEXT_PUBLIC_SUPABASE_ANON_KEY=                   # ↑ same page
SUPABASE_SERVICE_ROLE_KEY=                       # ↑ same page (reveal service_role)
CRON_SECRET=                                     # self-generate: openssl rand -hex 32
ANTHROPIC_API_KEY=                               # https://console.anthropic.com/settings/keys
```
- [ ] A complete

## B. Stripe — ⚠️ LIVE mode (not the sk_test_ values in .env.local)
```
STRIPE_SECRET_KEY=                               # https://dashboard.stripe.com/apikeys (toggle Live)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=              # ↑ same page (pk_live_…) — optional, no client refs yet
STRIPE_WEBHOOK_SECRET=                           # https://dashboard.stripe.com/webhooks → create endpoint → reveal whsec_
STRIPE_WEBHOOK_SECRET_TEST=                      # Optional: test-mode destination secret for validating test events on prod URL
# Live price IDs (already created — pre-filled):
STRIPE_PRICE_STARTER_WORKSPACE=price_1TkNrfRtS8JGduGexjNJpdWG
STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL=price_1TkNrnRtS8JGduGeRjvkGayp
STRIPE_PRICE_GROWTH_WORKSPACE=price_1TkNrqRtS8JGduGeBaZzDhhC
STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL=price_1TkNrwRtS8JGduGeDzGg88vn
STRIPE_PRICE_STARTER_CREDITS_1000=price_1TkNs2RtS8JGduGeYRwOx3hB
STRIPE_PRICE_GROWTH_CREDITS_1000=price_1TkNs5RtS8JGduGeUIuSHITY
```
- Live webhook URL to register: `https://app.arcova.bio/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`
- [ ] B complete

## C. Auth & transactional email — required
```
RESEND_API_KEY=                                  # https://resend.com/api-keys
RESEND_AUTH_FROM=                                # verified sender — https://resend.com/domains
```
- Note: Supabase auth-email SMTP is configured in the Supabase dashboard, not Vercel.
- [ ] C complete

## D. CAPTCHA — required for public launch
```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=                  # https://dash.cloudflare.com/?to=/:account/turnstile (widget for arcova.bio)
TURNSTILE_SECRET_KEY=                            # ↑ same widget
```
- [ ] D complete

## E. Integrations & enrichment — set the features you run in prod
```
HUBSPOT_CLIENT_ID=                               # https://app.hubspot.com/developer (your app → Auth)
HUBSPOT_CLIENT_SECRET=                           # ↑ same app
NANGO_SECRET_KEY=                                # https://app.nango.dev → Prod environment → Settings
APOLLO_API_KEY=                                  # https://app.apollo.io/#/settings/integrations/api
APIFY_API_KEY=                                   # https://console.apify.com/settings/integrations
ZEROBOUNCE_API_KEY=                              # https://www.zerobounce.net/members/apikey
OPENROUTER_API_KEY=                              # https://openrouter.ai/keys
OPENFDA_API_KEY=                                 # https://open.fda.gov/apis/authentication/
NCBI_API_KEY=                                    # https://www.ncbi.nlm.nih.gov/account/settings/
GCP_PROJECT_ID=                                  # https://console.cloud.google.com/ (project picker)
GCP_SA_KEY_BASE64=                               # IAM service account key (JSON) → base64 -i key.json
R2_ACCOUNT_ID=                                   # https://dash.cloudflare.com/?to=/:account/r2/overview
R2_ACCESS_KEY_ID=                                # https://dash.cloudflare.com/?to=/:account/r2/api-tokens
R2_SECRET_ACCESS_KEY=                            # ↑ same token
R2_BUCKET=arcova-backups
# (Airtable removed. Contact form now writes to Supabase contact_submissions and
#  emails via Resend: a team notification plus an acknowledgment to the sender.
#  Optional overrides: CONTACT_NOTIFY_EMAIL (recipient, default emma@arcova.bio)
#  and CONTACT_BOOKING_URL (acknowledgment booking link, default the Calendly URL).)
CLAY_IMPORT_WEBHOOK_URL=                         # from your Clay table webhook source — https://app.clay.com
IMPORT_WEBHOOK_SECRET=                           # self-generate: openssl rand -hex 32
LEMLIST_WEBHOOK_TOKEN=                           # self-generate, set same value in https://app.lemlist.com/settings
APOLLO_PHONE_WEBHOOK_URL=https://arcova.bio/api/apollo/phone-webhook/  # append your token
SEC_REQUEST_HEADER=Arcova Bio admin@arcova.bio   # SEC EDGAR User-Agent (set a real contact email)
```
- [ ] E complete

## F. Observability — recommended
```
NEXT_PUBLIC_SENTRY_DSN=https://e7c3f7868fd289c558b4b7ae9c15c8cb@o4511566936014848.ingest.de.sentry.io/4511566937522256
SENTRY_ORG=arcova-bio-ltd
SENTRY_PROJECT=javascript-react
SENTRY_AUTH_TOKEN=                               # https://arcova-bio-ltd.sentry.io/settings/auth-tokens/ (scope: project:releases)
NEXT_PUBLIC_POSTHOG_KEY=                         # https://us.posthog.com/settings/project (Project API Key, phc_…)
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```
- [ ] F complete

## G. Flags / tuning — optional (only set to override a code default)
```
# ARCOVA_CREDIT_ENFORCEMENT=false                # leave unset/false until reconciliation is done
# ARCOVA_CREDIT_ENFORCEMENT_ACTIONS=
# ENRICHMENT_PROVIDER=
# NEXT_PUBLIC_SITE_URL=https://arcova.bio        # defaults to https://arcova.bio
# ADMIN_EMAILS=emma@arcova.bio                   # defaults to emma@arcova.bio
# HUBSPOT_BACKUP_REQUIRED=
# DATA_ACQUISITION_INTERNAL_SAFETY_CAP_ENABLED=
# APIFY_COMPANY_UNIT_PRICE_USD=
# APOLLO_REVEAL_PERSONAL_EMAILS_WHEN_MISSING=
# *_DISPATCH_LIMIT / *_QUEUE_BATCH / EMAIL_VERIFICATION_* / ZEROBOUNCE_* knobs
```

## H. Do NOT add to prod
- Vercel auto-injects: `NODE_ENV`, `CI`, `VERCEL_GIT_COMMIT_SHA`, `NEXT_DIST_DIR`
- Dev-only: `NEXT_PUBLIC_DEV_SETUP_*`
- Test/script-only: `REQUIRE_LIVE_BILLING`, `STRIPE_LIFECYCLE_BASE_URL`
