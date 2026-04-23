# Arcova Session Bootstrap — 2026-03-24

## Where we are

### Database (Supabase: sbubqrsycbledkxjumjg)
All tables live:
- `personas` — renamed from old `contacts` — stores persona configs (1 row, user's existing persona)
- `contacts` — new leads table (imported + future discovered contacts)
- `companies` — enriched company records
- `signals` — intent signal events
- `raw_uploads` — CSV import buffer/audit trail
- `upload_batches` — import batch tracking

### Import pipeline — built, not yet tested end-to-end
- `app/api/import-contacts/route.ts` — creates upload_batches record, inserts to raw_uploads, dedupes against contacts, sends to Clay in batches of 100 with 1s delay
- `app/api/import-clay-callback/route.ts` — receives enriched records from Clay, dedupes, scores against personas, upserts to contacts, updates batch progress
- `app/api/import-status/route.ts` — polls raw_uploads by batch_id
- `lib/scoring.ts` — fit scoring: job title (40%), seniority (35%), business area (25%), returns 0–1

### Leads view — built
- `app/results/page.tsx` — ranked table, score bars (fit/intent/priority), search, pagination
- `app/api/leads/route.ts` — paginated contacts ordered by priority_score DESC

### Clay
- Webhook URL: `https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-eed17fbb-3f54-432e-85dd-41083f6f054e`
- Set in `.env.local` as `CLAY_IMPORT_WEBHOOK_URL`
- `IMPORT_WEBHOOK_SECRET=arcova-clay-callback-secret`
- Clay table created but enrichment columns NOT yet configured
- Clay HTTP callback action NOT yet configured (needs app's deployed URL + secret header)
- Emma is on Clay legacy plan ($349/month) — full API + webhook connectivity

### Env file complete at `.env.local`

## Active discussion at end of session

**Fit scoring architecture** — how to model ICP/persona and score contacts against it.

Key points agreed:
- Scoring happens in the APP (not Clay) — Clay does enrichment, app does scoring
- Clay callback triggers scoring for new contacts
- Persona updates need to trigger RESCORE of all existing contacts (not yet built)
- Score is 0–100 (current scoring.ts returns 0–1, multiply ×100)
- Current weights: job title 40%, seniority 35%, business area 25% — weights TBD based on what's most discriminating in life sciences BD

**Open question Emma was answering:** In your personas, what criteria are most discriminating — seniority, function/team, or specific job titles? This determines scoring weights.

## Next steps
1. Emma to configure enrichment columns in Clay table (what signals to pull)
2. Emma to configure HTTP callback action in Clay (URL + x-import-webhook-secret header)
3. Decide scoring weights based on persona criteria
4. Update callback handler to write signal events to `signals` table + calculate real intent_score
5. Build rescore trigger: when persona is updated → rescore all contacts for that user
6. End-to-end test: upload small CSV → Clay enriches → callback → contacts appear in Leads view

## Key decisions made
- Clay is non-negotiable enrichment layer for P1
- P2 (discover new contacts from Crunchbase/EDGAR) parked until P1 validated
- US-only customers — GDPR not a concern
- Scoring in app, not Clay
- `intent_score` defaults to 1.0 until real signal data flows (multiplied by fit_score = priority_score = fit_score initially)
