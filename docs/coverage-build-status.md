# Coverage — build status & outstanding work

_Last updated: 2026-06-10 · Branch `feat/today-followups` · PR [#80](https://github.com/emb91/biosignals-app/pull/80)_

## What Coverage is

A target-driven GTM planner at **`/coverage`** (renamed from `/health`). One line per ICP.
It answers three questions, each unlocked by more data, and never blocks if data is missing:

1. **Do I have enough of the right companies/contacts?** (sourced coverage — works with no CRM)
2. **Which ICPs actually convert?** (deal performance — needs a connected CRM)
3. **What do I buy to hit my number?** (a target → a per-ICP sourcing plan)

The thesis: stop guessing which ICP to chase. Let closed-deal data rank them by **throughput**,
then turn one quarterly target into a concrete "source N contacts for ICP X" plan, bounded by
what's actually buyable.

---

## What was built (shipped on PR #80)

### Tier 0 — data foundations
- **Schema** (`supabase/migrations/20260610_coverage_gtm_targets_and_deal_stage_history.sql`):
  - `gtm_targets` — one row per (user, period); `target_type` ∈ {revenue, deals}, `target_value`. RLS by user.
  - `crm_deal_stage_history` — per-stage `entered_at`/`exited_at` so we can measure real sales-cycle length.
- **Stage-history capture** (`lib/crm-sync-store.ts`, `lib/signals/readiness-hubspot-deals.ts`): the HubSpot
  sync now records a row each time a deal changes stage.

### Tier 1 — sourced coverage (unchanged behaviour, kept)
- Per-ICP company count, contact count, fit, depth, red/amber/green health — the original `/health` table.

### Tier 2 — deal performance (`lib/coverage/icp-performance.ts`)
- Per ICP, from the CRM mirror: active deal count, open pipeline, win rate, avg ACV, avg cycle, and a
  **throughput** score = win-rate-weighted won revenue per day.
- Deal → ICP resolution: Path A (`crm_deal_company_links` → `user_companies.matched_icp_id`),
  Path B fallback (`crm_deal_contact_links` → `contacts.company_id` → matched ICP).
- A `confidence` tag (high/medium/low) by closed-deal sample size.
- Surfaced via `app/api/pipeline/icp-cards/route.ts`; rendered as new columns + a throughput **rank chip**
  and a "best-converting ICP" insight banner on the page.

### Tier 3 — target → plan (the prescriptive layer)
- **Allocation engine** (`lib/coverage/allocation.ts`, pure + unit-tested): splits one overall target across
  ICPs by throughput (capped water-fill), back-calculates the funnel to **contacts-to-source**, respects each
  ICP's supply ceiling, reallocates overflow, and reports any shortfall.
- **Plan glue** (`lib/coverage/coverage-plan.ts`): turns the page's cards + target into allocation inputs,
  blends fallback funnel rates.
- **Target API** (`app/api/coverage/target/route.ts`): `GET`/`PUT` over `gtm_targets`; returns prior-period history.
- **Supply check** (`app/api/coverage/supply/route.ts` + `lib/coverage/supply.ts`): opt-in, credit-spending
  Apollo company count → net-new contact ceiling. Runs only on the "Check addressable supply" button.
- **Agent capture** (`set_gtm_target` tool in `app/api/agent/chat/route.ts`): the side agent can set the target
  conversationally, opening anchored on last-quarter closed-won actuals.

### Page + plumbing (`app/coverage/page.tsx`)
- Retitled to Coverage; performance leaderboard; target card (set/edit inline); per-ICP allocation table with
  to-buy + supply-limited flags + shortfall note.
- Rename `/health → /coverage` everywhere: route, nav, agent `page` id + prompts. `next.config` redirects
  `/health` (and `/leads/health`, `/pipeline`) → `/coverage`; `normalizeAgentPage` remaps the legacy value.

### Tests / verification
- `npm run test:coverage-allocation` — 8 unit tests (throughput split, revenue→deals→contacts back-calc,
  ceiling reallocation, shortfall, period math, plan-builder guards). All green.
- `tsc` clean. Live server: `/coverage` 200, `/health` 307 redirect, agent route compiles.

---

## Where it got to

**Functionally complete end-to-end** for all three tiers, committed and on PR #80. The data path is wired
and verified against real data (a 7-deal / 3-ICP sample computed sane win-rate/ACV/pipeline in Phase 2).

**What it has NOT had:** a real visual QA pass with a logged-in user against meaningful CRM data, and zero
usability testing. Everything below in "Outstanding" follows from that — the engine works; whether a rep
*understands* and *trusts* the output is unproven.

---

## Outstanding work

Framed around the three things a rep needs the page to answer at a glance:
**(A) is the data right, (B) are we surfacing the right insight, (C) do I know what I'm looking at and what to do.**

### A. Are we using the correct data?

The numbers are currently **directional estimates**, and that's the biggest risk to trust. Specifics:

1. **Contact→deal conversion is a flat `0.1` guess.** This directly drives "source N contacts" — if the real
   rate is 3% or 20%, the recommended buy is off by 3–7×. *Fix:* measure it per ICP from
   `crm_deal_contact_links → contacts → matched_icp` (engaged contacts ÷ contacts that produced a deal), with
   the 0.1 default only as a cold-start fallback.
2. **Unattributed deals are invisible.** A deal that doesn't link to a company/contact that maps to an ICP
   silently drops out of performance — understating an ICP or hiding revenue entirely. *Fix:* compute and
   surface an "N deals / $X couldn't be attributed to an ICP" line so the rep knows coverage of the data itself.
3. **Cycle length is thin early.** Stage history only accrues going forward; older deals fall back to
   created→close. *Fix:* label cycle as "based on N deals," and consider the optional HubSpot
   `propertiesWithHistory` backfill noted in the plan.
4. **Supply ceiling is a coarse estimate.** `total_entries − held` (no exact dedupe) × an estimated
   contacts/company. *Fix:* make the estimate's basis visible, and validate contacts/company against observed
   per-ICP ratios rather than a constant.
5. **`confidence` exists but is barely shown.** Each ICP already carries high/medium/low — surface it so a
   rep doesn't over-trust a win rate computed from 2 deals.
6. **Actuals depend on `close_date` + stage normalization.** The agent's "last quarter you closed $X" assumes
   `deal_stage === 'closedwon'` (lowercased) and a parseable `close_date`. Worth validating against the real
   HubSpot stage vocabulary per workspace.

**Net:** before this page can drive a real buying decision, the funnel rates must be measured (not assumed),
and every estimate needs an honest label. Today the UI hints ("estimate — blended win rate …") but doesn't
quantify confidence.

### B. Are we surfacing the right insights?

The data is there; the *interpretation* is shallow.

1. **Throughput is a black box.** The rank chip says "#1" but not *why* — is it volume, speed, or win rate?
   A rep can't act on a composite they don't understand. *Fix:* on hover/expand, decompose it ("ICP 2 ranks
   first: 2× the win rate of ICP 1 and a 40% shorter cycle, despite fewer companies").
2. **No trend / "what changed."** Everything is point-in-time. The most useful insight for a returning rep is
   *movement*: "ICP 3's win rate dropped 12pts this quarter," "you closed 2 deals since Tuesday." *Fix:* use
   `crm_deal_stage_history` + period actuals to show deltas.
3. **No pacing against the target.** `GET /api/coverage/target` already returns prior periods, but attainment
   isn't rendered. The single most motivating insight — "you're at 38% of target with 4 weeks left, behind
   pace" — doesn't exist yet. *Fix:* build the attainment row (target vs closed-won-in-period vs open pipeline).
4. **The plan stops at "source N contacts."** It doesn't connect to *which* companies/personas, or sequence
   the work. *Fix:* tie each to-buy directly into a pre-scoped data-request (ICP recipe + count) and rank the
   ICPs into a "do this first" order, not just a list.

### C. Does the user know what they're looking at, and what to do? (your priority)

This is the gap you called out, and it's the one most likely to make the page fail in front of a rep.

1. **No top-line verdict.** A rep opening Coverage should get one sentence first: *"You're on track for
   $2M — keep sourcing for ICP 2"* / *"Behind pace; your best ICP is out of supply — broaden it or extend the
   quarter."* Right now the answer is scattered across a red banner, a green insight, a shortfall note, and a
   table. *Fix:* a single status header that resolves to **on-track / behind / blocked / no-target** with the
   one reason and one next action.
2. **The three tiers aren't visually legible.** A first-time user sees a wide table + a target card with no
   sense of the progression (coverage → performance → plan) or which one matters right now. *Fix:* visually
   separate the tiers, and gate/teach: empty-state copy that says what the page is for and what to connect.
3. **"Where am I looking?" — columns need explaining.** Throughput especially, but also the mix of
   sourced-coverage columns and CRM-performance columns in one 11-wide table is confusing and scrolls
   horizontally. *Fix:* inline tooltips/definitions; consider splitting "coverage" vs "performance" into
   distinct, labelled sections rather than one table.
4. **"Do I have a problem?" isn't answered crisply.** Tier-1 has a red gap banner; tier-3 has a shortfall
   note; tier-2 has no problem signal at all (e.g. an ICP whose win rate is collapsing). *Fix:* a unified
   problem/attention model across all three tiers feeding the top-line verdict.
5. **"What do I do next?" isn't prioritized.** CTAs exist (Source, ask the agent) but the page presents
   options, not a recommendation. *Fix:* one primary recommended action, with the rest secondary.
6. **First-run / no-CRM / no-target states need designing.** Each is currently a degraded version of the full
   page rather than a purpose-built "here's how to light this up" moment.

---

## Suggested next sequence

1. **Trust the numbers** — measure per-ICP contact→deal conversion; surface unattributed deals + confidence.
   (Without this, polishing the UI polishes wrong numbers.)
2. **Top-line verdict + attainment pacing** — the single status header and target-vs-actual row. This alone
   answers "do I have a problem / where am I / what next" for most visits.
3. **Make insights legible** — throughput decomposition, trend/"what changed," tier separation + tooltips.
4. **Close the loop on action** — to-buy → pre-scoped data request; one prioritized next step.

## Known carve-outs / dependencies
- **Per-rep targets** need the separate **seats** track; today the target is per-user (forward-compatible).
- **Billing / credit enforcement** deferred (matters once the org credit pool lands).
- Left intentionally unchanged (neither is the page name): priorities source kind `pipeline-health`, data API
  `/api/pipeline/icp-cards`.

## Pointers
- Page: `app/coverage/page.tsx` · Engine: `lib/coverage/*` · APIs: `app/api/coverage/*`, `app/api/pipeline/icp-cards/route.ts`
- Agent tool: `set_gtm_target` in `app/api/agent/chat/route.ts`
- Tests: `npm run test:coverage-allocation`
- Original plan: `~/.claude/plans/1-i-want-you-synthetic-aho.md`
