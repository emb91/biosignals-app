# Data-Consuming Touchpoints & Cost — Per-User Monthly Model

**Purpose:** Trace every external **data-consuming** API call (enrichment, Apify scraping, Apollo,
ZeroBounce email validation, signal monitoring/scraping) across the app lifecycle, count the
**touchpoints** (HTTP calls to external endpoints) per month, break them down by type, and roll up the
cost — including buying data on `/data`. Companion to `PRICING_AND_COST_BASIS.md`.

> **Excludes** the agent side-panel and central agent (LLM/Anthropic spend) by request — this is about
> *data acquisition*, not model inference.

> **Legend:** ✅ FACT = grounded in repo code (file ref given). 🔶 ESTIMATE = modeled assumption, confirm
> against provider billing. A **touchpoint** = one HTTP call to an external endpoint; kept separate from
> **credits/$** because one Apify run can return many profiles, one Apollo search page returns many results.

---

## Model assumptions

One user, one steady-state month:

- **Existing base:** 100 contacts + 100 accounts, already enriched.
- **Acquisition this month:** buys **100 net-new enriched leads** (contact + company) via `/data`.
- **Fit gate:** recurring sweeps only touch fit ≥ 0.70 records (`lib/signals/sweep-fit-gate.ts`,
  `SWEEP_FIT_MIN=0.7`). 🔶 Assume ~40 of the 100 accounts and ~40 contacts clear the gate.
- Numbers are illustrative — the point is the **shape** (which surface dominates), not the exact count.

Three distinct cost surfaces:
- **A. Onboarding** — one-time, trivial.
- **B. The `/data` buy** — the dominant burst.
- **C. Recurring background jobs** — the monthly tail (signal monitoring + re-enrichment).

---

## A. Onboarding — one-time (not monthly)

At setup you enrich your own company + 1–3 ICP example companies. Each company fires:

| Act | Endpoint | Provider | Calls | Cost |
|---|---|---|---|---|
| Your company enrich | `organizations/enrich` | Apollo | 1 | 1 cr |
| Your company scrape | `harvestapi~linkedin-company` | Apify | 1 | $0.004 |
| ICP example enrich | `organizations/enrich` | Apollo | 1–3 | 1–3 cr |
| ICP example scrape | `harvestapi~linkedin-company` | Apify | 1–3 | $0.004 ea |

≈ **2–4 Apollo org enrichments + 2–4 Apify company scrapes**, plus Claude web-search (LLM, unmetered).
Happens once. ✅ `app/api/analyze-and-store/route.ts`, `lib/my-company-enrichment.ts`,
`lib/target-company-enrichment.ts`.

---

## B. Buying 100 leads via `/data` — the burst

Pipeline: discover → enrich → import (✅ `lib/data-acquisition/job-runner.ts`,
`lib/data-acquisition/apollo-discovery.ts`, route `app/api/pipeline/data-request/route.ts`). For 100
net-new contact + company pairs:

| Act | Endpoint | Provider | Calls (touchpoints) | Credits / $ |
|---|---|---|---|---|
| Company search (paginated) | `mixed_companies/search` | Apollo | ~10–20 | low (0.1/result internal) |
| People search (per co.) | `mixed_people/search` | Apollo | ~50–100 | low (0.05/result) |
| **Company enrich** | `organizations/enrich` | Apollo | ~70–100 | **~70–100 cr** |
| **Person enrich** | `people/match` | Apollo | **100** | **100 cr** |
| Email validate | ZeroBounce validate | ZeroBounce | 100 | 100 cr (~$0.50) |
| Profile scrape (fallback) | `harvestapi~linkedin-profile-scraper` | Apify | ~100 | $0.40 |
| Company scrape (fallback) | `harvestapi~linkedin-company` | Apify | ~70–100 | $0.40 |

**Buy total: ~500–620 API touchpoints → ~180–200 Apollo credits, ~100 ZeroBounce credits, ~$0.80 Apify.**

> 🔴 The binding constraint is **Apollo**: ~200 credits for one 100-lead buy ≈ **80% of the entire
> free-tier monthly allowance** (250 credits, ✅ `lib/provider-usage.ts:53` `APOLLO_PLAN`). One purchase
> nearly exhausts free Apollo.

---

## C. Recurring monthly background jobs (existing base of 100/100)

12 crons run (✅ `vercel.json`). Only **three** touch paid data providers; the rest hit free public/mirror
sources but still count as signal-monitoring touchpoints.

### Paid-provider jobs

| Job | Schedule | Endpoint | Provider | Calls/mo | Cost/mo |
|---|---|---|---|---|---|
| **contact-job-change** | daily | `harvestapi~linkedin-profile-scraper` | Apify | **~600** profile scrapes (20/day cap, fit-gated) | ~$2.40 |
| **jobs-delta** (hiring) | weekly | `curious_coder~linkedin-jobs-scraper` | Apify | ~4–5 runs (≤1,000 jobs each) | ~$5–10 |
| **contact-enrichment-queue** | every 10 min | Apollo + Apify + ZeroBounce | mixed | depends on queue — see below | refresh burn |

✅ `app/api/cron/contact-job-change/route.ts` → `lib/signals/run-job-change-monitor.ts` (batch 20/user/day,
$0.004/profile, doubly fit-gated: contact ≥0.70 at company ≥0.70).
✅ `app/api/cron/jobs-delta/route.ts` → `lib/signals/run-hiring-monitor.ts` (companies ≥0.70, global cap
1,000 jobs/run, ~$0.001/job).
✅ `app/api/cron/contact-enrichment-queue/route.ts` (every 10 min, batch ≤3/run).

The **enrichment-queue** is the uncapped variable. It re-enriches contacts flagged by job-change signals or
stale-refresh priority (⚠️ currently **not fit-gated** — Lever B in `PRICING_AND_COST_BASIS.md`). Modeling
~20 re-enriched/month for a 100-contact base:

- 20 Apollo person + 20 Apollo company + 20 Apify profile + 20 ZeroBounce = **~80 touchpoints,
  ~40 Apollo cr, $0.08 Apify, 20 ZB cr.**

### Free signal-monitoring jobs (public APIs / mirrors — $0 marginal, but real touchpoints)

| Job | Source endpoint | Calls/mo |
|---|---|---|
| clinical-trials-delta | ClinicalTrials.gov | ~30 |
| funding-delta | SEC EDGAR | ~30 |
| grants-delta | NIH Reporter | ~30 |
| press-releases-delta | GlobeNewswire + PRNewswire RSS | ~30 |
| patents-delta | BigQuery mirror | ~4–5 |
| fda-delta | openFDA | ~4–5 |
| conferences-delta | public source | ~4–5 |
| hubspot-daily | HubSpot (Nango) | ~30 (CRM sync, no enrichment cr) |
| lemlist-sync | Lemlist | ~30 |

Mostly **central** syncs (one sync serves all users) + local LLM matching — they don't multiply per user
and cost ~$0 in provider data. ✅ `app/api/cron/*-delta/route.ts`, `hubspot-daily`, `lemlist-sync`.

---

## Consolidated monthly picture (this scenario)

### Touchpoints by type

| Provider / type | Touchpoints/mo | Driver |
|---|---|---|
| Apollo (search + enrich) | **~700–800** | mostly the 100-lead buy (~500), rest re-enrichment |
| Apify (profile + company + jobs) | **~800** | ~270 from buy, ~600 from daily job-change sweep |
| ZeroBounce | **~120** | 100 from buy + ~20 refresh |
| HubSpot / Lemlist (CRM sync) | ~60 | daily, no data cost |
| Public-data signal monitoring | ~170 | mostly central syncs |
| **Total external touchpoints** | **~1,850/mo** | |

### Cost by provider (this month)

| Provider | Volume | Free-Apollo cost | Paid-Apollo (~$0.02/cr) |
|---|---|---|---|
| Apollo | ~240 credits (200 buy + 40 refresh) | $0 (but blows the 250 free cap) | ~$4.80 |
| Apify | ~770 scrapes + ~4k job records | ~$3.30 | ~$3.30 |
| ZeroBounce | ~120 validations | ~$0.60 | ~$0.60 |
| **Total marginal data** | | **~$4/mo** | **~$9/mo** |

---

## Headline takeaways

1. **The `/data` buy dominates.** One 100-lead purchase = ~500 touchpoints and ~200 Apollo credits — more
   than all recurring background jobs combined, and ~80% of free-tier Apollo in a single action.
2. **Apify is highest by call count** (~800/mo) but cheapest by dollar (~$3) — the daily job-change sweep
   (capped 20/day) is the workhorse, and the fit-gate keeps it bounded.
3. **Apollo is the pacing constraint** — credits, not dollars. At ~240 credits/user/month with one buy,
   the free 250 plan supports roughly **one active user**; capacity is a stepped-fixed Apollo plan upgrade.
4. **The enrichment-queue is the one genuinely uncapped tail** — not fit-gated yet (Lever B). If
   stale-refresh churns all 100 contacts instead of ~20, this line 5×'s with no user action behind it.

---

## Per-unit reference (✅ from code)

| Constant | Value | File |
|---|---|---|
| `APIFY_PROFILE_SCRAPE_USD` | $0.004 | `lib/provider-usage.ts:34` |
| `APIFY_COMPANY_SCRAPE_USD` | $0.004 (🔶 estimate) | `lib/provider-usage.ts` |
| `APOLLO_CREDITS.person_enrichment` | 1 | `lib/provider-usage.ts` |
| `APOLLO_CREDITS.company_enrichment` | 1 | `lib/provider-usage.ts` |
| `APOLLO_CREDITS.phone_reveal` | 1 | `lib/provider-usage.ts` |
| `APOLLO_PLAN` (Free) | 250 credits/mo, $0 | `lib/provider-usage.ts:53` |
| `ZEROBOUNCE_CREDITS.email_validate` | 1 (~$0.005) | `lib/provider-usage.ts` |
| `ZEROBOUNCE_CREDITS.email_finder` | 20 | `lib/provider-usage.ts` |
| Internal `CREDIT_WEIGHTS` (spend governor) | search 0.05–0.1, enrich 1.0, Apify scrape 1.5, llm_fit_screen 0.02 | `lib/data-acquisition-metering.ts:53` |
| `SWEEP_FIT_MIN` | 0.70 | `lib/signals/sweep-fit-gate.ts` |
| Job-change batch | 20 contacts/user/day | `lib/signals/run-job-change-monitor.ts` |
| Enrichment-queue batch | ≤3 contacts/run, every 10 min | `app/api/cron/contact-enrichment-queue/route.ts` |
</content>
</invoke>
