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
  - `cmc_scale_up`
  - `cdmo_partnership`
  - `quality_compliance_buildout`
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
  - `board_or_advisory_role`

### `new_strategy`

- Strategic and portfolio change:
  - `partnership_deal`
  - `licensing_deal`
  - `co_development_deal`
  - `regional_expansion`
  - `commercialization_move`
  - `platform_repositioning`
  - `indication_expansion`
- Scientific / market visibility that may support a strategy shift:
  - `conference_presentation`
  - `conference_speaker`
  - `publication`
  - `new_paper_published`
  - `patent_filed_or_granted`

### `caution`

- Negative or suppressive conditions:
  - `layoffs`
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
| ✅ | `job_surge` | `new_people`, `new_needs` | Precursor | `P1` | hiring monitor |
| ⬜ | `new_facility` | `new_needs` | Precursor | `P1` | not yet wired — needs press-release / news monitor |
| ⬜ | `facility_expansion` | `new_needs` | Precursor | `P1` | not yet wired — needs press-release / news monitor |
| ⬜ | `cmc_scale_up` | `new_needs` | Precursor | `P1` | not yet wired — inferred from hiring + facility combo |
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
| ⬜ | `quality_compliance_buildout` | `new_needs` | Precursor | `P2` | not yet wired — inferred from QA/QC hiring + GMP roles |
| ⬜ | `cdmo_partnership` | `new_needs`, `new_strategy` | Precursor | `P2` | not yet wired |
| ✅ | `breakthrough_designation` | `new_needs` | Precursor | `P2` | FDA monitor |
| ⬜ | `regional_expansion` | `new_strategy` | Precursor | `P2` | not yet wired |
| ⬜ | `commercialization_move` | `new_strategy`, `new_needs` | Precursor | `P2` | not yet wired |
| ⬜ | `restructuring` | `caution` | Precursor | `P2` | not yet wired |
| ⬜ | `acquisition_distraction` | `caution` | Precursor | `P2` | not yet wired — could derive from M&A close 8-Ks |
| ⬜ | `leadership_churn` | `caution`, `new_people` | Precursor | `P2` | not yet wired — could derive from 8-K Item 5.02 + LinkedIn |
| ⬜ | `layoffs` | `caution` | Precursor | `P2` | not yet wired — news / WARN Act filings |
| ⬜ | `new_to_role` | `new_people` | Precursor | `P2` | not yet wired — contact-side monitor needed |
| ✅ | `recently_promoted` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ✅ | `recently_changed_company` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ✅ | `new_internal_role` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ✅ | `title_change` | `new_people` | Precursor | `P2` | HubSpot contact sync |
| ⬜ | `board_or_advisory_role` | `new_people`, `new_strategy` | Precursor | `P3` | not yet wired |
| ⬜ | `conference_presentation` | `new_strategy` | Precursor | `P3` | not yet wired — needs conference/news scraping |
| ⬜ | `conference_speaker` | `new_strategy`, `new_people` | Precursor | `P3` | not yet wired |
| ⬜ | `publication` | `new_strategy` | Precursor | `P3` | not yet wired — PubMed/biorxiv ingestion |
| ⬜ | `new_paper_published` | `new_strategy` | Precursor | `P3` | not yet wired |
| ✅ | `patent_filed_or_granted` | `new_strategy` | Precursor | `P3` | patents monitor (USPTO via PatentsView mirror) |
| ⬜ | `platform_repositioning` | `new_strategy` | Precursor | `P3` | not yet wired — narrative-driven, needs LLM over press releases |
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

**Roll-up:** **30 of 56 catalog signals wired (54%)** as of 2026-05-21. The remaining P1/P2 gaps (`new_facility`, `facility_expansion`, `cmc_scale_up`, `distressed_financing`, `milestone_payment`, `partnership_with_upfront_economics`, `licensing_deal`, `co_development_deal`, `partnership_deal`, `cdmo_partnership`, `restructuring`, `acquisition_distraction`, `leadership_churn`, `layoffs`, `new_to_role`, `quality_compliance_buildout`, `regional_expansion`, `commercialization_move`) cluster around two missing capabilities: (1) an 8-K Item 1.01 / Item 8.01 LLM classifier for partnership/license/restructuring events, and (2) a press-release/news ingestion + classification monitor for facility, layoff, and narrative signals.

Phase rule:

- In this phase, readiness scoring should be driven by `P1/P2/P3` precursor signals only.
- `OUT` and `CS-LATER` may be stored for context/reporting, but should not increase account readiness.
