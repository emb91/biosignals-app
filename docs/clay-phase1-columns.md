# Clay Phase 1 — Firmographic Column Setup

This document covers the columns to configure in your Clay contacts table for Phase 1.
**No signals yet** — this phase captures clean person and company base data only.
Signals are Phase 2 and will need their own deliberate design.

---

## Overview

Clay enriches each row with two categories of data:

- **Person fields** — about the individual contact (LinkedIn profile data)
- **Company fields** — about their employer (company LinkedIn / website / Crunchbase)

Both come back in the same Clay row. Arcova's callback splits them: person fields land on the `contacts` table, company fields upsert into the `companies` table, and the contact is linked via `company_id`.

---

## Person columns to add in Clay

These map to the `contacts` table. Most come from Clay's **LinkedIn Person Enrichment** provider.

| Clay column name | Clay enrichment source | Maps to DB column | Notes |
|---|---|---|---|
| `headline` | LinkedIn Person | `headline` | e.g. "CSO \| ex-Roche \| Gene Therapy" — fed directly into fit scoring |
| `job_title_standardised` | Clay AI column (prompt below) | `job_title_standardised` | Cleaned version of raw title for scoring |
| `seniority_level` | Clay AI column (prompt below) | `seniority_level` | Must match persona form taxonomy exactly |
| `business_area` | Clay AI column (prompt below) | `business_area` | Must match persona form taxonomy exactly |
| `city` | LinkedIn Person | `city` | Parsed city only (not full location string) |
| `country` | LinkedIn Person | `country` | Parsed country |
| `years_in_current_role` | LinkedIn Person | `years_in_current_role` | How long they've been in their current position |
| `profile_photo_url` | LinkedIn Person | `profile_photo_url` | For the Leads view contact card |

> The following are pass-through fields sent from the app into Clay and returned as-is:
> `full_name`, `first_name`, `last_name`, `email`, `linkedin_url`, `job_title`

---

## Clay AI column prompts

These three fields require Clay AI columns (Claygent). The taxonomies must match the persona form exactly.

### `job_title_standardised`
```
Given the raw job title "{{job_title}}" at a life sciences company, return a clean, standardised version. Expand abbreviations, remove location/region qualifiers, use full words. Return only the standardised title, nothing else.
Example: "VP Clin Ops EMEA" → "Vice President, Clinical Operations"
```

### `seniority_level`
Classify into exactly one of these options (copy the text exactly — these must match the persona builder):
```
Given the job title "{{job_title}}", classify the seniority as exactly one of these options:
C-Level, VP / SVP, Director, Head of / Senior Manager, Manager, Individual Contributor

Return only the classification, nothing else.
```

### `business_area`
Classify into exactly one of these options (copy the text exactly — these must match the persona builder):
```
Given the job title "{{job_title}}" at a life sciences / biopharma company, classify which team or function this person works in. Choose exactly one from:
Executive Leadership, Business Development & Partnerships, Clinical Operations, Research & Development, Regulatory Affairs, Manufacturing & CMC, Medical Affairs, Commercial & Sales Operations, Procurement, Strategy & Corporate Development, Lab Operations, Technology & Systems, AI & Machine Learning, Marketing

Return only the classification, nothing else.
```

---

## Company columns to add in Clay

These map to the `companies` table via the callback's `upsertCompany()` helper.
Use Clay's **LinkedIn Company Enrichment** or **Clearbit** provider.

| Clay column name | Clay enrichment source | Maps to DB column | Notes |
|---|---|---|---|
| `company_domain` | Extract from website URL | `company_domain` / `companies.domain` | **Required** — used as the dedup key for `companies` upsert |
| `company_linkedin_url` | LinkedIn Company | `company_linkedin_url` / `companies.*` | |
| `company_description` | LinkedIn Company | `companies.description` | One-line description of the company |
| `company_industry` | LinkedIn Company | `companies.industry` | e.g. "Biotechnology", "Pharmaceuticals" |
| `company_sub_industry` | LinkedIn Company / manual | `companies.sub_industry` | e.g. "Gene Therapy", "Oncology" |
| `company_employee_count` | LinkedIn Company | `companies.employee_count` | Raw headcount number |
| `company_employee_range` | LinkedIn Company | `companies.employee_range` | e.g. "51–200" |
| `company_founded_year` | LinkedIn Company | `companies.founded_year` | |
| `company_hq_city` | LinkedIn Company | `companies.headquarters_city` | |
| `company_hq_country` | LinkedIn Company | `companies.headquarters_country` | |
| `company_funding_stage` | Crunchbase / LinkedIn | `companies.funding_stage` | e.g. "Series B", "Public", "Bootstrapped" |
| `company_total_funding_usd` | Crunchbase | `companies.total_funding_usd` | Numeric, USD |
| `company_latest_funding_date` | Crunchbase | `companies.latest_funding_date` | ISO date, e.g. "2024-06-01" |
| `company_therapeutic_areas` | Manual / Clay AI | `companies.therapeutic_areas` | Array — e.g. `["Oncology", "CNS"]` |
| `company_modalities` | Manual / Clay AI | `companies.modalities` | Array — e.g. `["Small molecule", "ADC"]` |
| `company_clinical_stage` | Manual / Clay AI | `companies.clinical_stage` | e.g. "Phase 2", "Preclinical", "Commercial" |

> **Note on arrays:** Clay returns multi-value fields as comma-separated strings.
> The callback accepts both `string[]` and `string` for array fields — no special handling needed
> in Clay, just return the raw value and the callback will handle it.

---

## HTTP Callback (Action) setup in Clay

In your Clay table, add an **HTTP API** action with these settings:

- **URL:** `https://<your-deployed-domain>/api/import-clay-callback`
- **Method:** POST
- **Headers:**
  - `Content-Type: application/json`
  - `x-import-webhook-secret: arcova-clay-callback-secret`
- **Body:** Map all columns above as a JSON object. Include `raw_upload_id`, `batch_id`, and `user_id` as passthrough columns from the original webhook input.

---

## What comes next (Phase 2 — Signals)

Phase 2 will add signal-based enrichment. Signals are events that indicate buying intent:

- **Job change** — contact started a new role (triggers re-evaluation of fit)
- **LinkedIn activity** — contact posted about a relevant topic
- **Company hiring** — company is hiring for roles that indicate a relevant initiative
- **Company funding** — new funding round
- **Clinical trial update** — ClinicalTrials.gov activity at the company
- **Conference attendance** — contact speaking at or attending a relevant event

Each signal will write a row to the `signals` table and trigger an `intent_score` recalculation.
Phase 2 will need separate Clay tables (or additional columns with scheduled refresh) and a signal ingestion design session.
