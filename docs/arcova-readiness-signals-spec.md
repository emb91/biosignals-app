# Arcova Readiness Signals Spec
## Implementation-grade planning artifact

---

## 1. Purpose

This document defines the canonical readiness model for Arcova.

Arcova already has:

- `fit`: should we care about this account?
- `route`: who should we talk to?

This spec defines what is missing:

- `readiness`: is this account more likely to buy now?
- `reason`: what changed, why it matters commercially, and what likely problem exists?

The core design principle is:

- Arcova should not primarily track raw biotech events.
- Arcova should infer a small set of commercial readiness states from many underlying signals.

Those readiness states are:

- `new_budget`
- `new_needs`
- `new_people`
- `new_strategy`
- `caution`

---

## 2. Core model

Arcova should compute readiness in 5 layers:

1. raw source events
2. normalized signal types
3. readiness dimension contributions
4. overall readiness rollup
5. computed reason output

Pipeline:

```text
source event -> normalized signal -> readiness dimension(s) -> overall readiness -> reason
```

Example:

```text
"Series B announced" -> funding_round -> new_budget -> high readiness -> "Fresh capital likely created budget"
```

---

## 3. Canonical enums

These enums should be reflected in code, storage, and prompt contracts.

### 3.1 `ReadinessDimension`

```ts
type ReadinessDimension =
  | "new_budget"
  | "new_needs"
  | "new_people"
  | "new_strategy"
  | "caution";
```

### 3.2 `SignalScope`

```ts
type SignalScope = "company" | "contact";
```

### 3.3 `SignalStrength`

```ts
type SignalStrength = "weak" | "medium" | "strong";
```

### 3.4 `ConfidenceLabel`

```ts
type ConfidenceLabel = "low" | "medium" | "high";
```

### 3.5 `ReadinessLabel`

```ts
type ReadinessLabel = "low" | "medium" | "high";
```

### 3.6 `BuyerFunction`

Use exact strings.

```ts
type BuyerFunction =
  | "executive_leadership"
  | "business_development"
  | "partnerships"
  | "clinical_operations"
  | "research_and_development"
  | "regulatory_affairs"
  | "manufacturing_and_cmc"
  | "medical_affairs"
  | "commercial"
  | "sales_operations"
  | "procurement"
  | "strategy_and_corporate_development"
  | "lab_operations"
  | "technology_and_systems"
  | "ai_and_machine_learning"
  | "data_and_informatics"
  | "quality_and_compliance"
  | "marketing";
```

### 3.7 `IntentMechanism`

These describe why a signal matters commercially.

```ts
type IntentMechanism =
  | "budget_created"
  | "complexity_increased"
  | "team_buildout"
  | "leadership_change"
  | "program_advance"
  | "strategy_shift"
  | "commercial_interest"
  | "suppression";
```

---

## 4. Readiness dimensions

These definitions should be treated as stable product semantics.

### 4.1 `new_budget`

Meaning:
- evidence that fresh capital, approved spend, or active commercial evaluation capacity likely exists

Commercial interpretation:
- budget is more likely to exist than before
- vendor evaluation is more plausible

Typical triggers:
- funding
- grants
- milestone payments
- partnership economics
- direct inbound/commercial intent

### 4.2 `new_needs`

Meaning:
- evidence that operational, regulatory, clinical, manufacturing, or go-to-market complexity has increased

Commercial interpretation:
- the account likely has a new burden, problem, or execution gap

Typical triggers:
- clinical progression
- trial/site expansion
- manufacturing scale-up
- quality/compliance buildout
- direct engagement indicating problem exploration

### 4.3 `new_people`

Meaning:
- evidence that new owners, champions, budget-holders, or implementation teams are now in place

Commercial interpretation:
- there may be a new mandate, a new evaluator, or a new stakeholder open to change

Typical triggers:
- leadership hires
- function hiring
- promotions
- company changes
- title/remit changes

### 4.4 `new_strategy`

Meaning:
- evidence that the company changed direction, scope, portfolio, market focus, or partnership posture

Commercial interpretation:
- the account may be rethinking workflows, priorities, or vendor stack

Typical triggers:
- licensing deals
- co-development
- commercialization moves
- regional expansion
- portfolio expansion

### 4.5 `caution`

Meaning:
- evidence that timing may be poor, budgets may be constrained, or apparent activity should not be treated as positive readiness

Commercial interpretation:
- suppress or qualify outreach urgency

Typical triggers:
- layoffs
- trial failure
- restructuring
- distressed financing
- acquisition distraction

---

## 5. Canonical signal catalog

Each normalized signal should map into one or more readiness dimensions. This is the core implementation artifact.

Field definitions:

- `signal_key`: exact enum value
- `scope`: `company` or `contact`
- `dimensions`: readiness dimensions affected
- `default_strength`: baseline buying-intent strength
- `default_confidence`: baseline classification confidence assuming valid source extraction
- `decay_days`: number of days before the signal contribution should decay to near-zero
- `buyer_functions`: likely affected functions
- `intent_mechanisms`: why the signal matters
- `notes`: implementation guidance

For contact-scoped signals, `buyer_functions` should usually be derived at runtime from the contact's classified function rather than hardcoded in the catalog row.

### 5.1 Budget signals

| signal_key | scope | dimensions | default_strength | default_confidence | decay_days | buyer_functions | intent_mechanisms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `funding_round` | company | `new_budget` | strong | high | 270 | `executive_leadership`, `strategy_and_corporate_development`, `procurement` | `budget_created` | Covers seed through later-stage private funding. |
| `grant_award` | company | `new_budget` | medium | high | 240 | `research_and_development`, `clinical_operations`, `procurement` | `budget_created` | Useful for non-dilutive life sciences funding. |
| `ipo_or_follow_on` | company | `new_budget` | strong | high | 365 | `executive_leadership`, `strategy_and_corporate_development` | `budget_created` | More relevant for public companies than early-stage private biotech. |
| `milestone_payment` | company | `new_budget` | strong | medium | 180 | `executive_leadership`, `business_development`, `procurement` | `budget_created` | Usually comes from partnership milestones. |
| `partnership_with_upfront_economics` | company | `new_budget`, `new_strategy` | strong | medium | 240 | `business_development`, `partnerships`, `strategy_and_corporate_development` | `budget_created`, `strategy_shift` | Upfront dollars plus changed operating scope. |
| `ma_event` | company | `new_budget`, `new_strategy`, `caution` | medium | medium | 300 | `executive_leadership`, `strategy_and_corporate_development` | `budget_created`, `strategy_shift`, `suppression` | Treat as ambiguous without follow-up context. |
| `demo_requested` | company | `new_budget`, `new_needs` | strong | high | 45 | `procurement`, `technology_and_systems`, `commercial` | `commercial_interest`, `budget_created` | First-party. Highest explicit intent. |
| `inbound_enquiry` | company | `new_budget`, `new_needs` | strong | high | 45 | `commercial`, `business_development` | `commercial_interest`, `budget_created` | First-party. |
| `open_opportunity_in_crm` | company | `new_budget` | strong | high | 60 | `commercial`, `sales_operations` | `commercial_interest`, `budget_created` | First-party CRM state, not public signal. |

### 5.2 Needs signals

| signal_key | scope | dimensions | default_strength | default_confidence | decay_days | buyer_functions | intent_mechanisms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `clinical_trial_registered` | company | `new_needs` | medium | high | 180 | `clinical_operations`, `regulatory_affairs` | `program_advance`, `complexity_increased` | Stronger when paired with hiring or site expansion. |
| `phase_transition` | company | `new_needs`, `new_strategy` | strong | high | 210 | `clinical_operations`, `regulatory_affairs`, `manufacturing_and_cmc` | `program_advance`, `complexity_increased` | One of the highest-value biotech signals. |
| `trial_site_expansion` | company | `new_needs` | strong | medium | 150 | `clinical_operations`, `data_and_informatics` | `complexity_increased` | Operationally meaningful. |
| `indication_expansion` | company | `new_needs`, `new_strategy` | medium | high | 210 | `clinical_operations`, `regulatory_affairs`, `commercial` | `program_advance`, `strategy_shift` | Dual-maps by design. |
| `breakthrough_designation` | company | `new_needs` | medium | high | 180 | `regulatory_affairs`, `clinical_operations` | `program_advance` | Strong contextual support. |
| `fda_approval` | company | `new_needs`, `new_strategy` | strong | high | 300 | `commercial`, `regulatory_affairs`, `quality_and_compliance` | `program_advance`, `strategy_shift` | Can imply commercialization readiness. |
| `new_facility` | company | `new_needs` | strong | medium | 240 | `manufacturing_and_cmc`, `quality_and_compliance`, `lab_operations` | `complexity_increased` | Very strong for CDMO/CMC-adjacent selling motions. |
| `facility_expansion` | company | `new_needs` | strong | medium | 240 | `manufacturing_and_cmc`, `quality_and_compliance` | `complexity_increased` | Similar to `new_facility` but expansion-specific. |
| `cmc_scale_up` | company | `new_needs` | strong | medium | 180 | `manufacturing_and_cmc`, `quality_and_compliance`, `procurement` | `complexity_increased` | Can be inferred from multiple manufacturing events. |
| `cdmo_partnership` | company | `new_needs`, `new_strategy` | medium | medium | 180 | `manufacturing_and_cmc`, `business_development` | `complexity_increased`, `strategy_shift` | Depends on context and transaction size. |
| `quality_compliance_buildout` | company | `new_needs` | medium | medium | 150 | `quality_and_compliance`, `regulatory_affairs` | `complexity_increased` | Often inferred from role mix rather than a single event. |
| `visited_your_website` | company | `new_needs` | medium | high | 21 | `marketing`, `commercial` | `commercial_interest` | First-party; weaker than demo/inbound. |
| `attended_your_webinar_or_event` | company | `new_needs` | medium | high | 30 | `marketing`, `commercial` | `commercial_interest` | First-party; contextual unless repeated. |
| `downloaded_your_content` | company | `new_needs` | medium | high | 21 | `marketing`, `commercial` | `commercial_interest` | First-party. |
| `responded_to_previous_outreach` | contact | `new_needs` | strong | high | 30 | `commercial`, `business_development` | `commercial_interest` | Contact-level, but meaningful enough to boost account readiness. |

### 5.3 People signals

| signal_key | scope | dimensions | default_strength | default_confidence | decay_days | buyer_functions | intent_mechanisms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cmc_hiring` | company | `new_people`, `new_needs` | strong | medium | 120 | `manufacturing_and_cmc`, `quality_and_compliance` | `team_buildout`, `complexity_increased` | High-value life-sciences-specific signal. |
| `clinical_ops_hiring` | company | `new_people`, `new_needs` | strong | medium | 120 | `clinical_operations`, `data_and_informatics` | `team_buildout`, `complexity_increased` | Strong when tied to program growth. |
| `regulatory_hiring` | company | `new_people`, `new_needs` | medium | medium | 120 | `regulatory_affairs`, `quality_and_compliance` | `team_buildout`, `complexity_increased` | Often paired with milestone progression. |
| `bd_hiring` | company | `new_people`, `new_strategy` | medium | medium | 120 | `business_development`, `partnerships` | `team_buildout`, `strategy_shift` | Stronger for partnering/commercialization motions. |
| `commercial_hiring` | company | `new_people`, `new_strategy` | medium | medium | 120 | `commercial`, `marketing` | `team_buildout`, `strategy_shift` | Often a commercialization readiness clue. |
| `job_surge` | company | `new_people`, `new_needs` | medium | medium | 90 | `manufacturing_and_cmc`, `clinical_operations`, `regulatory_affairs`, `business_development`, `commercial` | `team_buildout`, `complexity_increased` | Should be computed from classified role mix, not ingested directly if possible. |
| `new_to_role` | contact | `new_people` | medium | medium | 90 |  | `leadership_change` | Buyer function should be derived from the contact's classified function. Strongest for senior roles. |
| `recently_promoted` | contact | `new_people` | medium | medium | 90 |  | `leadership_change` | Buyer function should be derived from the contact's classified function. Implies expanded remit. |
| `recently_changed_company` | contact | `new_people` | medium | medium | 120 |  | `leadership_change` | Buyer function should be derived from the contact's classified function. Strong if role is relevant and senior. |
| `new_internal_role` | contact | `new_people` | medium | medium | 90 |  | `leadership_change` | Buyer function should be derived from the contact's classified function. Useful when responsibilities changed without company move. |
| `title_change` | contact | `new_people` | weak | medium | 60 |  | `leadership_change` | Buyer function should be derived from the contact's classified function. Weak unless role seniority increased. |
| `board_or_advisory_role` | contact | `new_people`, `new_strategy` | weak | medium | 180 | `executive_leadership`, `strategy_and_corporate_development` | `leadership_change`, `strategy_shift` | Usually contextual rather than decisive. |

### 5.4 Strategy signals

| signal_key | scope | dimensions | default_strength | default_confidence | decay_days | buyer_functions | intent_mechanisms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `partnership_deal` | company | `new_strategy` | medium | medium | 180 | `business_development`, `partnerships` | `strategy_shift` | Use when economics are unknown. |
| `licensing_deal` | company | `new_strategy`, `new_budget` | strong | medium | 240 | `business_development`, `partnerships`, `strategy_and_corporate_development` | `strategy_shift`, `budget_created` | Map to budget if there is disclosed economics. |
| `co_development_deal` | company | `new_strategy`, `new_needs` | medium | medium | 180 | `business_development`, `clinical_operations` | `strategy_shift`, `complexity_increased` | Often operationally meaningful. |
| `regional_expansion` | company | `new_strategy` | medium | medium | 180 | `commercial`, `regulatory_affairs` | `strategy_shift` | Includes geographic expansion. |
| `commercialization_move` | company | `new_strategy`, `new_needs` | strong | medium | 210 | `commercial`, `quality_and_compliance`, `regulatory_affairs` | `strategy_shift`, `complexity_increased` | Important late-stage / approved product signal. |
| `platform_repositioning` | company | `new_strategy` | medium | low | 150 | `executive_leadership`, `strategy_and_corporate_development` | `strategy_shift` | Usually inferred from language changes or repeated events. |
| `conference_presentation` | company | `new_strategy` | weak | medium | 30 | `medical_affairs`, `research_and_development` | `strategy_shift` | Mostly contextual support. |
| `conference_speaker` | contact | `new_strategy`, `new_people` | weak | medium | 30 |  | `strategy_shift`, `leadership_change` | Buyer function should be derived from the contact's classified function. Good supporting context, weak alone. |
| `publication` | company | `new_strategy` | weak | high | 45 | `research_and_development`, `medical_affairs` | `strategy_shift` | Mostly narrative/context. |
| `new_paper_published` | contact | `new_strategy` | weak | high | 45 |  | `strategy_shift` | Buyer function should be derived from the contact's classified function. Contact credibility/context. |
| `patent_filed_or_granted` | company | `new_strategy` | weak | high | 120 | `research_and_development`, `strategy_and_corporate_development` | `strategy_shift` | Not enough alone to indicate buying timing. |

### 5.5 Caution signals

| signal_key | scope | dimensions | default_strength | default_confidence | decay_days | buyer_functions | intent_mechanisms | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `layoffs` | company | `caution` | strong | medium | 180 | `executive_leadership`, `procurement` | `suppression` | Strong suppressor. |
| `trial_failure_or_halt` | company | `caution` | strong | high | 240 | `clinical_operations`, `executive_leadership` | `suppression` | Particularly important in biotech. |
| `program_discontinuation` | company | `caution` | strong | high | 240 | `research_and_development`, `clinical_operations` | `suppression` | Suppresses relevance for associated programs. |
| `restructuring` | company | `caution` | strong | medium | 180 | `executive_leadership`, `procurement` | `suppression` | Can coexist with strategy signals; caution should still apply. |
| `distressed_financing` | company | `caution` | strong | medium | 210 | `executive_leadership`, `strategy_and_corporate_development` | `suppression` | Different from healthy budget creation. |
| `acquisition_distraction` | company | `caution` | medium | medium | 150 | `executive_leadership`, `strategy_and_corporate_development` | `suppression` | Used when integration timing likely slows buying. |
| `leadership_churn` | company | `caution`, `new_people` | medium | medium | 120 | `executive_leadership`, `business_development`, `clinical_operations`, `manufacturing_and_cmc` | `suppression`, `leadership_change` | Can create change, but often noisy. |
| `lapsed_customer` | company | `caution` | medium | high | 365 | `commercial` | `suppression` | First-party relationship warning. |

---

## 6. Signal normalization rules

These rules prevent source-specific mess from leaking into product logic.

### 6.1 Raw event requirements

Every ingested source event should preserve:

```ts
type RawSignalEvent = {
  id: string;
  user_id: string;
  entity_id: string;
  entity_scope: SignalScope;
  source: string;
  source_url: string | null;
  source_event_type: string;
  source_event_id: string | null;
  title: string | null;
  summary: string | null;
  excerpt: string | null;
  event_at: string | null;
  observed_at: string;
  metadata: Record<string, unknown>;
};
```

### 6.2 Normalization requirements

Every raw event should normalize into 1 or more canonical signal records:

```ts
type NormalizedSignal = {
  id: string;
  raw_signal_event_id: string;
  signal_key: string;
  scope: SignalScope;
  entity_id: string;
  dimensions: ReadinessDimension[];
  buyer_functions: BuyerFunction[];
  intent_mechanisms: IntentMechanism[];
  default_strength: SignalStrength;
  default_confidence: ConfidenceLabel;
  event_at: string | null;
  observed_at: string;
  evidence_excerpt: string | null;
};
```

### 6.3 Multi-map allowed

One normalized signal may contribute to multiple dimensions.

Examples:

- `phase_transition` -> `new_needs`, `new_strategy`
- `cmc_hiring` -> `new_people`, `new_needs`
- `licensing_deal` -> `new_strategy`, `new_budget`

This is required behavior, not an edge case.

### 6.4 Dedupe rules

Deduplicate at 2 levels:

1. raw event dedupe:
- source-native event id when available
- otherwise `(source, source_url, entity_id)`

2. normalized signal dedupe:
- `(entity_id, signal_key, source, event_at, evidence hash)`

Do not dedupe away separate meaningful events just because they share a company and signal family.

---

## 7. Scoring model

Readiness should be explainable. Avoid opaque black-box scoring.

### 7.1 Numeric score convention

All readiness dimension scores should be normalized to `0.0 - 1.0`.

Recommended label mapping:

- `0.00 - 0.34` -> `low`
- `0.35 - 0.69` -> `medium`
- `0.70 - 1.00` -> `high`

### 7.2 Signal contribution model

Each normalized signal contributes to a readiness dimension via:

```text
signal contribution =
  base strength weight
  x confidence multiplier
  x recency multiplier
  x relevance multiplier
```

Recommended default strength weights:

- `weak` = `0.25`
- `medium` = `0.55`
- `strong` = `0.85`

Recommended confidence multipliers:

- `low` = `0.65`
- `medium` = `0.82`
- `high` = `1.00`

### 7.3 Recency decay

Use time decay rather than hard expiration.

Initial implementation can use a simple linear decay:

```text
recency multiplier = max(0, 1 - days_since_event / decay_days)
```

If `event_at` is unavailable, fall back to `observed_at`.

### 7.4 Relevance multiplier

This should depend on the product motion or vendor category being sold.

Initial implementation recommendation:

- `1.00` if signal directly affects target buyer functions
- `0.80` if adjacent
- `0.60` if mostly contextual

### 7.5 Compound support

When multiple signals support the same dimension within a recent time window, add a compound boost.

Initial rule:

- if 2 or more distinct signals support the same dimension inside 90 days, add `+0.10`
- cap per-dimension score at `1.00`

### 7.6 Cross-dimension boost

When multiple readiness dimensions are active together, boost overall readiness.

Initial rule:

- 1 high dimension -> overall cannot exceed `medium` without direct first-party commercial intent
- 2 high dimensions -> overall can be `high`
- 3 high dimensions -> overall should almost always be `high` unless caution is also high

### 7.7 Caution suppression

Caution should reduce urgency, not necessarily erase all positive signals.

Initial rule:

- if `caution_score >= 0.70`, cap `overall_readiness` at `medium`
- if `caution_score >= 0.85`, reduce `overall_readiness_score` by `0.20`
- if caution is the only active dimension, overall readiness should be `low`

---

## 8. Reason generation spec

`reason` is computed. It should not be manually edited.

### 8.1 Required outputs

```ts
type AccountReason = {
  summary_short: string;
  summary_long: string;
  why_now: string;
  affected_functions: BuyerFunction[];
  suggested_angle: string;
  confidence_label: ConfidenceLabel;
};
```

### 8.2 Generation rules

`reason` should be generated from:

- top 1-3 active readiness dimensions
- top supporting evidence within each dimension
- affected buyer functions
- confidence level
- caution state if present

### 8.3 Writing constraints

Reason text should:

- describe the change, not just the score
- explain likely commercial meaning
- avoid overclaiming certainty
- mention caution when relevant
- be short enough for list and drawer surfaces

### 8.4 Example templates

High `new_budget` + `new_needs`:

```text
This account appears timely because it recently secured funding and is showing signs of increased operational complexity, suggesting both budget availability and a near-term need for external support.
```

High `new_people` + `new_strategy`:

```text
This account appears to be in transition, with new leadership and strategic moves that may trigger workflow re-evaluation or new vendor consideration.
```

High caution:

```text
This account shows meaningful change activity, but caution signals suggest timing may be less reliable than the positive signals alone imply.
```

---

## 9. Agent context contract

Agents must receive structured signal context, not just prose.

### 9.1 Required payload

```ts
type AccountReadinessContext = {
  account_id: string;
  company_name: string;
  fit: {
    score: number;
    label: ReadinessLabel;
  };
  readiness: {
    overall_score: number;
    overall_label: ReadinessLabel;
    new_budget: DimensionState;
    new_needs: DimensionState;
    new_people: DimensionState;
    new_strategy: DimensionState;
    caution: DimensionState;
  };
  reason: AccountReason;
  route: {
    recommended_contacts: Array<{
      contact_id: string;
      full_name: string;
      title: string | null;
      buyer_functions: BuyerFunction[];
      rationale: string | null;
    }>;
  };
  top_signals: SignalEvidence[];
};

type DimensionState = {
  score: number;
  label: ReadinessLabel;
  confidence_label: ConfidenceLabel;
  evidence_ids: string[];
};

type SignalEvidence = {
  id: string;
  signal_key: string;
  scope: SignalScope;
  source: string;
  event_at: string | null;
  source_url: string | null;
  excerpt: string | null;
  confidence_label: ConfidenceLabel;
};
```

### 9.2 Agent prompt rule

Prompt templates should consume:

- readiness dimensions
- reason
- top evidence
- route context

Agents should not rely on prose alone when deciding outreach angle or timing.

---

## 10. Recommended implementation phases

### Phase 1: canonical model and storage

Build:

- canonical signal enums
- raw event table
- normalized signal table
- readiness score computation job
- reason generation function

### Phase 2: first sources

Start with:

- HubSpot first-party signals
- ClinicalTrials.gov
- FDA/public regulatory feeds
- company careers pages / job boards
- structured funding / grants / partnership sources

### Phase 3: role and function intelligence

Build:

- hiring role classifier
- buyer function mapper
- job seniority normalizer
- contact movement detection

### Phase 4: compound readiness engine

Build:

- cross-signal corroboration
- cross-dimension boosts
- caution suppression
- reason quality improvements

### Phase 5: contextual enrichment

Add:

- PubMed
- conference programs
- patents
- newsroom/news scraping

These should support narrative quality and corroboration, not dominate readiness.

---

## 11. What “done” looks like

Arcova is “there” when:

- a high-fit account can be identified as timely based on structured evidence
- readiness is explained as `new_budget`, `new_needs`, `new_people`, `new_strategy`, and `caution`
- reason is generated automatically from current state
- agents receive a stable payload they can use for prioritization and outreach
- the product can show not just "who fits" but "why now"

---

## 12. Open implementation decisions

These still need explicit calls:

- whether readiness scores live on `companies` directly or in a separate computed snapshot table
- whether normalized signals are appended immutably or upserted into latest-state records
- whether reason is generated synchronously on score update or asynchronously in a follow-up job
- whether buyer-function relevance should be global or user/persona-specific
- whether first-party signals should be weighted differently from public signals by default
