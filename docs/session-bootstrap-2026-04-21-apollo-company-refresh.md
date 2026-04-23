# Arcova Session Bootstrap — 2026-04-21

## Current focus

The current work is on the Leads view enrichment pipeline, specifically the new second-pass Apollo company enrichment that runs after the Apify company scrape.

The intended model is now:

1. Apollo pass 1 for person/contact discovery
2. LinkedIn resolution for the person
3. Apify profile enrichment
4. Apify company enrichment from the resolved company LinkedIn URL
5. Apollo company enrichment from the resolved company domain
6. Display Apify for LinkedIn-derived presentation fields, but prefer Apollo for selected structured firmographics

## Important product rule

Apollo should only be preferred for selected structured company firmographics.

Apollo-preferred fields:
- `industry`
- `employee_count`
- `founded_year`
- `hq_city`
- `hq_country`
- `funding_stage`
- `total_funding_usd`
- `latest_funding_date`

Apify should remain preferred for LinkedIn-derived presentation fields:
- `description`
- `bio_summary`
- `tagline`
- `linkedin_url`
- `website`
- `logo_url`
- `follower_count`
- `specialties`
- company identity resolved from the LinkedIn scrape

This rule is now stated explicitly in both:
- [lib/enrichment-pipeline.ts](/Users/emma/biosignals-gtm-2026/biosignals-app/lib/enrichment-pipeline.ts:321)
- [app/results/page.tsx](/Users/emma/biosignals-gtm-2026/biosignals-app/app/results/page.tsx:121)

## What changed in code

### Backend

The enrichment pipeline now builds and stores three company-firmographic payloads on the contact row:
- `apify_company_firmographics`
- `apollo_company_firmographics`
- `resolved_company_firmographics`

It also tracks:
- `apify_company_firmographics_refreshed_at`
- `apollo_company_firmographics_refreshed_at`

Relevant files:
- [lib/apollo.ts](/Users/emma/biosignals-gtm-2026/biosignals-app/lib/apollo.ts:302)
- [lib/enrichment-pipeline.ts](/Users/emma/biosignals-gtm-2026/biosignals-app/lib/enrichment-pipeline.ts:773)

### Frontend

The Leads API now selects the new Apollo/Apify firmographic fields and the Results drawer now merges them explicitly at render time, rather than implicitly trusting one blob.

Relevant files:
- [app/api/leads/route.ts](/Users/emma/biosignals-gtm-2026/biosignals-app/app/api/leads/route.ts:52)
- [app/results/page.tsx](/Users/emma/biosignals-gtm-2026/biosignals-app/app/results/page.tsx:109)

The company panel now also shows:
- funding stage
- total funding
- latest funding date
- firmographics refresh date

## Database migration status

The required migration for source-separated company firmographics has now been applied to Supabase.

Migration:
- [supabase/migrations/20260421_split_company_firmographics_sources.sql](/Users/emma/biosignals-gtm-2026/biosignals-app/supabase/migrations/20260421_split_company_firmographics_sources.sql:1)

Applied to project:
- `sbubqrsycbledkxjumjg`

What it added on `public.contacts`:
- `apollo_company_firmographics`
- `apollo_company_firmographics_refreshed_at`
- `apify_company_firmographics`
- `apify_company_firmographics_refreshed_at`

It also backfills older `resolved_company_firmographics` into `apify_company_firmographics`.

## What happened with the stuck refresh

Terry Pan was refreshed before the migration was applied.

That refresh:
- started successfully
- marked the row as `profile_enrichment_status = processing`
- then failed when the pipeline attempted to write the new Apollo/Apify firmographic fields to a schema that did not yet have those columns

This left Terry stuck in `processing`.

After confirming the issue, the Supabase migration was applied and Terry was deleted from `public.contacts` so he can be reuploaded cleanly.

Important nuance:
- there was no active background worker to terminate
- the row was only stuck at the data/status level

## What recent refresh testing showed

Three recent contact refreshes were checked after the migration:
- Andrew Wilks
- Atlanta Daniel
- John Robson

Common pattern across all three:
- LinkedIn resolution completed
- profile enrichment completed or ambiguous
- Apify company enrichment definitely ran
- `apify_company_firmographics_refreshed_at` was populated
- `apollo_company_firmographics` remained `null`
- `apollo_company_firmographics_refreshed_at` remained `null`

Interpretation:
- the Apify company step is working
- the second Apollo company-enrichment step is not currently persisting output
- because that step is wrapped as non-fatal, the overall enrichment still completes, which makes the problem look invisible from the UI

## Important diagnostic finding

The old `apollo_organization_raw` field is still often populated from the earlier Apollo contact-discovery step, but that data is not reliable as evidence that the new second Apollo company-enrichment step succeeded.

Examples seen during debugging:
- Andrew Wilks: `apollo_organization_raw` matched `SYNthesis BioVentures`
- John Robson: `apollo_organization_raw` pointed to `BIOTech New Zealand`, not `BioOra`
- Atlanta Daniel: `apollo_organization_raw` pointed to `Radar Ventures`, not `Acumino`

So:
- `apollo_organization_raw` can be noisy or stale
- it should not be used as proof that the new Apollo company enrich worked
- it should not be treated as canonical company truth

## What is likely wrong now

The most likely current failure point is the second Apollo company-enrichment sub-step in [lib/enrichment-pipeline.ts](/Users/emma/biosignals-gtm-2026/biosignals-app/lib/enrichment-pipeline.ts:802).

Current behavior:
- the Apollo company enrich call is wrapped in a `try/catch`
- failures are only logged with `console.warn`
- no Apollo-specific error is persisted on the contact row
- the overall enrichment still ends as `completed` or `ambiguous`

That means the UI can look healthy even when the Apollo company sub-step is failing every time.

## Recommended next actions

1. Add explicit observability for the Apollo company-enrichment sub-step.
   Persist the attempted domain and a dedicated Apollo company error field on the contact row.

2. Make the pipeline store whether Apollo company enrichment was:
   - skipped
   - attempted and failed
   - attempted and succeeded

3. Decide whether `apollo_organization_raw` should remain as a pass-1 artifact only, rather than being mixed conceptually with the later Apollo company enrich.

4. Re-test a small set of contacts after the observability patch:
   - one straightforward biotech company
   - one ambiguous company
   - one company where Apollo is known to have funding/founded-year data

## Current confidence

High confidence:
- the migration issue that stranded Terry is resolved
- Apify company enrichment is working
- the frontend precedence rules are now explicit and correct

Open issue:
- the second Apollo company-enrichment step is still silently failing or silently skipping on refresh, and needs proper instrumentation before further trust can be placed in it
