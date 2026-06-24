# Conference / tradeshow signal — build plan

Adds a new **`exhibiting_at_conference`** (and later `presenting_at_conference`) signal that mirrors
the existing monitor pattern exactly. A company exhibiting at a relevant show in N weeks = a
forward-looking readiness signal in the universal event feed.

## The pattern we are mirroring (from funding / publications / grants monitors)

| Stage | Existing reference | Conference equivalent |
|---|---|---|
| External → mirror table + resolver-at-ingest | `sync-nih-grants-delta.ts` → `nih_grants_local` | `sync-conference-delta.ts` → `conference_exhibitors_local` |
| Name matching | `company-name-variants` (`normalizeCompanyForMatching`, `distinctiveTokens`) + `company-aliases` | reuse verbatim |
| LLM check (ambiguous) | `sec-form-d-screener.ts` (+ `.test.ts`) | `conference-exhibitor-screener.ts` for medium-confidence name matches |
| Admission guard (fail-closed) | `resolver-provenance-admission.ts` (`companyMentionAdmission`) | reuse; `matchType: 'verified_exhibitor'`, `acceptedSourceFields: ['company_name']` |
| Monitor | `run-grants-monitor.ts` / `run-publications-monitor.ts` | `run-conference-monitor.ts` (≈90% a clone) |
| Emit | `ingestSignalSourceEvent` + `normalizeSignalSourceEvent` | same; SignalKey `exhibiting_at_conference` |
| Catalog | `readiness-catalog.ts` | new entry; lifecycle = **conference-date phase + hard ~3wk expiry** (not a decay curve) |
| Regression | `*.test.ts` + `tsconfig.test.X.json` + `npm run test:X` | `conference-name-match.test.ts`, `conference-admission.test.ts` |

## Clean storage

**`conferences`** (registry — the seed comes from the wide workstream):
`id, name, slug, platform, event_url, exhibitor_source_url, start_date, end_date, venue, country,
relevance_tags[], access_status ('clean'|'js'|'gated'), next_poll_at, last_polled_at`

**`conference_exhibitors_local`** (mirror, modeled on `nih_grants_local`):
`id, conference_id, company_name_raw, company_name_normalized, booth, source, source_url,
fetched_at, mentioned_company_ids uuid[], mentioned_company_matches jsonb` (provenance:
`{source_field, source_text, company_name, verification_reason, confidence, verified, resolved_by}`)

**Platform adapters** — one module per platform behind a single interface, so the monitor is
platform-agnostic (this is the "one parser, many shows" unit):
```
lib/signals/conference/adapters/{mapyourshow,conference-harvester,spargo,terrapinn,swapcard,smallworldlabs}.ts
  -> fetchExhibitors(conf): Promise<{ name: string; booth?: string; website?: string; category?: string }[]>
```
Map Your Show adapter is already proven (PDF export + offset-font decode; BIO ≈1,630 rows).

## Cadence — two separate layers

**1. Source polling (shared mirror refresh)** — like the `*-delta` crons; shared across all users, no
plan gating. **Event-date driven**: `next_poll_at` from days-to-event — >3mo → weekly · 6–8wk out →
2–3×/wk · event week → daily · post-event → stop (flip to "exhibited last year" prediction). Delta
sync only touches conferences in an active window. Dedupe at `signal_source_events` so re-polls emit
only **net-new** exhibitors. Pulls are cheap (HTTP/PDF, no Apollo) — cost guardrail stays downstream
on enrichment (fit-gate).

**2. Per-user signal surfacing (plan-tiered)** — reuse the existing job-change cadence helper directly.
`growth: 7, starter: 30, free: 30` matches `DEFAULT_CYCLE_DAYS` in `lib/signals/job-change-cadence.ts`
exactly, so call `resolveCadenceDaysForUser()` / `cadenceDaysForPlan()` verbatim — no new cadence code.
(The other source signals are being migrated to this same plan-tiered model; conferences just adopts it.)

## Signal lifecycle — conference-date phases (NOT a decay curve)

The actionable datum is the **conference date**. The signal carries `conference_start` / `conference_end`
in metadata; the **phase** is derived at read time from today's date and drives the outreach angle:

| Phase | When | Outreach angle |
|---|---|---|
| `upcoming` | before `conference_start` | "in case you're planning on going to CPHI…" (registration / intent to attend) |
| `live` | between start and end | "know you're at CPHI today — grab a coffee?" |
| `recent` | 0 → ~21 days after `conference_end` | "did you enjoy CPHI last week?" |
| `expired` | > ~21 days after `conference_end` | **dead — suppress** |

Implementation: **hard expiry** at `conference_end + 21d` (not a smooth `decayDays`). The signal is alive
from detection through the `recent` window, then drops out. Phase is a pure function of the two dates +
now — store it nowhere, compute it on read. The conference date is required data on every exhibitor row.

## Two workstreams

### A. WIDE — registry coverage  → `docs/conference-registry-wide.md`
Map the full US life-science calendar relevant to the ICP; for each show identify platform,
`exhibitor_source_url`, dates, and `access_status` (curl-verified). Output is the seed dataset for the
`conferences` table. No code.

### B. DEEP — crack endpoints + clean ingestion scaffold  → `docs/conference-ingestion-deep.md` + `lib/signals/conference/**` (NEW files only)
Reverse-engineer the JS-platform data endpoints (Conference Harvester first → unlocks SITC + SLAS;
then SPARGO, Terrapinn, Swapcard, Small World Labs); capture exact URLs + sample payloads + field
maps. Then scaffold the adapter interface + the proven Map Your Show adapter + mirror-table migration
draft + monitor skeleton + catalog entry + test stubs — mirroring the pattern above. New files only;
no edits to shared files; no migrations run; no commits.

## Open questions (decide before productionizing)
- ToS/legal per platform (public ≠ permitted to resell as a signal).
- Field depth: PDF = name+booth (match only); JSON platforms = richer (match + enrich).
- Capturing reliable conference start/end dates per show (required for the phase logic) — part of the wide registry.
