# Arcova — Technical Brief
## For implementation handoff to Codex / external engineers

---

## 1. What Arcova Is

Arcova is a B2B sales intelligence platform for life sciences. It helps commercial teams at biotech/pharma service companies (CROs, CDMOs, biotech tools vendors) identify and prioritise which contacts to reach out to, based on how well they match the user's ideal customer profile and how much buying intent they're showing.

The core product loop:
1. User defines **personas** (who they want to sell to — job title, seniority, business function)
2. User imports a **contact list** (CSV from LinkedIn Sales Navigator, HubSpot, Apollo etc.)
3. Contacts are **enriched** via an external data provider (originally Clay)
4. An **LLM scores each contact** for fit against the user's personas (0–1 fit score)
5. Contacts are **ranked by priority** (fit × intent) in the Leads view
6. As **signals** arrive (funding rounds, clinical trial registrations, job changes), the intent score updates and contacts re-rank

This is a Next.js 14 App Router application backed by Supabase (Postgres + RLS). Deployed on Vercel.

---

## 2. What Has Been Built

### 2.1 Database (Supabase / Postgres)

All tables have RLS enabled. All queries are scoped by `user_id`.

#### `personas` (previously called `contacts` — renamed)
Stores the user's buyer persona configurations. Each persona defines who the user wants to reach.

Key columns: `id`, `user_id`, `name`, `functions` (jsonb array of `{name, weight}`), `seniority_levels` (text[]), `job_titles` (text[]), `signals` (text[]), `icp_id`

#### `contacts` (the leads table — new)
Stores individual enriched contact/lead records imported by the user.

Key columns:
- Identity: `id`, `user_id`, `company_id`, `batch_id`, `raw_upload_id`
- Person: `linkedin_url`, `email`, `full_name`, `first_name`, `last_name`, `profile_photo_url`
- Role: `job_title` (raw), `job_title_standardised` (Clay AI-cleaned), `seniority_level`, `business_area`, `headline` (LinkedIn headline)
- Location: `location` (raw), `city`, `country`
- Tenure: `years_in_current_role`
- Company (denormalised): `company_name`, `company_domain`, `company_linkedin_url`
- Scores: company fit, contact fit, readiness, and priority are now stored as mirrors of the org/contact scoring pipeline. Contact priority is `min(companyFit, contactFit) × (0.5 + 0.5 × effectiveReadiness)`, where effective readiness combines account and contact readiness.
- Fit detail: `fit_score_reasoning` (text), `fit_score_matched_on` (text[]), `fit_score_gaps` (text), `scored_against_persona_id` (uuid FK → personas)
- Meta: `source`, `last_enriched_at`, `created_at`, `updated_at`

Unique constraint: `(user_id, linkedin_url)`

**Important:** `priority_score` is a denormalized mirror, not the scoring policy itself. Recompute through the shared priority helpers / database refresh functions; do not hand-code a new formula in API routes.

#### `companies`
Enriched company records. Deduplicated by `(user_id, domain)`.

Key columns: `id`, `user_id`, `domain`, `company_name`, `website`, `description`, `industry`, `sub_industry`, `employee_count`, `employee_range`, `founded_year`, `headquarters_city`, `headquarters_country`, `funding_stage`, `total_funding_usd`, `latest_funding_date`, `technologies` (text[]), `therapeutic_areas` (text[]), `modalities` (text[]), `clinical_stage`, `fit_score`, `intent_score`, `source`, `last_enriched_at`

Unique constraint: `(user_id, domain)`

#### `upload_batches`
Tracks each CSV import job. Used for progress display.

Key columns: `id`, `user_id`, `filename`, `total_rows`, `processed_rows`, `duplicate_rows`, `failed_rows`, `status` (pending/processing/complete/failed)

#### `raw_uploads`
One row per contact from a CSV upload, before enrichment.

Key columns: `id`, `user_id`, `batch_id`, `full_name`, `email`, `linkedin_url`, `company_name`, `raw_data` (jsonb), `status` (pending/sent_to_clay/enriched/duplicate/failed), `enriched_at`

#### `signals`
Time-series events indicating buying intent. **Not yet populated** — infrastructure exists, scoring is hardcoded to 1.0 pending signal ingestion.

Key columns: `id`, `user_id`, `company_id`, `contact_id`, `signal_type`, `source`, `source_url`, `title`, `summary`, `occurred_at`

Signal types: `clinical_trial_update`, `funding_round`, `hiring_surge`, `exec_change`, `product_launch`, `partnership`, `regulatory_filing`, `news_mention`, `conference_attendance`

Dedup key: `(user_id, source_url)`

---

### 2.2 API Routes

#### `POST /api/import-contacts`
Accepts a CSV (as parsed headers/rows/columnMappings JSON), creates an `upload_batches` record, inserts rows into `raw_uploads`, deduplicates against existing contacts, and forwards non-duplicate rows to the enrichment provider.

Current enrichment provider: Clay webhook (fire-and-forget, batched at 100 rows).

Mappable import fields: `first_name`, `last_name`, `full_name`, `company_name`, `job_title`, `email_address`, `linkedin_url`, `company_linkedin_url`

Missing mappable fields that should be added: `location`, `company_domain`

#### `POST /api/import-clay-callback`
Receives enriched contact data back from Clay, runs LLM fit scoring, upserts to `contacts` and `companies` tables.

Key behaviours:
- Accepts `{ records: [...] }` array or single record
- Second dedup pass against existing contacts
- Calls `scoreContacts()` from `lib/scoring.ts` for all non-duplicate records (batched 10/call)
- Falls back to score=0 if LLM fails — records still land in DB
- Upserts company via `upsertCompany()` helper (keyed on `user_id + domain`)
- Links contact to company via `company_id`
- Updates `upload_batches` progress counts

#### `GET /api/leads`
Paginated, ordered by `priority_score DESC` then `fit_score DESC`. Supports search across `full_name`, `company_name`, `job_title`. Returns `total` for pagination.

#### `POST /api/rescore-contacts`
Triggers a full rescore of all contacts for the authenticated user against their current personas. Calls `rescoreAllContactsForUser()` from `lib/rescore.ts`. Fire-and-forget safe.

Called automatically after persona create/update. Can also be triggered manually.

#### `GET /api/contacts` + `POST /api/contacts`
CRUD for persona profiles (note: these operate on the `personas` table, NOT the contacts/leads table — naming is confusing but intentional for legacy reasons). After persona create/update, fires rescore of all contacts.

#### `GET/PUT/DELETE /api/contacts/[id]`
Single persona CRUD. PUT fires background rescore.

#### `GET /api/import-status`
Returns `upload_batches` record by ID. Used for progress polling.

---

### 2.3 Core Libraries

#### `lib/scoring.ts`
LLM-based fit scoring. Uses `@anthropic-ai/sdk` with Claude Haiku (`claude-haiku-4-5-20251001`).

**Key design decisions:**
- Batches up to 10 contacts per API call to control cost and latency
- Does NOT do keyword matching — the LLM reasons through title equivalences ("Chief Scientific Officer" = "Head of Scientific Affairs" = "CSO")
- Includes `headline` (LinkedIn headline) in the prompt — critical for edge cases where raw title is ambiguous
- Returns `FitScoreResult`: `{ score (0-100), score_normalised (0-1), reasoning, matched_on[], gaps, persona_id, persona_name }`
- Falls back gracefully if API fails

**Persona form taxonomies (must match exactly in prompts and scoring):**

Seniority levels (exact strings):
`C-Level`, `VP / SVP`, `Director`, `Head of / Senior Manager`, `Manager`, `Individual Contributor`

Business areas / teams (exact strings):
`Executive Leadership`, `Business Development`, `Partnerships`, `Clinical Operations`, `Research & Development`, `Regulatory Affairs`, `Manufacturing & CMC`, `Medical Affairs`, `Commercial`, `Sales Operations`, `Procurement`, `Strategy & Corporate Development`, `Lab Operations`, `Technology & Systems`, `AI & Machine Learning`, `Data & Informatics`, `Quality & Compliance`, `Marketing`

These taxonomies must be used consistently in: LLM prompts, enrichment column prompts, persona form UI options, and scoring comparison logic.

#### `lib/rescore.ts`
Bulk rescoring utility. Uses a Supabase service-role client (bypasses RLS). Pages through contacts 100 at a time, scores via `scoreContacts()`, updates fit fields in bulk. Safe to call fire-and-forget.

Requires env var: `SUPABASE_SERVICE_ROLE_KEY`

#### `lib/supabase-server.ts`
Creates a cookie-based Supabase client for authenticated server-side use (uses anon key + user session).

---

### 2.4 Frontend

#### `app/results/page.tsx` — Leads View
Ranked table of enriched contacts ordered by priority score. Features:
- Score bars for fit, intent, and priority
- Search with debounce across name/company/title
- Pagination
- LinkedIn external link per row
- Empty state prompts to import

#### `components/PersonaForm.tsx`
The persona builder. Multi-select buttons for seniority and business area. Role suggestions are filtered by selected seniority and business area. Users can add free-text custom roles.

---

## 3. Current Enrichment Architecture (Clay — to be replaced)

The original enrichment flow uses Clay as a middleware:

```
CSV Import → raw_uploads → Clay webhook → Clay enriches → HTTP callback → contacts table
```

Clay was configured to:
1. Receive raw contact rows via inbound webhook
2. Find LinkedIn URL (if not provided)
3. Enrich person data (LinkedIn Person enrichment)
4. Run AI columns to classify: `job_title_standardised`, `seniority_level`, `business_area`
5. Enrich company data (LinkedIn Company + Crunchbase)
6. Run AI columns for life sciences: `company_therapeutic_areas`, `company_modalities`, `company_clinical_stage`
7. Send enriched row back via HTTP callback to `/api/import-clay-callback`

**Clay Clay AI column prompts (copy exactly if continuing with Clay):**

`seniority_level`:
> "Given the job title '{{job_title}}', classify the seniority as exactly one of: C-Level, VP / SVP, Director, Head of / Senior Manager, Manager, Individual Contributor. Return only the classification, nothing else."

`business_area`:
> "Given the job title '{{job_title}}' at a life sciences / biopharma company, classify which team or function this person works in. Choose exactly one from: Executive Leadership, Business Development, Partnerships, Clinical Operations, Research & Development, Regulatory Affairs, Manufacturing & CMC, Medical Affairs, Commercial, Sales Operations, Procurement, Strategy & Corporate Development, Lab Operations, Technology & Systems, AI & Machine Learning, Data & Informatics, Quality & Compliance, Marketing. Return only the classification, nothing else."

`job_title_standardised`:
> "Given the raw job title '{{job_title}}' at a life sciences company, return a clean standardised version. Expand abbreviations, remove location/region qualifiers, use full words. Return only the standardised title, nothing else."

`company_therapeutic_areas`:
> "Based on this company description: '{{company_description}}' and company name: '{{company_name}}', list the therapeutic areas this company works in. Choose only from: Oncology, Rare Disease, Neurology / CNS, Immunology, Infectious Disease, Cardiovascular, Metabolic / Endocrinology, Ophthalmology, Dermatology, Respiratory, Haematology, Musculoskeletal, Gastroenterology, Women's Health, Pain, Gene Editing, Diagnostics, Multi-therapeutic. Return as a comma-separated list."

`company_modalities`:
> "Based on this company description: '{{company_description}}' and company name: '{{company_name}}', list the drug modalities this company uses. Choose only from: Small Molecule, Biologic (Antibody), Bispecific Antibody, ADC, Cell Therapy, Gene Therapy, RNA Therapy, Peptide, Oligonucleotide, Radiopharmaceutical, Protein / Enzyme Replacement, Gene Editing (CRISPR), Microbiome, Biosimilar, Vaccine, Diagnostics, Liquid Biopsy, Digital Therapeutics, Biomarker, Imaging. Return as a comma-separated list."

> Software / product type should be captured separately in `platform_category`, not in modalities.

`company_clinical_stage`:
> "Based on this company description: '{{company_description}}' and company name: '{{company_name}}', classify the furthest clinical stage this company has reached. Choose exactly one from: Preclinical, Phase 1, Phase 2, Phase 3, Approved / Commercial, Platform Only, Research Tools / Services. Return only the classification."

---

## 4. Enrichment Provider

Enrichment runs via **Apollo** (person/contact identity + company firmographics) and **Apify / HarvestAPI** (LinkedIn profile + company scraping), called inline from the contact-resolution pipeline rather than through an external workflow tool with callbacks.

---

## 5. What Needs Focus Next (Priority Order)

### 5.1 Enrichment (implemented)
Enrichment runs via Apollo + Apify (see Section 4).

### 5.2 Import field expansion
Add `location` and `company_domain` as mappable import fields (they appear in common CSV exports like LinkedIn Sales Navigator but aren't currently accepted). Update `app/api/import-contacts/route.ts`.

### 5.3 Signal ingestion — intent scoring (P1, not P2)
The `signals` table exists and the `intent_score` column exists, but intent is hardcoded to `1.0`. This needs to be real.

Signal sources planned for P1:
- **EDGAR** — SEC Form D filings (funding signals)
- **ClinicalTrials.gov** — new trial registrations
- **Crunchbase** — funding rounds

Each signal should: write a row to `signals`, trigger `intent_score` recalculation for the associated company and its contacts. Intent score should be a function of recency, signal type weight, and volume.

The Arcova plugin (installed in Cowork) has a full spec for this in:
- `skills/clay-arcova-workflow/references/table-schemas.md`
- `skills/clay-arcova-workflow/references/enrichment-columns.md`

### 5.4 Persona form — taxonomy alignment
The `seniority_level` and `business_area` values classified by the enrichment provider must match exactly the options shown in `components/PersonaForm.tsx`. Currently there are minor discrepancies between what the form shows and what old plugin files specify. The persona form taxonomy is the source of truth.

### 5.5 `rescore-contacts` — trigger on signal
When a new signal is ingested for a company, intent scores should update and contacts should re-rank. Wire signal ingestion → intent recalculation → `priority_score` updates.

---

## 6. Future Considerations (Phase 2+)

### 6.1 Net-new contact discovery (Phase 2)
Phase 2 is finding contacts the user hasn't imported — proactive prospecting. This is a fundamentally different capability from the current import-and-enrich flow. It requires:
- Defining search criteria (persona + signals = "find me BD Directors at companies that just filed a Form D in oncology")
- Querying enrichment / discovery APIs to find matching profiles
- Presenting results as a separate discovery queue (not mixed with imported leads)

### 6.2 Company-level scoring
Currently only contacts are scored. Companies should also be scored against an ICP (Ideal Customer Profile). The `companies` table has `fit_score` and `intent_score` columns ready. The scoring logic needs to be extended to operate at company level, then aggregate/propagate to contacts at that company.

### 6.3 pgvector / semantic search
Currently parked. May become useful when signal volumes grow large enough that retrieval (rather than brute-force comparison) is needed. The scoring architecture is designed to accommodate this without schema changes.

### 6.4 Multi-user / team features
All data is currently scoped to individual users via `user_id`. Team sharing, shared personas, and shared lead lists will require a `team_id` abstraction layer above `user_id`. Not started.

### 6.5 Email sequencing integration
The leads view shows ranked contacts. The next step is integrating with outreach tooling (HubSpot sequences, Apollo, Outreach) to push prioritised contacts into sequences. Not started.

---

## 7. Environment Variables Required

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # Required for lib/rescore.ts (bypasses RLS)
ANTHROPIC_API_KEY=                  # Required for lib/scoring.ts
CLAY_IMPORT_WEBHOOK_URL=            # Clay inbound webhook (legacy)
IMPORT_WEBHOOK_SECRET=              # Shared secret for Clay callback auth header
```

---

## 8. Key Files

| File | Purpose |
|------|---------|
| `lib/scoring.ts` | LLM fit scoring engine (Claude Haiku, batch 10) |
| `lib/rescore.ts` | Bulk rescore all contacts for a user |
| `app/api/import-contacts/route.ts` | CSV import → enrichment provider |
| `app/api/import-clay-callback/route.ts` | Enrichment callback → score → store |
| `app/api/leads/route.ts` | Paginated ranked leads |
| `app/api/rescore-contacts/route.ts` | Manual/triggered rescore endpoint |
| `app/api/contacts/route.ts` | Persona CRUD (note: queries `personas` table) |
| `app/api/contacts/[id]/route.ts` | Single persona CRUD + fires rescore |
| `app/results/page.tsx` | Leads view UI |
| `components/PersonaForm.tsx` | Persona builder (source of truth for taxonomies) |
| `lib/supabase-server.ts` | Cookie-based Supabase client |
| `docs/test-data/template-contacts.csv` | 89 real US life sciences contacts for testing |
| `docs/test-data/send-5-rows.sh` | Shell script to push 5 test rows to enrichment webhook |

---

## 9. Nuances to Preserve

- **Scoring is the product.** The LLM scoring is not keyword matching — it reasons about semantic equivalence of job titles in life sciences. Do not replace with deterministic logic.
- **Headline matters.** The LinkedIn `headline` field (e.g. "Head of Clinical Operations | ex-Pfizer | mRNA") is included in the scoring prompt and meaningfully improves accuracy for edge cases.
- **Taxonomy must be exact.** `seniority_level` and `business_area` values from enrichment must match the persona form taxonomy character-for-character. Any drift silently breaks scoring.
- **Priority score is policy-backed.** Contact priority uses the weaker of company fit and contact fit as the fit floor, then applies the readiness boost. Treat stored `priority_score` as a mirror that can be refreshed, not as a place to invent or preserve alternate formulas.
- **Two dedup passes.** First dedup is at import time (before enrichment). Second dedup is at callback time (after enrichment, before scoring). Both are necessary because enrichment can surface a LinkedIn URL that reveals a duplicate not caught on raw name alone.
- **Rescore is fire-and-forget.** When a persona changes, all contacts are rescored in the background. The response to the persona save does not wait for rescoring to complete.
- **intent_score is a placeholder.** Currently hardcoded to `1.0`. The column and schema are ready for real signal-based intent scoring but it is not yet implemented.
- **All customers are US-based in v1.** Location parsing, defaults, and any future compliance considerations should assume US.
- **Companies table is separate.** One company row per domain per user. Contacts link to companies via `company_id` FK. The contacts table denormalises `company_name`, `company_domain`, and `company_linkedin_url` for query convenience without joins.
