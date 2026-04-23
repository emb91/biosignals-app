# Arcova Session Bootstrap — 2026-04-20

## Current state

Arcova is still using Apollo as the pass-1 identity/contact layer.

The pipeline model has now been clarified as:

1. Pass 1: Apollo identity/contact
2. Pass 2: resolve the best LinkedIn URL
3. Pass 3: run Apify on that LinkedIn URL and compare back against Apollo

This distinction now exists in code and in the intended contact status fields.

## Current pass rules

### Pass 1

Trust Apollo for:
- person identity
- candidate email
- candidate phone if ever enabled later
- Apollo employment history as supporting context

Do not trust Apollo as current-role truth.

### Pass 2

LinkedIn resolution now works in this order:

1. Apollo `linkedin_url`
2. Anthropic/web search fallback

Important nuance:
- uploaded CSV LinkedIn URLs are no longer trusted directly
- an uploaded CSV LinkedIn URL is only passed into the Anthropic search as a low-confidence hint

This was changed because a fake CSV LinkedIn URL was successfully accepted for Michael Cross when Apollo had no LinkedIn.

### Pass 3

Apify is intended to:
- resolve fresher current company/title
- return employment history
- act as the fresher source of current context

Apollo is used as the cross-check for person certainty, not as the source of current role truth.

## Important product decision

Emails should no longer be treated as guaranteed current work emails.

They are now conceptually:
- candidate email from pass 1
- then reassessed after pass 3 once current company/domain is known

If the email domain does not match the resolved current company domain, Arcova should recommend not using the email until it is verified.

## What was implemented

### 1. LinkedIn resolution logic

File:
- `lib/linkedin-url-resolver.ts`

It now:
- prefers Apollo LinkedIn first
- does not directly trust CSV LinkedIn
- passes uploaded LinkedIn into the search prompt only as a hint
- uses Anthropic web search on LinkedIn when Apollo has no LinkedIn

### 2. Contact resolution pipeline

Files:
- `lib/pass2.ts`
- `lib/contact-resolution-pipeline.ts`
- `app/api/import-contacts/route.ts`
- `app/api/pass2/[id]/route.ts`

It now:
- models pass 2 as LinkedIn resolution
- models pass 3 as Apify enrichment + Apollo alignment
- sets or updates pass status fields conceptually as:
  - `pass1_status`
  - `pass2_status`
  - `pass3_status`

### 3. Import ingestion

File:
- `lib/import-ingestion.ts`

It now:
- initializes pass states on newly inserted contacts
- sets:
  - `pass1_status = completed`
  - `pass2_status = pending`
  - `pass3_status = pending`
- initializes email assessment fields as:
  - `email_status = candidate` when pass 1 returned an email
  - `email_status = missing` when no email was returned

### 4. Email stale/conflict logic

Files:
- `lib/pass2.ts`
- `app/api/leads/route.ts`
- `app/results/page.tsx`

It now:
- compares email domain vs resolved current company domain after pass 3
- marks email status as one of:
  - `aligned_current`
  - `candidate`
  - `stale_suspected`
  - `missing`
- shows the status in the Leads UI
- shows the reasoning in the contact-details drawer

### 5. Leads drawer cleanup

File:
- `app/results/page.tsx`

The drawer no longer shows fake/mock values.

It now shows:
- real email
- real last updated
- real LinkedIn if present
- blanks / placeholders where fields are not yet populated

This was important because the mock drawer had been making it look like contacts had LinkedIn URLs and richer detail even when the stored `contacts` row did not.

### 6. Temporary schema compatibility fallback

Files:
- `app/api/leads/route.ts`
- `lib/import-ingestion.ts`

Because the live Supabase schema does not yet include the new pass/email fields, compatibility fallbacks were added so:
- the Leads API retries without the new columns if they are missing
- contact upserts retry without the new columns if the DB rejects them

This keeps testing possible before the migration is applied.

## Very important blocker

The live Supabase schema is still missing the new migration.

Migration file:
- `supabase/migrations/20260418_add_pass2_resolution_fields.sql`

This migration now includes:
- `pass1_status`
- `email_status`
- `email_status_reasoning`
- `linkedin_resolution_source`
- `linkedin_resolution_confidence`
- `linkedin_resolution_summary`
- `pass2_status`
- `pass2_last_error`
- `pass2_started_at`
- `pass2_completed_at`
- `pass3_status`
- `pass3_provider`
- `pass3_last_error`
- `pass3_started_at`
- `pass3_completed_at`
- `apify_profile_raw`
- `apify_lookup_metadata`
- `pass3_alignment_metadata`
- `resolved_current_company_name`
- `resolved_current_company_domain`
- `resolved_current_job_title`
- `resolved_employment_history`
- `resolved_company_firmographics`

### Why it is not applied yet

It could not be applied from this environment because:
- there is no `supabase` CLI installed
- there is no `psql`
- `.env.local` only contains the Supabase URL and service-role key
- there is no direct Postgres connection string / DB password
- there is no Supabase management access token
- probing likely project-level SQL/meta endpoints on the project URL returned `404`

Conclusion:
- schema DDL must be applied from either:
  - the Supabase dashboard SQL editor, or
  - a machine with direct DB credentials / linked CLI access

## What was learned from testing

### Apollo LinkedIn coverage is patchy

From recent tests:
- Apollo had LinkedIn for Terry Pan
- Apollo had LinkedIn for Althea Fernandes
- Apollo did not have LinkedIn for Aisling Ogilvie
- Apollo did not have LinkedIn for Kurt Harris
- Apollo did not have LinkedIn for Kumar Bala
- Apollo did not have LinkedIn for Michael Cross

So Apollo is useful, but not sufficient as the only LinkedIn source.

### Fake CSV LinkedIn was accepted

Test:
- Michael Cross was uploaded with a fake LinkedIn-looking URL

Finding:
- before the resolver change, the fake CSV LinkedIn URL was accepted and stored

Decision:
- do not directly trust uploaded CSV LinkedIn URLs
- only use them as a hint in the fallback search

### Mock drawer caused confusion

The contact-details drawer had been generating fake LinkedIn-looking URLs from name slugs and mock work-history rows.

That made it look like some contacts had LinkedIn or richer detail when the canonical `contacts` row did not.

This has now been removed.

### Provider freshness problem still stands

Terry Pan remains the best example:
- LinkedIn suggests he has moved
- Apollo and even Clay still show old-company context in some tests

So:
- provider email should be treated as candidate contactability
- not guaranteed current truth

## Best next step

1. Apply `20260418_add_pass2_resolution_fields.sql` live in Supabase
2. Run a tiny test import again
3. Inspect:
   - `pass1_status`
   - `pass2_status`
   - `pass3_status`
   - `linkedin_resolution_source`
   - `linkedin_resolution_confidence`
   - `linkedin_resolution_summary`
   - `pass3_alignment_metadata`
   - `email_status`
   - `email_status_reasoning`
4. Confirm whether the Anthropic LinkedIn fallback is actually succeeding in live runs
5. Confirm whether Apify is configured and actually running

## Secondary next steps after migration

- Add a real `app/api/pass3/[id]/route.ts` manual trigger if desired
- Consider showing pass-state chips in the UI for debugging during development
- Once schema is live, remove temporary compatibility fallbacks that silently drop new fields

## Reminder before go-live

- restore the freemium enrichment cap (currently removed for testing)
- regenerate all test/development API keys before launch
- confirm Apollo/Anthropic/Apify credentials are production-safe
