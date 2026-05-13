# Arcova CRM Change Detection Spec
## HubSpot -> signal events -> readiness

---

## 1. Purpose

This document defines how Arcova should detect meaningful CRM changes, convert them into canonical signal events, and feed them into the readiness system.

This is the missing bridge between:

- synced CRM state
- normalized signal events
- readiness dimensions
- reason generation

The key principle is:

**readiness should not read raw HubSpot state directly.**

Instead:

1. sync CRM state
2. detect meaningful changes
3. emit signal events
4. normalize into readiness signals
5. recompute readiness
6. regenerate reason

---

## 2. Why this matters

The current HubSpot sync is sufficient for:

- importing new contacts
- enriching contacts
- pushing Arcova fields back to HubSpot

It is not sufficient for signals/readiness, because readiness depends on:

- what changed
- when it changed
- whether the change is commercially meaningful
- whether the change should increase or suppress outreach timing

So Arcova needs to evolve from:

- **new record ingestion**

to:

- **meaningful change detection**

---

## 3. Scope

Initial CRM objects to support:

1. `deals`
2. `contacts`
3. `companies`
4. contact-company associations
5. contact-deal associations

Priority order:

1. `deals`
2. `contacts`
3. `companies`

Why:

- deals are the strongest direct buying-process signals
- contacts are critical for `new_people` and route
- companies carry relationship-state and account-level CRM context

---

## 4. Architectural model

### 4.1 Layers

```text
HubSpot object sync
-> local CRM mirror tables
-> diff / change detection
-> emitted source events
-> normalized readiness signals
-> account readiness recompute
-> reason regeneration
```

### 4.2 Separation of concerns

#### CRM sync layer
Responsibility:
- keep local copies of relevant HubSpot objects current
- upsert latest object state and association state

#### Change detection layer
Responsibility:
- compare previous local state to new local state
- emit only meaningful commercial deltas

#### Signal emission layer
Responsibility:
- write source event rows into `signal_source_events`
- map to canonical signal keys

#### Readiness layer
Responsibility:
- consume canonical signal events
- recompute readiness dimensions and reason

---

## 5. Local state required

Arcova should persist a local mirror for the CRM objects it wants to diff.

Recommended tables or equivalent persisted models:

- `crm_contacts`
- `crm_companies`
- `crm_deals`
- `crm_contact_company_links`
- `crm_deal_contact_links`
- `crm_sync_checkpoints`

Required fields across mirrored objects:

- `user_id`
- `hubspot_object_id`
- `updated_at_remote`
- `synced_at`
- `raw_payload`
- normalized extracted fields used for diffing

Important:

- keep the raw payload for debugging
- also store extracted normalized columns for diffing and queryability

---

## 6. Change detection rules

Not every CRM change should emit a signal.

A change should emit a signal only when it is:

- commercially meaningful
- interpretable in the readiness model
- durable enough to matter beyond noisy field churn

Do not emit signals for:

- typo fixes
- whitespace/text cleanup
- cosmetic note edits
- irrelevant property churn
- repeated syncs with no meaningful delta

---

## 7. Deal change detection

This is the highest-priority CRM signal family.

### 7.1 Deal fields to mirror

Required:

- `dealname`
- `dealstage`
- `pipeline`
- `amount`
- `closedate`
- `createdate`
- `hs_lastmodifieddate`
- `hubspot_owner_id`
- `dealtype` if used
- `closed_lost_reason` or equivalent custom field if available
- `budget_confirmed` custom field if available
- `timeline` custom field if available

### 7.2 Deal associations to mirror

Required:

- associated company ids
- associated contact ids

### 7.3 Meaningful deal changes and emitted signals

| Change detected | Emit signal | Scope | Readiness impact |
|---|---|---|---|
| deal created | `open_opportunity_in_crm` | company | `new_budget` strong |
| deal reopened | `open_opportunity_in_crm` | company | `new_budget` medium, `new_needs` medium |
| stage moved into active evaluation / proposal / negotiation | `open_opportunity_in_crm` | company | `new_budget` medium |
| amount added where previously empty | `open_opportunity_in_crm` | company | `new_budget` strong |
| budget-confirmed field changed false -> true | `open_opportunity_in_crm` | company | `new_budget` strong |
| close date materially pulled in | `inbound_enquiry` or future dedicated CRM-stage signal | company | `new_needs` medium |
| close date pushed out repeatedly | `lapsed_customer` is not correct; use future caution CRM signal | company | `caution` medium |
| deal closed lost for no priority / no budget | future CRM caution signal | company | `caution` strong |
| new stakeholder associated to active deal | future `new_people` CRM signal | company/contact | `new_people` medium |

Important note:

The current canonical catalog is still thin for CRM stage semantics. For the first slice, Arcova can reuse:

- `open_opportunity_in_crm`
- `inbound_enquiry`
- `lapsed_customer`

But longer term, the catalog should likely add dedicated CRM/deal signals such as:

- `opportunity_reopened`
- `budget_confirmed_in_crm`
- `deal_stage_advanced`
- `deal_pushed_out`
- `closed_lost_no_priority`
- `stakeholder_added_to_active_deal`

---

## 8. Contact change detection

### 8.1 Contact fields to mirror

Required:

- `firstname`
- `lastname`
- `email`
- `jobtitle`
- `hs_lead_status`
- `lifecyclestage`
- `hubspot_owner_id`
- `hs_lastmodifieddate`
- `company`
- `website`
- `seniority` custom field if available
- `function` custom field if available
- meeting/reply markers if available

### 8.2 Meaningful contact changes and emitted signals

| Change detected | Emit signal | Scope | Readiness impact |
|---|---|---|---|
| new contact created in target function | future contact-created CRM signal | contact | `new_people` medium |
| title changed to more senior role | `new_to_role` or `recently_promoted` depending on evidence | contact | `new_people` medium |
| function changed into relevant buyer function | `new_internal_role` | contact | `new_people` medium |
| owner changed onto active account | future CRM route/context signal | contact | route support |
| lifecycle stage advanced into MQL/SQL/opportunity context | future CRM engagement/deal signal | contact | `new_needs` medium |
| contact replied / meeting booked captured in CRM | `responded_to_previous_outreach` | contact | `new_needs` strong |
| new stakeholder added to account with active deal | future CRM stakeholder signal | contact | `new_people` medium |

Important:

Contact changes affect both:

- readiness (`new_people`)
- route quality

So the same event should often update both account readiness context and route recommendations.

---

## 9. Company change detection

### 9.1 Company fields to mirror

Required:

- `name`
- `domain`
- `lifecyclestage`
- `hubspot_owner_id`
- `hs_lastmodifieddate`
- customer status fields if available
- renewal fields if available
- churn risk / relationship state fields if available

### 9.2 Meaningful company changes and emitted signals

| Change detected | Emit signal | Scope | Readiness impact |
|---|---|---|---|
| company moved into customer state | no readiness signal by default; relationship context update | company | relationship state |
| company moved from customer -> former customer | `lapsed_customer` | company | `caution` or re-engagement context |
| renewal approaching | future CRM renewal signal | company | timing / budget |
| owner reassigned on strategic account | future CRM route signal | company | route support |
| lifecycle moved into opportunity/customer evaluation context | `open_opportunity_in_crm` if account-level CRM semantics support it | company | `new_budget` medium |

Important:

Company CRM changes are often more about:

- relationship state
- timing qualification
- route support

than about pure external intent.

---

## 10. Associations as signals

Associations matter because CRM buying motion often becomes visible through:

- more contacts attached to the same company
- more contacts attached to an active deal
- stronger multi-threading

Recommended association-derived events:

| Change detected | Emit signal | Scope | Readiness impact |
|---|---|---|---|
| first relevant contact added to company | future CRM stakeholder signal | company/contact | `new_people` low-medium |
| second or third stakeholder added to active deal | future CRM stakeholder signal | company/contact | `new_people` medium |
| buying committee expands quickly | future CRM stakeholder signal | company | `new_people` strong |
| buying committee shrinks / champion removed | future caution CRM signal | company | `caution` medium |

---

## 11. Canonical mapping strategy

### 11.1 Phase 1: use existing signal keys where possible

Use the current catalog for the first narrow slice:

- `open_opportunity_in_crm`
- `inbound_enquiry`
- `responded_to_previous_outreach`
- `lapsed_customer`
- `new_to_role`
- `recently_promoted`
- `new_internal_role`

This allows CRM readiness to start without redesigning the whole catalog first.

### 11.2 Phase 2: add CRM-native canonical signal keys

Recommended additions:

- `opportunity_reopened`
- `deal_stage_advanced`
- `budget_confirmed_in_crm`
- `deal_pushed_out`
- `closed_lost_no_priority`
- `closed_lost_no_budget`
- `stakeholder_added_to_active_deal`
- `meeting_booked`
- `renewal_upcoming`
- `champion_left_active_account`

These will make CRM readiness much more expressive.

---

## 12. Diff strategy

Recommended approach:

### 12.1 Snapshot diffing

For each synced object:

1. load previous local mirror row
2. fetch latest HubSpot row
3. compute field-level diffs on tracked properties only
4. ignore non-tracked properties
5. emit one or more source events when a meaningful rule matches

### 12.2 Event identity / dedupe

Each emitted CRM change event should include:

- `source = hubspot`
- `source_event_type`
- `source_event_id`
- `event_at`
- metadata with changed field names and previous/new values

Recommended event identity:

`hubspot:<object_type>:<object_id>:<change_class>:<remote_updated_at>`

This keeps change events idempotent across reruns.

---

## 13. Proposed event metadata shape

```ts
{
  crm_provider: 'hubspot',
  object_type: 'deal' | 'contact' | 'company',
  object_id: string,
  changed_fields: string[],
  previous_values: Record<string, unknown>,
  next_values: Record<string, unknown>,
  associated_company_ids?: string[],
  associated_contact_ids?: string[],
  diff_rule: string,
  remote_updated_at?: string,
}
```

This metadata should be stored on the source event row for debugging and explanation.

---

## 14. Job flow

Recommended CRM sync flow:

```text
scheduled sync or webhook trigger
-> fetch changed HubSpot objects since checkpoint
-> upsert CRM mirror tables
-> diff against prior mirror state
-> emit signal source events
-> normalize signal events
-> recompute affected accounts
-> regenerate reason
```

Trigger options:

1. polling sync first
2. webhooks later

Recommendation:

- start with polling because it is simpler and fits current architecture
- add HubSpot webhooks later for lower-latency change detection

---

## 15. Readiness dimension mapping

### `new_budget`
Primary CRM contributors:

- opportunity created
- opportunity reopened
- budget confirmed
- amount added
- renewal motion

### `new_needs`
Primary CRM contributors:

- inbound enquiry
- reply/meeting activity
- deal moved into active evaluation
- deal urgency pulled forward

### `new_people`
Primary CRM contributors:

- new stakeholder added
- contact promoted into buyer role
- function/title changed into target area
- multi-threading increased

### `new_strategy`
Secondary CRM contributors:

- new strategic initiative noted in deal context
- new product/business unit interest
- account repositioned into new use-case lane

### `caution`
Primary CRM contributors:

- closed lost no budget
- closed lost no priority
- repeated pushout
- champion removed
- relationship downgraded

---

## 16. UI and agent impact

CRM-derived signals should not bypass the normal readiness presentation.

The product should still show:

- one overall readiness verdict
- top drivers
- reason
- evidence

But evidence should clearly label CRM provenance.

Example user-visible evidence items:

- Open opportunity created in CRM
- Contact replied to outreach
- New stakeholder attached to active deal
- Opportunity pushed out twice

Agent payload should include CRM evidence the same way it includes public evidence.

---

## 17. Recommended implementation order

### Phase 1

Build:

- local mirror of HubSpot deals
- local mirror of deal associations
- diff rules for:
  - deal created
  - deal reopened
  - amount added
  - stage advanced
- emit `open_opportunity_in_crm`

### Phase 2

Build:

- contact mirror diffing
- title/function/seniority change detection
- reply/meeting event mapping where available
- emit `new_to_role`, `recently_promoted`, `new_internal_role`, `responded_to_previous_outreach`

### Phase 3

Build:

- company relationship-state diffing
- lapsed customer / renewal / downgrade context
- caution CRM signals

### Phase 4

Build:

- richer CRM-native canonical signals
- stakeholder/multi-threading signals
- webhook-driven lower-latency updates

---

## 18. What “done” looks like

Arcova is “there” on CRM readiness when:

- meaningful HubSpot changes on already-known records are detected automatically
- those changes emit canonical signal events
- readiness updates without manual intervention
- reason includes CRM evidence alongside public signals
- accounts can become more or less timely based on actual buying-process movement in CRM

