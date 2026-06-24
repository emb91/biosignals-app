# Arcova Backlog

## Product briefing — for agents

### What Arcova is

Arcova is a **biotech-specific data sourcing and intelligence layer**. It is not a CRM, not a sequencing tool, and not a workflow product. It sits behind the tools CROs already use (HubSpot, LinkedIn Sales Nav) and makes their data smarter.

### The customer

CROs at early-stage biotech companies. They typically have HubSpot with ZoomInfo data, but their contacts are stale, their TAM/SAM coverage is incomplete, and they have no systematic prioritisation process. Their current workflow: open HubSpot, pick accounts by gut feel, go to Sales Nav, find people, send emails. No signal awareness, no fit scoring, entirely manual.

### The core insight from customer research

CROs think they have a data problem solved because they have thousands of contacts in HubSpot. What they actually have is stale contact details, poor TAM/SAM coverage, and no fit context. The pain they articulate is "I don't know who to reach out to." The real pain is "I don't have good enough data."

### The four value layers — in build order

**Layer 1 — Data quality** (largely built)
Clean, enrich, and score what's already in HubSpot. Prove that the data is better. This is the wedge — the reason a CRO connects Arcova to their HubSpot in the first place.

**Layer 2 — Outreach context** (partially built)
Company summaries, ICP fit breakdowns, competitor data, customer segments — the raw material for "here's what to say when you reach out." Talking point generation per contact is the near-term build.

**Layer 3 — Coverage / new data** (not built)
Find net-new contacts at good-fit companies the user already knows, and net-new companies in their SAM they don't have at all. This is the upsell once the base is sticky. Surfaces via the Accounts page.

**Layer 4 — Signals / readiness** (not built)
Arcova should not just track raw events. It should infer **readiness** from many underlying life-sciences signals. Fit gets the shortlist; readiness tells you **when to work an account now**; reason tells you **what changed and what likely problem now exists**. The core readiness dimensions are: `new_budget`, `new_needs`, `new_people`, `new_strategy`, and `caution`. Biotech-specific signals (CMC hiring, phase transitions, manufacturing expansion, regulatory milestones) are the moat because they map to real buying conditions, not generic activity noise.

### The product sequence

1. **HubSpot sync** — closes the data quality loop, delivers the enriched/scored data where the CRO works
2. **Monitoring infrastructure** — built on top of sync, watches for changes that trigger re-enrichment
3. **Signals** — built on top of monitoring infrastructure
4. **Coverage / new data** — the upsell once the base is sticky

### What Arcova is not trying to be

- Not replacing HubSpot or Sales Nav
- Not a first-party signal tracker (email opens, website visits — those stay in HubSpot)
- Not a sequencing or outreach tool
- Not a place people live day-to-day long-term — the UI is a configuration and review surface; the value is delivered into HubSpot

### The moat

Biotech-specific ICP modelling, taxonomy (therapeutic areas, modalities, development stages), and signal awareness. Generic tools cannot replicate this without domain knowledge baked into the scoring and enrichment pipeline.

---

## Pre-launch readiness (engineering / ops)

Operational gates to clear before going live — distinct from product/feature work. None of these are built yet.

- [ ] **Automate backups.** Scheduled, verified backups of the Supabase/Postgres database (and any other stateful stores). Test a restore — an untested backup is not a backup.
- [ ] **Set up error monitoring.** Wire Sentry (or similar) across the Next.js app, API routes, and cron/monitor jobs, with alerting on new or spiking errors.
- [ ] **Separate staging and production environments.** Distinct Supabase projects, env vars, and deploy targets so changes are validated in staging before they touch customer data. (Also fixes the current gap where Vercel crons only fire on a live prod deploy — see the press-release monitor note below.)
- [ ] **Document how to roll back a deployment.** A written, tested runbook for reverting a bad deploy (app + any migration), including who runs it and how to verify recovery.
- [ ] **Senior architecture review.** Have a senior engineer spend 5–10 hours reviewing the architecture — data model, multi-tenancy/RLS, enrichment cost paths, sync reliability — before launch.
- [ ] **Enable Supabase leaked-password protection.** This is the only remaining Supabase security-advisor warning after the June 19 database hardening pass. It requires Supabase Pro or above and cannot be enabled with a database migration. In the Supabase dashboard, open **Authentication → Providers → Email**, enable **Prevent use of leaked passwords**, then re-run the Security Advisor and confirm `auth_leaked_password_protection` is cleared. Reference: https://supabase.com/docs/guides/auth/password-security
- [ ] **🔴 MUST FIX — fit-gate the hiring monitor's company selection.** The hiring-signal monitor (`lib/signals/run-hiring-monitor.ts:655-674`) is **fit-blind**: it scrapes LinkedIn jobs (Apify, `curious_coder/linkedin-jobs-scraper`) for *every* non-archived company in the account, selected only by `user_companies` then `slice(0, 200)` — an **arbitrary first-200 cap with no `company_fit`/`priority`/`readiness` filter**. Two problems: (1) wastes Apify + classification budget scraping/classifying low-fit companies; (2) at >200 tracked companies it monitors an *arbitrary* subset and can skip the highest-fit accounts entirely. Fix: order/threshold the selection by company fit/priority so we monitor the top-N *high-fit* companies — cuts spend **and** sharpens signals (the job-count budget stops being split across junk; see the "N companies share one tiny budget" note at `run-hiring-monitor.ts:483`). **Also audit the funding/taxonomy monitors and the recurring re-enrichment cron (`contact-enrichment-queue`) for the same fit-blind gap** — same lever, likely same issue (re-enrichment is fit-*ordered* but not fit-*gated*). This is the "fit-gate routine work" cost lever from `strategy/pricing/pricing-model-codex-20260619/PRICING_AND_COST_BASIS.md` §7 (Lever B), applied to signals. Cost + signal-quality risk if shipped fit-blind.

---

## Accounts window (Phase 2 — upsell / new data motion)

The Accounts page is a separate product motion from Leads. Rather than "work what you have", it's "here are your best-fit companies — do you have the right coverage?"

- Rank all enriched companies by ICP company fit score, regardless of whether contacts exist.
- For companies where contacts exist, show how many and a summary contact fit indicator.
- For companies where no contacts (or no good-fit contacts) exist, surface a prominent gap — "0 contacts" or "no contacts matching your buying team profile".
- The "Enrich" / "Find contacts" CTA on a coverage gap is the paid upsell moment: this is how Arcova sells new data to users who believe their CRM data is already fine.
- Key insight from customer research: prospects say "I have 14,000 contacts in HubSpot, my data is fine" — but when shown a ranked list of perfect-fit companies they have zero coverage on, the gap becomes undeniable.
- This is a product-led growth mechanic: the value is visible before the purchase.
- Do not build this as a filter on the Leads page — it is a distinct mode of working and deserves its own window.

## Product direction — core thesis

Arcova is a **data enrichment and intelligence layer that sits behind HubSpot**, not beside it. The user (CRO) works in HubSpot and LinkedIn Sales Nav as normal — Arcova's job is to answer the question they currently skip: which accounts should I be working right now, and who specifically should I talk to.

The workflow Arcova replaces: open HubSpot → pick some accounts by gut feel → go to Sales Nav → find people → send emails. No prioritisation, no signal awareness, entirely manual.

The Arcova loop:

1. Sync contacts from HubSpot
2. Enrich and score against ICP (fit score)
3. Monitor public signals on high-fit accounts (trigger layer)
4. Surface a short prioritised list with context — who to contact today and why
5. Forward: one-click to LinkedIn profile with talking point
6. Backward: push enriched data + fit scores back to HubSpot as custom fields (never overwriting native fields)

**Key decisions:**

- Arcova owns fit score and signals. HubSpot owns contact identity. No field conflicts.
- Multiple email fields: HubSpot native email untouched, Arcova verified email as a custom property. Only surfaced if meaningfully different.
- Leads view is a monitoring/review surface, not an action surface. Action happens in LinkedIn and HubSpot.
- Signals are triggers, not ranking inputs. Fit gets the shortlist, signals tell you when to act and what to say.
- Signal strength hierarchy: pricing enquiry > demo request (strong) → webinar attendance, content download (medium) → LinkedIn engagement, post comments (weak). Mostly third-party/public signals — Arcova does not own first-party engagement data.

## HubSpot integration

**Sync architecture:**

- **Primary:** HubSpot webhooks — register a webhook URL, HubSpot POSTs on contact create/update. Simple to implement (one API route, signature verification, idempotent processing). Not as much infrastructure as it sounds.
- **Safety net:** nightly pull using `lastmodifieddate` filter to catch anything missed by webhooks.
- New contacts added to HubSpot overnight are picked up automatically via webhook or next nightly pull.

**Enrichment cadence:**

- **Nightly:** signal scrape on high-fit accounts
- **Monthly:** full re-enrichment of contact details
- **Triggered:** immediate re-enrichment when a signal like a job change is detected (job change = contact details likely stale)

**Push back to HubSpot:**

- Arcova fit score, signal alerts, talking points written as custom HubSpot properties
- Never touch HubSpot native fields
- Additive layer only — CRO sees Arcova fields alongside existing data in HubSpot

**Build estimate:** ~2-3 weeks total for OAuth, webhook handler, field mapping, and push-back.

## Enrichment follow-up

- Replace the mocked contact details drawer with a real second-pass contact enrichment source.
- Replace the mocked company details drawer with a real firmographic/company enrichment source.
- Decide the production source of truth for current company and current role.
- Revisit Apollo phone reveal via webhook flow once credit impact is clear.

### Contacts canonical split — mirror companies Phase 1d (planned refactor)

**Problem.** Contacts are fully per-user: `contacts` carries `user_id` AND the entire enriched payload (linkedin_url, profile/linkedin enrichment, employment history, bio, photo, discovered emails/phones). There is NO canonical shared person record and NO `user_contacts` layer — and no global person/profile enrichment cache (companies have `company_resolution_cache`; people have nothing). So when two users have the same person (same LinkedIn), each is enriched and **paid for separately**. Confirmed live: `afernandes@illumina.com` exists as two independently-enriched rows across two accounts (emma@arcova.bio + a test account). This contradicts the deliberate "enrich once, pay once" model that companies already follow.

**Target shape (mirror companies / user_companies):**
- **Canonical person record** — keyed on `linkedin_url` (today's `UNIQUE(user_id, linkedin_url)` becomes global `UNIQUE(linkedin_url)`); NO `user_id`. Holds the PAID enrichment: identity, job title, seniority, business area, employment history, bio, photo, location, linkedin-resolution + profile-enrichment status, enrichment-discovered emails/phones. Enriched once, shared.
- **`user_contacts` per-user layer** — `(user_id, person_id)` + per-user fields: contact-fit score/breakdown + `scored_against_persona_id` (depends on the user's personas), readiness + priority mirror, attribution, CRM links, user-added emails/phones (`contact_emails.category='user'`), user edits/overrides, `archived_at`, the user's company association.

**Scope.** Large — Phase-1d-sized. Touches: enrichment pipeline, import/dedup, contact-fit + readiness, `/api/leads` + `/api/leads/[id]`, contacts page, outreach, HubSpot sync, attribution. Every reader of `contacts` is affected.

**Timing.** The double-pay only bites when multiple users overlap on the same person. Today that's just the main account + one test account, so current cost is negligible — this is a **"before multi-tenant scale"** refactor, not an emergency. Do it as a deliberate staged migration (field-by-field canonical-vs-per-user split first), the way the companies split was done. See [[project_scoring_model]] / Phase 1d for the precedent.

## Email & deliverability (today follow-ups)

### Email change on /my-profile — Supabase confirm flow + Resend SMTP
- Unlock the email field on `/my-profile` and route changes through `supabase.auth.updateUser({ email })`. This is the SAME confirm-by-click flow as signup — just a different trigger: Supabase emails a verification link to the new address (enable "Secure email change" to also confirm from the old one), and the swap only lands after the click. No custom token system on our side.
- Set up **Resend as Supabase Auth's custom SMTP provider** so auth emails actually deliver in production (built-in sender is rate-limited / not for prod). One config change upgrades ALL auth emails at once (signup, magic link, recovery, email change).
- Our code stays small: unlock field + `updateUser` call + a "check your inbox to confirm" state.

### Contact email validation at the outreach gate
- Validate a contact's email only when readiness/priority crosses the reach-out threshold (the first point the email is actually used → result is fresh + we only spend on contacts we'll email). NOT at import or on fit alone — high-fit/low-readiness emails go stale before they're ever sent.
- **Skip Apollo-`verified` emails** (Apollo already SMTP-checked those) — only spend the verifier on `extrapolated` / `unavailable` / null statuses.
- Lift Apollo's raw `email_status` (currently discarded — lives only in `apollo_person_raw.email_status`) into a real deliverability column. NOTE: this is DISTINCT from our existing `contacts.email_status` column, which is a domain-alignment heuristic (`aligned_current` / `stale_suspected` / `missing`), NOT a deliverability check.
- **Big red flag in the UI when a contact's email isn't validated**, so unverified addresses can't quietly enter a sequence.
- Keep lemlist's send-time verification as the final backstop.
- Provider TBD (NeverBounce / ZeroBounce / Apollo's verify endpoint).

## Product workflow

- Bring company, role, fit, and intent into the main Leads working view once the second-pass resolver is ready.
- Design the paid upgrade experience for contacts held back by the enrichment cap.
- Decide whether fit and intent scoring runs automatically or via explicit user action.
- Enforce minimum required fields during the data upload step so rows without enough information to resolve and enrich are blocked or clearly flagged before import.

## Agentic unlocks / micropayments

- Explore whether Arcova should support **on-demand paid unlocks** for specific high-value actions rather than only full subscription gates.
- Candidate unlock types: premium contact reveal/verification, deep company enrichment, premium signal checks, or a paid "why now" account analysis pack.
- The best fit is likely **agent-triggered third-party data procurement behind the scenes**: Arcova decides when a paid lookup is worth it, runs it, and returns the result without making the user think about payment rails.
- Treat this as a **later-stage monetization/distribution pattern**, not a core prerequisite for readiness or route.
- Do not make crypto, wallets, or x402-style payment mechanics part of the primary CRO experience unless they clearly remove friction rather than add it.
- If pursued, the user-facing product language should be "unlock deeper analysis" or "run premium check", not blockchain/payment-rail language.
- Validate first which premium lookups are actually worth buying on demand before choosing any agent-payment infrastructure.

## Custom signals (paid bespoke build)

A **paid add-on**: signals a customer wants that we don't currently produce, which we build out bespoke for a fee. The standard catalog ships with the always-on public-data signals (clinical, regulatory, funding, patents, etc.); anything beyond that is a custom build, priced per signal / per integration. The engine already supports it — a custom signal writes into the existing `signal_source_events` pipeline and flows through normalization → readiness → reason with no new scoring code, so the cost is in sourcing/classification, not the scoring engine.

**Headline candidates — first-party engagement** (dormant catalog keys; the obvious first paid builds because the data lives in the customer's stack and we'd wire it in for them):
- `demo_requested`, `inbound_enquiry` — strongest first-party intent
- `attended_your_webinar_or_event`, `downloaded_your_content` — medium
- `visited_your_website`, `responded_to_previous_outreach` — weak/contextual

These match the doctrine's strength hierarchy: pricing enquiry > demo request (strong) → webinar / content (medium) → site visit / engagement (weak). Note the doctrine says first-party engagement "stays in HubSpot" — a custom build is the paid exception: we integrate the customer's source so it rolls into readiness without Arcova becoming a weblytics product.

**Other bespoke candidates** (catalog entries with no live monitor — could be built per-customer):
- `principal_investigator_new_trial`, `distressed_financing`, `lapsed_customer`, `conference_presentation`, `conference_speaker`

(NOT candidates — these are already live: function-specific hiring `cmc_hiring`/`clinical_ops_hiring`/`regulatory_hiring`/etc. ARE emitted by the jobs-delta hiring monitor, which classifies each scraped LinkedIn posting into a role family; and `new_facility`/`facility_expansion`/`commercialization_move`/`acquisition_distraction` are emitted by the press-release + SEC monitors. The signal key is built dynamically from the classifier output, so a literal grep for `signalKey: 'cmc_hiring'` misses them.)

**Open questions:** pricing model (one-off build fee vs. recurring per-signal); whether a custom build is exclusive to the commissioning customer or folded back into the standard catalog; sourcing cost/feasibility per signal (some need a paid data source or a custom scraper).

## Product storytelling and reveal

- Make the product feel more like Arcova is actively doing work on the user's behalf, rather than silently outputting tables and boxes.
- Add a clearer reveal of what Arcova did with the data after company analysis and lead enrichment.
- Show flow progress in a more agentic way, using step-by-step processing language that makes the work visible.
- Explore subtle animation or motion to support the sense of analysis, reveal, and payoff without feeling gimmicky.
- Rework underwhelming result moments so the user sees the transformation from raw input to resolved insight.

## My Profile

- Build a "My Profile" step in the setup flow, styled and structured like the My Company page.
- Scrape and enrich data on the individual user (name, role, LinkedIn, background) rather than the company.
- Store the output against the user record for use in positioning, outreach personalisation, and context-aware messaging later in the product.

## Onboarding flow

- Redesign onboarding so it feels guided and sequential rather than optional and open-ended.
- On first login, show a much simpler screen with only the first required action instead of the full product shell.
- Hide or defer other tabs, navigation items, and secondary destinations until the user completes the current onboarding step.
- Make the first-run experience feel like there is only one obvious button to press, so the user naturally follows the next prompt.
- Turn onboarding into a structured sequence of steps, with each screen clearly telling the user what to do next.
- Add visible progress cues such as "Step 1 of 4", "Step 2 of 4", and so on, so the user knows where they are and how much setup is left.
- Keep the layout more minimal during onboarding so the user is not distracted by empty states, advanced functionality, or unfinished areas of the product.
- Reintroduce the broader navigation only after the user has completed the key setup flow.

## Data acquisition — target counts and tolerances

User expectation and contracts should **not** treat requested volumes as exact guarantees. Market size, source coverage, and ICP strictness all cap what is achievable.

**Principles**

- Communicate a **target**, not a promise (e.g. “aim for ~1,000 companies,” not “deliver 1,000”).
- Define a **tolerance band** that scales with batch size: e.g. an absolute band for small batches (such as ±50) and a **percent band** for large batches (e.g. 2–5% of target), using whichever framing is clearest in the UI.
- **Bias toward under-delivery** versus over-delivery relative to the stated target: overshooting what the user hoped for is worse for trust and usage than a shortfall that still lands inside the stated band.
- **Zero is a valid outcome** when criteria are too narrow or external supply is exhausted. Copy should explain why (criteria, screening budget, source pool) instead of accepting low-quality rows just to hit a number.

**Engineering alignment (when we implement)**

- Treat user-entered `target_company_count` (and analogous contact targets) as a **ceiling**: stop once reached; do not keep sourcing “extras” unless the user explicitly opts in.
- If the runner stops early, surface **requested vs delivered** and the reason (supply exhausted, screening cap, low qualification rate).
- Optional: derive tolerance rules in code (e.g. `max(floor(target * pct), minAbsoluteDelta)`) so small jobs get sensible messaging, not noisy percentages.

**Testing note**

- During end-to-end testing, validate messaging and metrics when delivered count is below target, within band, and zero.

## Readiness model (signals -> inference -> reason)

Use this as the canonical product and data model for signals. Arcova should ingest many source-specific events, normalize them, infer commercial readiness states, and then generate an explanation that agents and users can act on.

### The readiness dimensions

- `new_budget`: evidence that fresh capital, approved spend, or purchasing capacity likely exists.
- `new_needs`: evidence that operational, clinical, manufacturing, regulatory, or commercial complexity has increased.
- `new_people`: evidence that a new owner, buyer, champion, or team is now in place.
- `new_strategy`: evidence that the company has changed direction, scope, program mix, market focus, or partnership posture.
- `caution`: evidence that timing may be poor, budgets may be constrained, or activity is misleading rather than actionable.

### What the product should do

- `fit` answers: should we care about this account at all?
- `readiness` answers: is something meaningful happening now?
- `reason` answers: what changed, why it matters commercially, and what likely problem now exists?
- `route` answers: who is most likely to care inside the account?

### Design principle

- Do not optimize for a giant flat signal list.
- Optimize for a clean inference system where many raw events roll up into a small number of readiness dimensions.
- Preserve the underlying evidence so agents can reason over it and cite it.

## Normalized signal families -> readiness dimensions

These are the canonical signal families. They are not the final product output; they are the normalized building blocks that feed readiness.

### `new_budget`

- Funding and capital:
  - `funding_round`
  - `grant_award`
  - `ipo_or_follow_on`
  - `milestone_payment`
  - `ma_event`
  - `partnership_with_upfront_economics`
- First-party commercial intent:
  - `demo_requested`
  - `inbound_enquiry`
  - `open_opportunity_in_crm`

### `new_needs`

- Clinical and regulatory progression:
  - `clinical_trial_registered`
  - `phase_transition`
  - `trial_site_expansion`
  - `indication_expansion`
  - `breakthrough_designation`
  - `fda_approval`
- Manufacturing / facilities / quality:
  - `new_facility`
  - `facility_expansion`
- Demand/engagement signals:
  - `visited_your_website`
  - `attended_your_webinar_or_event`
  - `downloaded_your_content`
  - `responded_to_previous_outreach`

### `new_people`

- Team buildout and hiring:
  - `cmc_hiring`
  - `clinical_ops_hiring`
  - `regulatory_hiring`
  - `bd_hiring`
  - `commercial_hiring`
  - `job_surge`
- Contact movement:
  - `new_to_role`
  - `recently_promoted`
  - `recently_changed_company`
  - `new_internal_role`
  - `title_change`

### `new_strategy`

- Strategic and portfolio change:
  - `partnership_deal`
  - `licensing_deal`
  - `co_development_deal`
  - `commercialization_move`
  - `indication_expansion`
- Scientific / market visibility that may support a strategy shift:
  - `publication`
  - `new_paper_published`
  - `patent_filed_or_granted`

### `caution`

- Negative or suppressive conditions:
  - `trial_failure_or_halt`
  - `program_discontinuation`
  - `restructuring`
  - `distressed_financing`
  - `acquisition_distraction`
  - `leadership_churn`
  - `lapsed_customer`

## Inference rules (how Arcova should think)

### Core rule

- Raw source events are never shown as the product abstraction by themselves.
- Each raw event is normalized into one or more canonical signal types.
- Each canonical signal type contributes to one or more readiness dimensions.
- Readiness dimensions are scored independently, then combined into an overall readiness assessment.

### Scoring inputs

Each readiness dimension should consider:

- `signal_strength`: how strong the signal is as a buying-intent proxy in general.
- `relevance`: how relevant the signal is to the buyer function or vendor category.
- `recency`: how fresh the event is right now.
- `confidence`: how confident Arcova is that the signal was detected and classified correctly.
- `compound_support`: whether multiple related signals are appearing together.
- `suppression`: whether caution signals should reduce or cap readiness.

### Recency / decay

- Funding and major strategy changes should persist longer, but still decay over time.
- Hiring and role changes should be strongest in the first 30-120 days.
- Clinical and regulatory milestones should be strongest around the milestone window and then decay.
- Conferences, publications, and visibility signals should be short-lived and mostly supportive.

### Compound logic

Readiness should increase materially when multiple dimensions co-fire.

Examples:

- `new_budget` + `new_needs` = likely vendor evaluation window
- `new_needs` + `new_people` = likely execution and tooling/services gap
- `new_strategy` + `new_people` = likely re-evaluation or new mandate
- `new_budget` + `new_needs` + `new_people` = high-priority account

## Reason model

`reason` is the product explanation layer generated from current readiness state plus evidence. It should be regenerated whenever readiness changes; it should not be a manually maintained text field.

### What `reason` should contain

- what happened
- which readiness dimensions are active
- why this likely matters commercially
- which buyer functions are likely affected
- how strong/confident the inference is
- what the likely outreach angle is

### `reason` output shape

- `summary_short`: a one-line explanation for lists and compact surfaces
- `summary_long`: a richer explanation for drawers, agents, and account detail
- `why_now`: direct statement of why this account appears timely now
- `affected_functions`: likely stakeholders or pain-owning teams
- `suggested_angle`: plain-English outreach angle or hypothesis
- `confidence_label`: low / medium / high

### Example `reason`

- `summary_short`: Recently funded and expanding CMC operations.
- `summary_long`: The account raised fresh capital, is hiring into CMC, and appears to be scaling manufacturing operations, suggesting both new budget and increased execution complexity.
- `why_now`: This looks like a near-term vendor evaluation window rather than a passive good-fit account.
- `affected_functions`: CMC, Tech Ops, Quality
- `suggested_angle`: Support scale-up, manufacturing readiness, and operational execution.

## Signal evidence model

Agents should not read only prose. They should receive structured signal context plus evidence.

### Raw evidence object

Each underlying event should preserve:

- `signal_event_id`
- `entity_id`
- `entity_scope` (`company` or `contact`)
- `signal_type_raw`
- `signal_type_normalized`
- `source`
- `source_url`
- `event_at`
- `observed_at`
- `excerpt`
- `confidence`

### Inference object

For each account, Arcova should compute:

- `overall_readiness_score`
- `overall_readiness_label`
- `new_budget_score`
- `new_needs_score`
- `new_people_score`
- `new_strategy_score`
- `caution_score`
- `confidence_score`
- `freshness_score`
- `affected_functions`
- `top_supporting_signal_event_ids`

## Agent context contract

Every agent working an account should receive structured signal context, not just a page of prose.

### Required payload sections

- account identity and fit summary
- readiness dimension scores and labels
- top supporting evidence
- computed reason object
- route context (best people/functions to approach)
- confidence and freshness indicators

### Example account signal context payload

```json
{
  "account_id": "acct_123",
  "fit": {
    "score": 91,
    "label": "high"
  },
  "readiness": {
    "overall_score": 0.84,
    "overall_label": "high",
    "new_budget": {
      "score": 0.82,
      "label": "high",
      "confidence": 0.9,
      "evidence_ids": ["sig_1", "sig_2"]
    },
    "new_needs": {
      "score": 0.76,
      "label": "high",
      "confidence": 0.88,
      "evidence_ids": ["sig_3", "sig_4"]
    },
    "new_people": {
      "score": 0.61,
      "label": "medium",
      "confidence": 0.8,
      "evidence_ids": ["sig_5"]
    },
    "new_strategy": {
      "score": 0.57,
      "label": "medium",
      "confidence": 0.72,
      "evidence_ids": ["sig_6"]
    },
    "caution": {
      "score": 0.12,
      "label": "low",
      "confidence": 0.7,
      "evidence_ids": []
    }
  },
  "reason": {
    "summary_short": "Recently funded and expanding CMC operations.",
    "summary_long": "The account raised fresh capital, is hiring in CMC, and appears to be scaling operations, suggesting both new budget and increased execution complexity.",
    "why_now": "This looks like an active scale-up period rather than a passive good-fit account.",
    "affected_functions": ["cmc_manufacturing", "tech_ops"],
    "suggested_angle": "Support scale-up and operational readiness.",
    "confidence_label": "high"
  },
  "top_signals": [
    {
      "id": "sig_1",
      "type": "funding_round",
      "source": "company_press_release",
      "event_at": "2026-03-18",
      "confidence": 0.93
    }
  ]
}
```

### Product rule

- The UI may render this as a signals/readiness page or account drawer.
- The source of truth should be structured records and computed fields, not manually written page copy.
- Agent prompts should consume the structured payload and optionally the rendered summary, never the summary alone.

## ICP stage criteria and funding round write-back

ICP criteria are intentional. If a user defines "Series A" in their ICP, they mean Series A — a user who's funding-agnostic simply leaves that field blank. There's no need to second-guess this with a "relationship fit" layer.

Correct behaviour when a tracked company raises and moves out of stage: fit score drops AND the funding signal fires. The salesperson sees both — the raise is good news, the stage shift is a flag — and makes their own call. The product doesn't need to protect them from their own criteria.

**Implication for funding write-back:** Once we have a reliable way to infer round stage from Form D data (amount + context), updating `funding_stage` on the company record is the right thing to do. The fit score change is correct, not a bug. For now we skip `funding_stage` only because Form D doesn't disclose the round letter — not because we want to shield the fit score from updating.

## 8-K signal enrichment — downstream data use

Structured fields extracted by the LLM classifier are currently stored in `sec_filings_local.classification` (JSONB) and passed as signal `metadata`, but nothing downstream reads them in a structured way. These are the queued follow-ups once the core signals are proven:

### 1. Leadership change: role-aware dimension routing
- Currently all `leadership_churn` signals hit fixed dimensions (`caution`, `new_people`).
- We extract `buyer_function` from 5.02 filings (CFO, CMO, VP Clinical etc.) — this should dynamically adjust which readiness dimensions get weighted up.
- A new CFO is primarily `new_budget`. A new CMO or Head of Commercial is `new_strategy` + `new_people`. A new VP Clinical is `new_needs`.
- Implementation: add a `dimensionsForLeadershipRole(buyerFunction)` helper; call it when emitting `leadership_churn` signals instead of using fixed catalog dimensions.

### 2. Bankruptcy / delisting: explicit caution alert — DEFERRED (post-MVP)
- Caution/suppression logic only adds value when a company already has high readiness AND then shows distress. That's a rare intersection.
- The downside of missing it is one ill-timed email — acceptable at MVP stage.
- Signals still fire and score still moves; data is preserved. Skip the UI alert tier and distress/reorg distinction until readiness signals are proven to drive behaviour.

### 3. Deal economics: structured signal cards
- Licensing, partnership, and financing signals extract `upfront_usd`, `milestone_max_usd`, `counterparty`, `therapy_area` — but the UI shows only the LLM's one-line rationale.
- These fields should render as a structured card: deal type, counterparty name, upfront amount, max milestones, therapy area.
- Example: "Entered $45M licensing deal with Pfizer — oncology, worldwide rights. Max milestones: $320M."
- Implementation: signal detail drawer reads `classification` from metadata and renders deal fields when present.

### 4. Restructuring: distinguish distress vs. strategic reorg — DEFERRED (post-MVP)
- Same reasoning as item 2: the nuance only matters at the intersection of high readiness + distress signal.
- A low-readiness company getting more deprioritised is a near-zero net effect. The risk of missing it is one email.
- Revisit once readiness scoring is proven to drive CRO behaviour and the signal volume is sufficient to make the distinction meaningful.

### 5. Terminated deal: ICP-relevance routing (v2)
- `terminated_deal` signals emit with `new_strategy` + `new_needs` regardless of what was terminated.
- A terminated CRO service contract is irrelevant to a tools vendor but meaningful to another CRO. A terminated pharma licensing deal is irrelevant to a service provider but signals a strategic reset.
- v2: use `counterparty_type` + `agreement_type` from the classification to filter signal relevance against the user's ICP before emitting, or weight the impact score down for irrelevant termination types.
- Implementation: in `runFundingMonitor`, after classification lookup, check if `counterparty_type` is compatible with the user's ICP vendor category before emitting. Requires ICP vendor category to be stored as a user preference.

## Source roadmap (ordered by signal value and implementation quality)

Build sources in the order that best supports readiness, not in the order that sources are easiest to name.

### Phase 1 — structured, high-confidence readiness sources

- HubSpot integration for first-party engagement and CRM-state context
- ClinicalTrials.gov for trial and program progression
- FDA/public regulatory feeds for approvals and designations
- Grants/funding/partnership datasets where structured coverage exists
- Company careers pages and job postings for hiring and team buildout

### Phase 2 — operational expansion and org change

- manufacturing/facility expansion detection
- CMC / Clinical Ops / Regulatory role classification
- contact movement and leadership-change enrichment
- CDMO / partner relationship detection where available

### Phase 3 — corroborative and narrative-enrichment sources

- PubMed
- conference programs / speaker pages
- patents datasets
- newsroom / press release scraping
- broader PR/news sources

### Phase 4 — compound readiness engine

- correlate multiple signals inside a time window
- increase readiness when dimensions co-fire
- suppress readiness when caution signals are present
- improve `reason` generation from corroborated evidence rather than single events

## What "done" looks like

- Arcova can detect source events, normalize them, and preserve evidence.
- Arcova can infer `new_budget`, `new_needs`, `new_people`, `new_strategy`, and `caution` at the account level.
- Arcova can generate a clear, agent-readable `reason` explaining why a high-fit account is worth working now.
- Agents can consume a stable structured payload for outreach, prioritization, and explanation.
- The CRO can see not just that an account is high-fit, but why it is timely now and what angle to use.

## Signals doctrine (non-negotiable)

Arcova answers two separate sales questions:

1. Fit: is this the kind of company we should care about at all?
2. Readiness: if it is a good-fit company, is something happening now that makes them more likely to buy?

Signals exist to answer the readiness question.

### Canonical model

- World change happens.
- Arcova captures raw event evidence.
- Arcova normalizes to a standard signal type.
- Signal evidence maps to readiness conditions.
- Arcova computes readiness.
- Arcova computes reason (explanation of why now).

### Readiness conditions

- `new_budget`
- `new_needs`
- `new_people`
- `new_strategy`
- `caution`

### Guardrail for all implementation work

Do not optimize for integrations or event volume by themselves.
Optimize for readiness judgment quality and sales timing insight quality.

Litmus test:

- Signal = evidence something changed.
- Readiness = judgment whether that change increases buy-likelihood now.

## Readiness mapping table (signal -> condition -> precursor/outcome -> priority)

Priority tier definitions:

- `P1`: core precursor signals for this phase (strongest readiness value).
- `P2`: useful precursor support signals (secondary build priority).
- `P3`: weak/contextual precursor signals (later).
- `OUT`: downstream outcome/state signals; do not drive readiness in this phase.
- `CS-LATER`: customer-success/retention signals; out of scope for this phase.

| Status | Signal key | Readiness conditions | Type | Tier | Source |
|---|---|---|---|---|---|
| ✅ | `phase_transition` | `new_needs`, `new_strategy` | Precursor | `P1` | clinical-trials monitor (ClinicalTrials.gov mirror) |
| ✅ | `clinical_trial_registered` | `new_needs` | Precursor | `P1` | clinical-trials monitor |
| ✅ | `trial_site_expansion` | `new_needs` | Precursor | `P1` | clinical-trials monitor |
| ✅ | `indication_expansion` | `new_needs`, `new_strategy` | Precursor | `P1` | clinical-trials + FDA monitors |
| ✅ | `fda_approval` | `new_needs`, `new_strategy` | Precursor | `P1` | FDA monitor (drugsFDA, 510k, PMA) |
| ✅ | `trial_failure_or_halt` | `caution` | Precursor | `P1` | clinical-trials monitor |
| ✅ | `program_discontinuation` | `caution` | Precursor | `P1` | clinical-trials monitor |
| ✅ | `cmc_hiring` | `new_people`, `new_needs` | Precursor | `P1` | hiring monitor (LinkedIn via Apify) |
| ✅ | `clinical_ops_hiring` | `new_people`, `new_needs` | Precursor | `P1` | hiring monitor |
| ✅ | `regulatory_hiring` | `new_people`, `new_needs` | Precursor | `P1` | hiring monitor |
| ✅ | `hiring_expansion` | `new_people`, `new_needs` | Precursor | `P1` | hiring monitor |
| ⬜ | `new_facility` | `new_needs` | Precursor | `P1` | not yet wired — needs press-release / news monitor |
| ⬜ | `facility_expansion` | `new_needs` | Precursor | `P1` | not yet wired — needs press-release / news monitor |
| ✅ | `funding_round` | `new_budget` | Precursor | `P1` | funding monitor (SEC Form D + 8-K Item 3.02) |
| ✅ | `grant_award` | `new_budget` | Precursor | `P1` | grants monitor (NIH RePORTER) |
| ✅ | `ipo_or_follow_on` | `new_budget` | Precursor | `P1` | funding monitor (SEC 424B prospectus filings) |
| ⬜ | `distressed_financing` | `caution` | Precursor | `P1` | not yet wired — V2 of funding (8-K + LLM classification, or 10-Q runway delta) |
| ⬜ | `milestone_payment` | `new_budget` | Precursor | `P2` | not yet wired — needs partnership/8-K LLM classifier |
| ⬜ | `partnership_with_upfront_economics` | `new_budget`, `new_strategy` | Precursor | `P2` | not yet wired — V2 of funding (8-K Item 1.01 + LLM) |
| ⬜ | `partnership_deal` | `new_strategy` | Precursor | `P2` | not yet wired |
| ⬜ | `licensing_deal` | `new_strategy`, `new_budget` | Precursor | `P2` | not yet wired |
| ⬜ | `co_development_deal` | `new_strategy`, `new_needs` | Precursor | `P2` | not yet wired |
| ✅ | `bd_hiring` | `new_people`, `new_strategy` | Precursor | `P2` | hiring monitor |
| ✅ | `commercial_hiring` | `new_people`, `new_strategy` | Precursor | `P2` | hiring monitor |
| ✅ | `breakthrough_designation` | `new_needs` | Precursor | `P2` | FDA monitor |
| ⬜ | `commercialization_move` | `new_strategy`, `new_needs` | Precursor | `P2` | not yet wired |
| ⬜ | `restructuring` | `caution` | Precursor | `P2` | not yet wired |
| ⬜ | `acquisition_distraction` | `caution` | Precursor | `P2` | not yet wired — could derive from M&A close 8-Ks |
| ⬜ | `leadership_churn` | `caution`, `new_people` | Precursor | `P2` | not yet wired — could derive from 8-K Item 5.02 + LinkedIn |
| ⬜ | `new_to_role` | `new_people` | Precursor | `P2` | not yet wired — contact-side monitor needed |
| ✅ | `recently_promoted` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ✅ | `recently_changed_company` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ✅ | `new_internal_role` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ✅ | `title_change` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ⬜ | `conference_presentation` | `new_strategy` | Precursor | `P3` | **orphaned** — current Sonnet+web_search monitor produces poor output; rebuild needed using targeted conference website scraping (agenda/speaker pages per event) |
| ⬜ | `conference_speaker` | `new_strategy`, `new_people` | Precursor | `P3` | **orphaned** — same; depends on conference scraping rebuild |
| ⬜ | `publication` | `new_strategy` | Precursor | `P3` | not yet wired — PubMed/biorxiv ingestion |
| ⬜ | `new_paper_published` | `new_strategy` | Precursor | `P3` | not yet wired |
| ✅ | `patent_filed_or_granted` | `new_strategy` | Precursor | `P3` | patents monitor (USPTO via PatentsView mirror) |
| ⬜ | `demo_requested` | `new_budget`, `new_needs` | Precursor | `P3` | first-party — out of Arcova scope (stays in HubSpot) |
| ⬜ | `inbound_enquiry` | `new_budget`, `new_needs` | Precursor | `P3` | first-party — out of Arcova scope |
| ⬜ | `visited_your_website` | `new_needs` | Precursor | `P3` | first-party — out of Arcova scope |
| ⬜ | `attended_your_webinar_or_event` | `new_needs` | Precursor | `P3` | first-party — out of Arcova scope |
| ⬜ | `downloaded_your_content` | `new_needs` | Precursor | `P3` | first-party — out of Arcova scope |
| ⬜ | `responded_to_previous_outreach` | `new_needs` | Outcome | `OUT` | first-party — out of Arcova scope |
| ✅ | `open_opportunity_in_crm` | `new_budget` | Outcome | `OUT` | HubSpot deal sync |
| ✅ | `new_contact_added_in_crm` | `new_people` | Outcome | `OUT` | HubSpot contact sync |
| ✅ | `closed_lost_in_crm` | `caution` | Outcome | `OUT` | HubSpot deal sync |
| ⬜ | `lapsed_customer` | `caution` | Customer-state | `CS-LATER` | deferred per phase rule |

**Status legend:** ✅ = signal currently wired and emitting to `signal_source_events`; ⬜ = catalog entry exists but no monitor emits it yet.

**Additional signals wired but not on this priority list** (catalog overflow — emitted by existing monitors, lighter-touch readiness contributions):
- Clinical-trials monitor also emits: `clinical_trial_recruiting`, `clinical_trial_completed`, `clinical_trial_sponsor_change`
- FDA monitor also emits: `fast_track_designation`, `priority_review`, `orphan_designation`, `complete_response_letter`
- Patents monitor also emits: `patent_application_published`, `patent_granted`, `new_therapeutic_area_patent`, `assignee_portfolio_acceleration`

**Roll-up (updated 2026-05-27):** Remaining P1/P2 gaps: `new_facility`, `facility_expansion`, `distressed_financing`, `milestone_payment`, `partnership_with_upfront_economics`, `licensing_deal`, `co_development_deal`, `partnership_deal`, `restructuring`, `acquisition_distraction`, `leadership_churn`, `commercialization_move`, `new_to_role`.

## Signal implementation inventory (per-monitor)

Distinct from the priority table above — this lists exactly what each running monitor emits, with company vs contact scope and the underlying data source. Useful for spotting signal-key overlap between monitors (where the same `signalKey` is emitted by multiple sources with different `source_event_id`s, so they don't dedupe via the existing constraint).

**Legend:** 🏢 = company-scope · 👤 = contact-scope · ⚠️ = signal key overlaps with another monitor (potential double-emission for the same underlying event)

| Monitor / Source | Signal key | Scope | Approach | Notes |
|---|---|---|---|---|
| **Clinical Trials** | `clinical_trial_registered` | 🏢 | ClinicalTrials.gov daily API mirror (`clinical_trials` table) | |
| | `clinical_trial_recruiting` | 🏢 | same | |
| | `clinical_trial_completed` | 🏢 | same | |
| | `clinical_trial_sponsor_change` | 🏢 | same | |
| | `phase_transition` | 🏢 | same | |
| | `trial_site_expansion` | 🏢 | same | |
| | `indication_expansion` | 🏢 | same | also emitted by FDA |
| | `trial_failure_or_halt` | 🏢 | same | |
| | `program_discontinuation` | 🏢 | same | |
| **FDA Regulatory** | `fda_approval` | 🏢 | openFDA drugsFDA + 510(k) + PMA daily mirror | |
| | `breakthrough_designation` | 🏢 | same | |
| | `fast_track_designation` | 🏢 | same | |
| | `priority_review` | 🏢 | same | |
| | `orphan_designation` | 🏢 | same | |
| | `complete_response_letter` | 🏢 | same | |
| | `indication_expansion` | 🏢 | same (PMA supplements) | also emitted by Clinical Trials |
| **Patents** | `patent_filed_or_granted` | 🏢 | BigQuery `patents-public-data` → local mirror | |
| | `patent_application_published` | 🏢 | same | |
| | `patent_granted` | 🏢 | same | |
| | `new_therapeutic_area_patent` | 🏢 | same, area inferred from abstract | |
| | `assignee_portfolio_acceleration` | 🏢 | same, velocity threshold | |
| **Funding (SEC EDGAR)** | `funding_round` | 🏢 | SEC EDGAR daily-index → Form D + Form D/A primary_doc.xml parse | structured |
| | `funding_round` | 🏢 | SEC EDGAR daily-index → 8-K Item 3.02 item-code match | item-only, no LLM |
| | `funding_round` | 🏢 | SEC 8-K Item 1.01/8.01 → Haiku classification (`financing` category) | LLM-classified |
| | `ipo_or_follow_on` | 🏢 | SEC EDGAR 424B1..B7 prospectus filings (daily-index + LLM proceeds extraction for tracked CIKs) | |
| | `licensing_deal` | 🏢 | SEC 8-K Item 1.01 → Haiku classification | |
| | `partnership_with_upfront_economics` | 🏢 | SEC 8-K Item 1.01 → Haiku | |
| | `co_development_deal` | 🏢 | SEC 8-K Item 1.01 → Haiku | |
| | `partnership_deal` | 🏢 | SEC 8-K Item 1.01 → Haiku | |
| | `milestone_payment` | 🏢 | SEC 8-K Item 1.01 → Haiku | |
| | `acquisition_distraction` | 🏢 | SEC 8-K Item 1.01/8.01 → Haiku (buyer OR target) | |
| | `leadership_churn` | 🏢 | SEC 8-K Item 5.02 → Haiku | should also emit 👤 contact when speaker matches a known contact |
| | `restructuring` | 🏢 | SEC 8-K Item 1.01/8.01 → Haiku | |
| **NIH Grants** | `grant_award` | 🏢 | NIH RePORTER v2 API (POST /v2/projects/search, SBIR/STTR activity codes + Domestic For-Profits org_type union) | |
| **Hiring (LinkedIn)** | `cmc_hiring` | 🏢 | Apify `curious_coder/linkedin-jobs-scraper`, role-family classification | |
| | `clinical_ops_hiring` | 🏢 | same | |
| | `regulatory_hiring` | 🏢 | same | |
| | `bd_hiring` | 🏢 | same | |
| | `commercial_hiring` | 🏢 | same | |
| | `hiring_expansion` | 🏢 | same, volume threshold (≥10 postings) | |
| **HubSpot — Deals** | `open_opportunity_in_crm` | 🏢 | HubSpot deals sync, deal stage state machine | |
| | `closed_lost_in_crm` | 🏢 | same | |
| | `new_contact_added_in_crm` | 🏢 | same | |
| **HubSpot — Contacts** | `new_internal_role` | 👤 | HubSpot contact title-change sync | |
| | `recently_promoted` | 👤 | same | |
| | `recently_changed_company` | 👤 | same | |
| | `title_change` | 👤 | same | |
| ~~**Conferences (web search)**~~ | ~~all~~ | — | **cut** — Sonnet+web_search approach produced poor output; pipeline removed | |
| **Press Releases (RSS + Haiku)** | partnership_deal, funding_round, ipo_or_follow_on, grant_award, licensing_deal, m&a, … | 🏢 | **ACTIVE — NOT cut.** GlobeNewswire (biotech+pharma) + PR Newswire RSS → `press_release_articles` → Haiku 4.5 classification → `runPressReleaseMonitor`. Built + verified: 230 articles ingested, successful runs 2026-05-25/26 (4 feeds, 0 failed). Cron `press-releases-delta` (daily 13:00). Currently DORMANT — Vercel crons only fire on a live prod deploy; on local-only dev nothing schedules it, so it last ran 2026-05-26. Needs a live deploy or a local scheduler. (Earlier "cut" note was reversed — the RSS+Haiku pipeline was rebuilt.) | |

**Coverage roll-up by scope:** 40 distinct company-scope emit paths · 5 distinct contact-scope emit paths.

**Catalog gaps still without any monitor** (catalog entries exist but nothing emits them):
- `new_facility`, `facility_expansion` — the press-release monitor (RSS+Haiku) is active but doesn't classify facility moves; either add those categories to the press classifier or use a targeted news/web search approach
- `commercialization_move` — same
- `distressed_financing` (P1) — V2 SEC funding classifier could emit this for debt/credit facility 8-Ks
- `new_to_role` (P2 contact) — needs a contact-side LinkedIn / HubSpot signal
- `new_paper_published`, `publication` — PubMed API; not yet built
- `lapsed_customer` (CS-LATER — deferred per phase rule)

**Open architectural decisions (consequences of the inventory):**

1. **Press releases cut.** Monitor removed. Signals `new_facility`, `facility_expansion`, `commercialization_move` now have no active source — need targeted per-company web search approach.

2. **Contact-scope coverage is thin.** HubSpot contact lifecycle covers most of it. Biggest unlock: `new_to_role` contact-side monitor + PubMed for `new_paper_published`.

Phase rule:

- In this phase, readiness scoring should be driven by `P1/P2/P3` precursor signals only.
- `OUT` and `CS-LATER` may be stored for context/reporting, but should not increase account readiness.

---

## Company-first import ("companies I'm interested in")

**Status: BUILT 2026-06-25** (branch `codex/filter-sec-form-d-funds`). **Two-phase architecture** so any list size finishes cleanly:

*Phase 1 — import (fast, bulk, never times out):*
- `lib/apollo.ts` — `bulkEnrichOrganizationsWithApollo()` uses Apollo `organizations/bulk_enrich` (10 domains/call) for a fast firmographic pass; shared `mapApolloOrganization` mapper.
- `lib/company-import.ts` — normalize/dedup rows, contactless find-or-create + workspace link, then: bulk-enrich domains → seed firmographics → preliminary (firmographic) fit → mark each company `enrichment_refresh_status='requested'`. Lands the whole list in one pass.
- `app/api/import-companies/route.ts` — `preview:true` returns cost + dedup breakdown with zero spend; real call creates an `upload_batches`+`raw_uploads` batch and fires phase 1.

*Phase 2 — deep enrichment (cron-drained, billed per success):*
- `app/api/cron/company-enrichment-queue/route.ts` — every 5 min, drains companies in `requested` state through the full `runCompanyEnrichmentById` (Apollo identity + Apify + taxonomy + narrative), reserves/settles `company_enrichment` credits per company (refund on failure), upgrades each linked user's fit, reclaims stale `running` rows. Registered in `vercel.json`. Mirrors `contact-enrichment-queue`.
- `supabase/migrations/20260624115336_companies_enrichment_status_allow_requested.sql` — adds `'requested'` to the companies status CHECK constraint (applied via MCP).

*Shared / UI:*
- `lib/data-acquisition/job-runner.ts` — fit gate at `runContactsAtCompanyJob` flipped block → warn (`lowCompanyFitPurchaseWarning`).
- `app/companies/CompaniesWorkspace.tsx` — 0-contact copy de-assumes a departure ("No contacts yet" / "Find contacts"); `'requested'` treated as in-progress so queued companies show the enrichment banner + keep polling.
- `app/import/page.tsx` — "Upload companies" card + company mapping + cost-confirm dialog + completion copy ("first-pass fit now, deeper fit over the next few minutes").

Why two-phase: `bulk_enrich` only collapses the (cheap, fast) Apollo step; the real bottleneck is the per-company Apify scrape + web-search taxonomy (the biotech fit moat — does NOT come from Apollo). So phase 1 lands everyone instantly with a firmographic fit; phase 2 deepens to the real fit in the background without a timeout at any list size.

**VERIFIED LIVE END-TO-END 2026-06-25** on the `emma+biopharmtest2` workspace (org `BioReach Partners`). Imported 10 real US biotech drug developers (Arcus, Denali, Kymera, Arcellx, Nuvation, Tango, Annexon, Immunome, Neurocrine, CARGO):
- Phase 1: Apollo `bulk_enrich` returned real firmographics for all 10 (employees/HQ/founded/industry) — **the live bulk format (`domains[]` → `organizations` array, index-aligned) is confirmed**. All landed `requested` with 0 contacts.
- Phase 2: cron drained all 10 to `succeeded` with real taxonomy (company_type Biotech/Biopharma; TAs Oncology/Neuro/Immuno; modalities Cell Therapy/CAR-T, Small Molecule, Antibody, ADC; dev stages) and fit upgraded to **0.72–0.88 (all high-fit)**. Confirmed in the Companies UI: all 10 show "Biotech / Biopharma · 0 contacts · Source" CTA.
- **Bug the real test caught that preview could not:** the canonical `companies` table has NO `source` column (it moved to the org_companies/user_companies link rows). The stub insert included `source` and failed all 10 rows with a PostgREST schema-cache error. Fixed: dropped `source` from the `companies` insert in `findOrCreateCompany` (kept on the link rows). This is exactly why a real import was worth running.

Earlier preview checks also passed: preview cost math (1×3=3), owned-dedup, in-file dedup, invalid-row detection, cron auth-guard (401); typecheck clean.

**Follow-ups:**
- *Preliminary-fit coverage:* after phase 1, only 1/10 had a preliminary (firmographic) fit — ICP matching without taxonomy is weak, so most stay null until phase 2 scores them (minutes later). The "eager" benefit is therefore thin in practice; consider a lightweight firmographic-only ICP match so more rows show a provisional fit immediately. Phase 2 fills all of them regardless.
- *Very large lists:* phase 1 bulk-enriches in one `after()` pass — fine for hundreds (~30 Apollo calls for 300). For thousands, chunk phase 1 too (un-processed `pending` raw_uploads currently wouldn't get drained).
- *Test-harness note (not a prod bug):* draining the cron via `curl -m 290` sometimes cut the client off mid-batch, leaving a row `running`; the route still completed server-side, and the 15-min stale-`running` reclaim covers true crashes. On Vercel the function runs to its 300s ceiling without a client disconnect.

**Problem.** The import page is contact-first: every row needs a person identifier *and* a company, and both feed Apollo `people/match` enrichment. A user who has a strong list of *companies* but no known contacts there has no way in. Companies today are only ever created as a side-effect of a contact import (the ingestion RPC hard-requires a `linkedin_url` on the contact), so a contactless company is not a creatable state.

**Goal.** Let a user paste/CSV a list of companies, enrich + fit-score them, and land them in `/companies` (= `/accounts`, the CompaniesWorkspace) as records with `0 contacts`. Buying contacts stays a separate, user-initiated action via the existing `/data` flow.

**Agreed design (decisions locked with Emma):**

1. **One-stage import with cost shown upfront.** Upload immediately enriches + fit-scores, but a confirm dialog previews the spend first ("412 companies → 412 credits. Proceed?"). Company enrichment is Apollo org enrich at **1 credit/company** (`lib/data-acquisition-metering.ts` → `apollo_company_enrichment: 1`) — it is *not* free, so the cost must be explicit before it runs.
2. **Land in `/companies` with `0 contacts`, not triage.** Triage is contact-readiness; a 0-contact company has nothing to triage. `list_user_accounts` already returns `contact_count = 0` cleanly, so the read side supports it.
3. **Contact buying is opt-in, never auto.** The contact column shows "0 contacts"; the user clicks through to the existing `/data` window (`mode=contacts_at_company`) to buy. No auto-sourcing.
4. **Dedup/merge on import.** A pasted company may already be an account (born from a past contact import). Route the upsert through `stickyIdentity` in `lib/company-merge.ts` — merge, never duplicate.
5. **Insufficient-info rows fail in preview.** Same pattern as contact import: a row without enough to resolve a company (no usable name/domain) is surfaced as a failed row in the import preview, not silently enriched against the wrong org. Name-only rows need an Apollo org lookup to resolve a domain; ambiguous ones surface for review.
6. **Never block a purchase — warn only.** This is a general rule, and it *changes existing behavior*: the `/data` acquisition flow currently HARD-blocks contact buys below 0.5 company fit (`lowCompanyFitPurchaseNote` + `SOURCE_COMPANY_MIN` in `lib/data-acquisition/job-runner.ts:175`). Convert that refusal into an overridable warning. Nothing is ever blocked from buying; a low-fit company shows a caution and the user can still proceed.

**Build pieces:**
- *New:* company-only import UI (paste/CSV) + cost-preview confirm dialog.
- *New:* contactless-company write path — a company upsert that skips the contact half of `ingestEnrichedRecords` (today's RPC throws without a contact `linkedin_url`).
- *New:* "0 contacts → find contacts" affordance in the contact column, wired to `openContactAcquisition` / `/data`.
- *Reuse:* Apollo org enrich + ICP fit match; `list_user_accounts` (`contact_count = 0`); `stickyIdentity` merge; the `/data` `contacts_at_company` flow (already credit-gated).
- *Change:* `job-runner.ts` fit gate from block → warn (item 6 above).

**Watch:** contactless companies won't ride the monthly contact-driven re-enrich until they have a contact (expected). Keep UI copy customer-facing — "0 contacts", "Find contacts" — never "Apollo"/"org enrich".

---

## Apollo API — further opportunities (researched 2026-06-25)

Context from building the company-first import: we already use Apollo `people/match` (single contact enrich), `mixed_people/api_search` (people search for `contacts_at_company`), `organizations/enrich` (single) + now `organizations/bulk_enrich` (10/call), `mixed_companies/search` (expand_companies), and phone reveal. Email verification is ZeroBounce, not Apollo. Ranked by value/effort:

1. **Bulk people enrichment — `POST /people/bulk_match` (10 records/call).** *High value, medium effort.* Direct mirror of the org `bulk_enrich` we just shipped. Today contact import + `contacts_at_company` enrich people one at a time through `people/match`; batching to 10/call cuts round-trips ~10× and speeds the queue. Build a `bulkMatchPeopleWithApollo()` alongside `bulkEnrichOrganizationsWithApollo` and feed it from `processQueuedRowsInBackground`. Note: waterfall/contact-detail fields can return async via webhook — start synchronous (demographics) and only add the webhook path if needed.

2. **Headcount-growth signal — already returned, currently unused.** *High value, LOW effort (near-free).* `organizations/enrich` already returns `organization_headcount_six_/twelve_/twenty_four_month_growth` (see `ApolloOrganization` in `lib/apollo.ts`) but we don't map or use them. Surface them as a "company expanding / scaling" readiness/expansion signal — zero extra API cost (the data rides on enrich calls we already make) and complements the biotech moat. Lowest-effort win here.

3. **Use `bulk_enrich` on the existing single-company paths.** *Medium.* `job_change_monitor` stub creation and `expand_companies` screening still enrich companies one at a time. Route high-volume screening through `bulkEnrichOrganizationsWithApollo` to cut provider cost on sourcing sweeps.

4. **Apollo funding fields to fill PRIVATE biotechs.** *Medium, low-ish effort.* Our funding signal is SEC-based (only covers SEC filers / public co's). Apollo returns `latest_funding_stage / total_funding / latest_funding_round_date / funding_events` for private companies SEC misses. Use Apollo as a *complement* (SEC authoritative when present, Apollo fills the gap for private/pre-IPO biotechs — a big slice of the early-stage ICP).

**Evaluated, low fit (skip unless cheap):**
- *Apollo buying-intent / news topics* — generic (web-visit intent, leadership/hiring news). Arcova's moat is biotech-specific signals (SEC/FDA/CT.gov/patents/grants/conferences); generic intent is unlikely to beat it.
- *Technographics (`technology_names`)* — captures web/SaaS stack, not lab/scientific tooling; low relevance for biotech fit.

Quickest two to ship: **#2 (headcount growth, near-free)** and **#1 (bulk people match, mirrors today's work)**.
