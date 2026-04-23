# Bootstrap: URL-First ICP Setup Flow

## What this doc is for

This is a context handoff for a new session to design and build an alternative setup flow where a user enters a URL (an example target company's website) to automatically model their ICP, rather than answering questions one by one.

---

## Codebase overview

**Repo:** `biosignals-app` (Next.js 14, Supabase, TypeScript)  
**Branch:** `codex/apollo-import-leads-refresh`  
**Working dir:** `/Users/emma/biosignals-gtm-2026/biosignals-app`

**Key tables:**
- `icps` — user-defined target company profiles (what the user sells to). Has fields: `company_type`, `therapeutic_areas`, `modalities`, `development_stages`, `funding_stages`, `company_sizes`, `name`.
- `companies` — enriched imported lead companies (separate from ICPs). Has taxonomy fields: `company_type`, `company_type_display`, `therapeutic_areas`, `modalities`, `development_stages`, `taxonomy_evidence_summary`.
- `contacts` / `leads` — imported contacts joined to `companies`.

---

## Current setup flow

**Entry point:** `components/SetupFlow.tsx`

The current flow is a multi-step conversational wizard (chat UI) that asks:
1. User's own company (name, website, what they do)
2. Target company type (from `COMPANY_TYPE_OPTIONS`)
3. Target company size
4. Target therapeutic areas
5. Target modalities
6. Target development stages (planned, not yet on the form)
7. Target funding stages
8. Persona / buying group definition (separate `components/PersonaForm.tsx`)

At completion, it writes to the `icps` table via `/api/generate-icp-name` + a Supabase upsert.

**Example company analysis:** There is an existing API at `app/api/analyze-example-company/route.ts` that takes a company domain/name and returns: `companyType`, `therapeuticAreas`, `modality`, `fundingStage`, `companySize`, `developmentStage`. This was originally used as a "hint" inside the wizard when a user typed an example company name. It calls an n8n webhook (`N8N_FIRMOGRAPHICS_WEBHOOK`) with Anthropic as fallback.

---

## Canonical taxonomy (single source of truth)

**File:** `lib/arcova-taxonomy.ts`

All taxonomy options live here. Always import from here — never hardcode.

```typescript
COMPANY_TYPE_OPTIONS     // 12 types: Biotech/Biopharma, Pharma, CDMO, CRO, Medical Device,
                         // Diagnostics, Life Science Tools & Instruments, Digital Health & Informatics,
                         // Academic Spinout, Academic / Research Institute,
                         // Hospital / Health System, Contract Lab & Testing Services
THERAPEUTIC_AREA_OPTIONS // 15 values: Oncology, Haematology, Rare Disease, etc.
MODALITY_OPTIONS         // 30+ values: Small Molecule, CAR-T, mRNA, ADC, etc.
DEVELOPMENT_STAGE_OPTIONS // Preclinical, Phase I, Phase II, Phase III, Commercial, All stages
FUNDING_STAGE_OPTIONS    // Pre-seed → Public, Grant-funded
COMPANY_SIZE_OPTIONS     // 1–10, 11–50, 51–200, 201–500, 500+
BUSINESS_AREA_OPTIONS    // Executive Leadership, BD&P, Clinical Ops, R&D, etc.
SENIORITY_LEVEL_OPTIONS  // C-Level, VP/SVP, Director, Head of/Senior Manager, Manager, IC
```

Canonicalization helpers: `canonicalizeCompanyType`, `canonicalizeTherapeuticArea`, `canonicalizeModality`, `expandModalitiesWithParents`.

---

## Company taxonomy enrichment (background, for context)

When leads are imported, `lib/company-monitor/taxonomy.ts` runs a Claude classifier (claude-sonnet-4-6 + web_search tool) against scraped website content + Apollo/Apify firmographics. It classifies:
- `company_type` (canonical) + `company_type_display` (free text for non-ICP companies)
- `therapeutic_areas[]`, `modalities[]`, `development_stages[]`
- `taxonomy_evidence_summary` (one-sentence reasoning)

The classifier has two modes:
- **Therapeutic mode** (Biotech, Pharma, Academic Spinout): classifies from own pipeline
- **Vendor mode** (CRO, CDMO, Tools, etc.): classifies from served customer segments

Development stage: only for Biotech, Pharma, Academic Spinout, Academic/Research Institute, CRO, CDMO. Mandatory web search for therapeutic developers. CROs/CDMOs infer from stages they operate in.

---

## The idea to build: URL-first ICP setup

### Problem with current flow
The current wizard asks 6–8 questions sequentially. It's slow and requires the user to already know their ICP taxonomy precisely. Many users know their customers by example ("we sell to companies like Bioora") rather than by taxonomy label.

### Proposed alternative
User enters one or more example customer URLs (or company names). Arcova:
1. Scrapes and enriches the example companies using the same taxonomy classifier pipeline already built
2. Presents back: "Based on [Company A] and [Company B], here's the profile we'd suggest — does this look right?"
3. User confirms or adjusts
4. Writes to `icps` table

### The anchoring concern (raised but unresolved)
If the user provides one example company, there's a risk of over-anchoring the ICP to that specific company's characteristics rather than the *type* of company they want to sell to. For example, if they enter a Phase II Oncology CAR-T biotech but actually sell to all Phase I–III cell therapy companies, anchoring to Phase II Oncology would be too narrow. This needs to be addressed in the UX — possibly by:
- Asking for 2–3 example companies and taking the union/intersection
- Showing suggested taxonomy values as editable pills so the user can widen/narrow
- Asking a single clarifying question: "Should we target companies similar to this specifically, or companies in the same broad space?"

### Relevant existing infrastructure
- `app/api/analyze-example-company/route.ts` — already enriches a company URL/name and returns taxonomy fields. Could be reused or extended.
- `lib/company-monitor/taxonomy.ts` — full classifier, more powerful than analyze-example-company. Could be called directly.
- `components/SetupFlow.tsx` — current wizard. The URL-first flow could be an alternative entry path into the same flow, or a full replacement.
- The `icps` table already has all the fields needed to store the result.

### Open design questions for the new session
1. Replace the question wizard entirely, or offer URL-first as an alternative path alongside it?
2. Single URL or multi-URL input? (Multi reduces anchoring risk)
3. How to handle the "confirmation + edit" step — show editable taxonomy pills or go back into the chat wizard for adjustments?
4. Should the URL enrichment use `analyze-example-company` (fast, lightweight) or `resolveCompanyTaxonomy` from the company monitor (more powerful, slower)?
5. Does the user enter their *customer's* URL, or their *own* company's URL? (It's the customer's URL — the example target account.)

---

## Recent taxonomy work (completed this session, pushed to GitHub)

For full context on what was built:

- Expanded `COMPANY_TYPE_OPTIONS` from 6 → 12 types
- Added `company_type_display` (free text for non-ICP companies like VCs)
- Added `taxonomy_evidence_summary` to record classifier reasoning
- Added `development_stages text[]` with web-search-backed inference
- Customer-side taxonomy: vendor companies (CRO, CDMO, Tools) classify TA/modality from served customer segments, not own products
- Search in results page now covers company type, TA, modality, development stage

All migrations applied and pushed. Branch: `codex/apollo-import-leads-refresh`.
