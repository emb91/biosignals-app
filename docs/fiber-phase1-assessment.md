# Fiber AI Phase 1 Assessment

## Phase 1 Fit Verdict

`Yes, with Arcova-owned normalization.`

Fiber looks suitable as the Phase 1 enrichment provider for imported contacts and companies, provided Arcova continues to own:
- `job_title_standardised`
- `seniority_level`
- `business_area`
- fit scoring against personas

## Confirmed Public Fiber Capabilities

Based on Fiber's public API/docs surface:
- synchronous API-style enrichment
- people/company search from partial information
- reverse email-to-person lookup
- live LinkedIn profile/company fetch

Public example fields confirm support for:
- `first_name`
- `last_name`
- `name`
- `headline`
- `locality`
- `profile_pic`
- `url`
- `current_job.company_name`
- `current_job.title`
- `current_job.seniority`
- `current_job.job_function`

Live validation completed for:
- `POST /v1/email-to-person/single`
- top-level response shape includes `data: [...]`, which matches the current adapter

## Fields Arcova Must Derive

Fiber's public docs do not prove exact support for Arcova's required stored taxonomy values, so Arcova should derive:
- `job_title_standardised`
- `seniority_level` using the exact persona-form taxonomy
- `business_area` using the exact persona-form taxonomy

## LinkedIn URL Resolution

Fiber's public docs indicate search from partial information, which suggests missing LinkedIn URLs can likely be resolved in-provider. The exact request/response path still depends on the private endpoint docs, so this should be confirmed with live API responses before production rollout.

## Company Classification Gaps

Fiber's public docs support company enrichment, but they do not clearly prove native support for:
- `therapeutic_areas`
- `modalities`
- `clinical_stage`

Arcova should therefore treat those as optional provider fields and remain prepared to derive them later if needed.

## Phase 2 Potential

Fiber looks promising for future Phase 2 discovery because the public product surface advertises people/company search with granular retrieval capabilities. That is relevant context only; this implementation remains scoped to Phase 1 import, enrichment, scoring, and ranking.
