# Arcova Session Bootstrap — 24 Mar 2026 (afternoon)

## Where we are

Building Arcova's P1 pipeline: CSV import → Clay enrichment → LLM fit scoring → Leads view.

The core pipeline is built and code-complete. The remaining work is **Clay table configuration** (UI steps) and **end-to-end testing**.

---

## What's been built this session

### DB migrations applied (live in Supabase)
- `rename_contacts_to_personas` — old contacts table (persona configs) renamed to `personas`
- `create_pipeline_tables` — new `upload_batches`, `raw_uploads`, `contacts` (leads), `companies`, `signals`
- `add_fit_score_reasoning_to_contacts` — fit_score_reasoning, matched_on, gaps, scored_against_persona_id
- `add_firmographic_columns_to_contacts` — headline, city, country, years_in_current_role, profile_photo_url, company_domain, company_linkedin_url

### Files built/updated
- `lib/scoring.ts` — LLM fit scoring via Claude Haiku, batches 10 contacts/call, includes headline in prompt
- `lib/rescore.ts` — rescores all contacts for a user using service-role client, fire-and-forget safe
- `app/api/rescore-contacts/route.ts` — POST endpoint to trigger rescore manually
- `app/api/import-contacts/route.ts` — accepts company_linkedin_url as mappable import field
- `app/api/import-clay-callback/route.ts` — full Phase 1 payload, upserts companies, links company_id
- `app/api/contacts/route.ts` — fires rescore when new persona created
- `app/api/contacts/[id]/route.ts` — fires rescore when persona updated
- `app/api/leads/route.ts` — paginated leads view ordered by priority_score
- `app/results/page.tsx` — Leads view with score bars, search, pagination

### Test data in DB (Supabase)
- user_id: `3f166004-174b-4fc6-88f0-7cd47332f6ee` (emma@arcova.bio)
- batch_id: `4a6a9f0b-13c2-4855-b288-13d65afa5fc1`
- raw_upload_id: `f717adbf-bce0-4bfb-b5e0-f0c7c4c02c82`

---

## Clay table configuration — STILL TO DO IN CLAY UI

Emma needs to add these columns in Clay's UI for the contacts table:

### Pass-through columns (no enrichment, just return as-is)
`raw_upload_id`, `batch_id`, `user_id`, `full_name`, `first_name`, `last_name`, `email`, `linkedin_url`, `job_title`, `company_name`, `company_linkedin_url`

### LinkedIn Person scrape columns (direct scrape, no prompt)
`profile_photo_url`, `headline`, `years_in_current_role`, `location`, `city`, `country`

### Clay AI columns (Claygent — prompts below)

**`job_title_standardised`**
```
Given the raw job title "{{job_title}}" at a life sciences company, return a clean, standardised version. Expand abbreviations, remove location/region qualifiers, use full words. Return only the standardised title, nothing else.
Example: "VP Clin Ops EMEA" → "Vice President, Clinical Operations"
```

**`seniority_level`**
```
Given the job title "{{job_title}}", classify the seniority as exactly one of these options:
C-Level, VP / SVP, Director, Head of / Senior Manager, Manager, Individual Contributor

Return only the classification, nothing else.
```

**`business_area`**
```
Given the job title "{{job_title}}" at a life sciences / biopharma company, classify which team or function this person works in. Choose exactly one from:
Executive Leadership, Business Development & Partnerships, Clinical Operations, Research & Development, Regulatory Affairs, Manufacturing & CMC, Medical Affairs, Commercial & Sales Operations, Procurement, Strategy & Corporate Development, Lab Operations, Technology & Systems, AI & Machine Learning, Marketing

Return only the classification, nothing else.
```

### Company enrichment columns (LinkedIn Company / Crunchbase scrape)
`company_domain`, `company_description`, `company_industry`, `company_employee_count`, `company_employee_range`, `company_founded_year`, `company_hq_city`, `company_hq_country`, `company_funding_stage`, `company_total_funding_usd`, `company_latest_funding_date`

### Company AI columns (Claygent — prompts below)

**`company_sub_industry`**
```
Based on the company description: "{{company_description}}" and industry "{{company_industry}}", give a specific sub-industry label for this life sciences company in 3-6 words. Examples: "Oncology mRNA Therapeutics", "Gene Therapy Platform", "Clinical CRO". Return only the label, nothing else.
```

**`company_therapeutic_areas`**
```
Based on this company description: "{{company_description}}" and company name: "{{company_name}}"
List the therapeutic areas this company works in. Choose only from:
Oncology, Rare Disease, Neurology / CNS, Immunology, Infectious Disease, Cardiovascular, Metabolic / Endocrinology, Ophthalmology, Dermatology, Respiratory, Haematology, Musculoskeletal, Gastroenterology, Women's Health, Pain, Gene Editing, Diagnostics, Multi-therapeutic
Return as a comma-separated list, nothing else.
```

**`company_modalities`**
```
Based on this company description: "{{company_description}}" and company name: "{{company_name}}"
List the drug modalities or technology types this company uses. Choose only from:
Small Molecule, Biologic (Antibody), Bispecific Antibody, ADC, Cell Therapy, Gene Therapy, RNA Therapy, Peptide, Oligonucleotide, Radiopharmaceutical, Protein / Enzyme Replacement, Gene Editing (CRISPR), Microbiome, Biosimilar, Vaccine, Diagnostics, Liquid Biopsy, Digital Therapeutics, AI/ML Platform, Drug Discovery Platform, Biomarker, Imaging
Return as a comma-separated list, nothing else.
```

**`company_clinical_stage`**
```
Based on this company description: "{{company_description}}" and company name: "{{company_name}}"
Classify the furthest clinical stage this company has reached. Choose exactly one from:
Preclinical, Phase 1, Phase 2, Phase 3, Approved / Commercial, Platform Only, Research Tools / Services
Return only the classification, nothing else.
```

### HTTP Callback Action in Clay
- URL: `https://<deployed-domain>/api/import-clay-callback`
- Method: POST
- Headers: `x-import-webhook-secret: arcova-clay-callback-secret`
- Body: all columns above as JSON, must include `raw_upload_id`, `batch_id`, `user_id`

---

## Notes
- All customers/companies are US-based in v1
- Modality is company-level only (not on persona form) — potential future persona filter
- Clay MCP connector is connected but is enrichment-only (no table management)
- Phase 2 = signal scoring (job changes, LinkedIn activity, funding, clinical trials) — not started
- `intent_score` is currently hardcoded to 1.0 (neutral) — will be updated in Phase 2
