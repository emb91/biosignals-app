# Arcova Readiness Service Contract
## Scoring, reason generation, and job flow

---

## 1. Scope

This document defines the service boundaries for:

- signal ingestion
- signal normalization
- readiness scoring
- reason generation
- agent context assembly

This is an implementation planning contract. It does not change current runtime behavior.

---

## 2. Service boundaries

### 2.1 Ingestion service

Responsibility:

- accept raw source event inputs
- validate entity linkage
- write immutable source evidence rows
- enqueue normalization

Input:

```ts
type IngestSignalSourceEventInput = {
  userId: string;
  entityScope: 'company' | 'contact';
  companyId?: string | null;
  contactId?: string | null;
  source: string;
  sourceEventType: string;
  sourceEventId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  summary?: string | null;
  excerpt?: string | null;
  eventAt?: string | null;
  metadata?: Record<string, unknown>;
};
```

Output:

```ts
type IngestSignalSourceEventResult = {
  sourceEventId: string;
  normalizationQueued: boolean;
};
```

### 2.2 Normalization service

Responsibility:

- map raw source events into canonical signal keys
- assign dimensions, intent mechanisms, default strength/confidence
- persist normalized signals
- enqueue account recompute

Input:

```ts
type NormalizeSignalSourceEventInput = {
  sourceEventId: string;
};
```

Output:

```ts
type NormalizeSignalSourceEventResult = {
  sourceEventId: string;
  normalizedSignalIds: string[];
  affectedCompanyIds: string[];
};
```

### 2.3 Readiness scoring service

Responsibility:

- load normalized signals for an account
- compute per-dimension readiness state
- compute overall readiness
- write snapshot rows
- enqueue reason generation

Input:

```ts
type RecomputeAccountReadinessInput = {
  userId: string;
  companyId: string;
  trigger: 'source_event_ingested' | 'manual_recompute' | 'nightly_refresh' | 'fit_changed';
};
```

Output:

```ts
type RecomputeAccountReadinessResult = {
  companyId: string;
  readinessSnapshotId: string;
  overallScore: number;
  overallLabel: 'low' | 'medium' | 'high';
};
```

### 2.4 Reason generation service

Responsibility:

- read latest readiness snapshot plus supporting evidence
- generate deterministic structured explanation
- persist latest reason snapshot

Input:

```ts
type GenerateAccountReasonInput = {
  userId: string;
  companyId: string;
  readinessSnapshotId: string;
};
```

Output:

```ts
type GenerateAccountReasonResult = {
  companyId: string;
  reasonSnapshotId: string;
};
```

### 2.5 Agent context assembler

Responsibility:

- compose fit, readiness, reason, route, and top evidence into one payload
- provide stable context for prompts and UI

Input:

```ts
type BuildAccountReadinessContextInput = {
  userId: string;
  companyId: string;
  limitTopSignals?: number;
};
```

Output:

- `AccountReadinessContext` from [readiness-types.ts](/Users/emma/biosignals-gtm-2026/biosignals-app/lib/signals/readiness-types.ts)

---

## 3. Job flow

Recommended asynchronous flow:

```text
source event arrives
-> ingest source event
-> normalize source event
-> identify affected account(s)
-> recompute account readiness
-> generate reason
-> refresh agent-facing/account-facing context
```

### 3.1 Trigger sources

Initial triggers:

- HubSpot webhook or pull sync event
- public data ingestion job
- scraped hiring/facility/news event
- manual admin replay/recompute

### 3.2 Recompute granularity

Recommended:

- recompute at the account/company level
- do not recompute every contact eagerly
- contact-level route logic can read the account readiness snapshot plus contact-specific route data

Why:

- readiness is primarily an account timing concept
- this keeps compute cheaper and payloads cleaner

---

## 4. Scoring contract

### 4.1 Input contract

The scoring service should accept only normalized signals, not raw source events.

Required scoring inputs per signal:

- `signalKey`
- `dimensions`
- `defaultStrength`
- `defaultConfidence`
- `eventAt`
- `buyerFunctions`

Optional contextual inputs:

- current company fit score
- target buyer functions from active persona/ICP
- source trust overrides

### 4.2 Output contract

```ts
type DimensionScoreResult = {
  dimension: 'new_budget' | 'new_needs' | 'new_people' | 'new_strategy' | 'caution';
  score: number;
  label: 'low' | 'medium' | 'high';
  confidenceLabel: 'low' | 'medium' | 'high';
  evidenceIds: string[];
};

type AccountReadinessScoreResult = {
  overallScore: number;
  overallLabel: 'low' | 'medium' | 'high';
  dimensions: DimensionScoreResult[];
  topSignalIds: string[];
  freshnessScore: number | null;
};
```

### 4.3 Determinism rule

The readiness scoring service should be deterministic for the same inputs.

Do not use an LLM to compute numeric readiness scores.

Use:

- catalog metadata
- recency decay
- contribution rules
- compound rules
- caution suppression

LLMs can help later with:

- richer explanations
- evidence summarization
- angle phrasing

But not with the core score.

---

## 5. Reason generation contract

### 5.1 Inputs

The reason generator should read:

- latest readiness snapshot
- top evidence rows
- company metadata
- route context if available

### 5.2 Behavior

The initial version should be template-based, not freeform LLM-only text generation.

Recommended first implementation:

- deterministic templates
- conditional phrasing based on top dimensions
- evidence-backed summaries

Example:

- if `new_budget` and `new_needs` are high:
  - mention funding/capital plus operational complexity
- if `new_people` is high:
  - mention new owner/team buildout
- if `caution` is high:
  - add a qualifying sentence

### 5.3 Why template-first

- easier to debug
- harder to hallucinate
- consistent for agents
- safer for ranking-linked explanations

---

## 6. Suggested module layout

Recommended new modules under `lib/signals`:

- `readiness-types.ts`
- `readiness-catalog.ts`
- `readiness-normalize.ts`
- `readiness-score.ts`
- `readiness-reason.ts`
- `readiness-context.ts`

Recommended rule:

- keep new readiness modules separate from existing `intent-scoring.ts` until migration is deliberate

---

## 7. Suggested function signatures

```ts
export async function ingestSignalSourceEvent(
  input: IngestSignalSourceEventInput
): Promise<IngestSignalSourceEventResult>;

export async function normalizeSignalSourceEvent(
  input: NormalizeSignalSourceEventInput
): Promise<NormalizeSignalSourceEventResult>;

export async function recomputeAccountReadiness(
  input: RecomputeAccountReadinessInput
): Promise<RecomputeAccountReadinessResult>;

export async function generateAccountReason(
  input: GenerateAccountReasonInput
): Promise<GenerateAccountReasonResult>;

export async function buildAccountReadinessContext(
  input: BuildAccountReadinessContextInput
): Promise<AccountReadinessContext>;
```

---

## 8. Failure handling

### Ingestion failure

- do not lose source event payload
- log failure
- mark event for retry if write succeeded but downstream enqueue failed

### Normalization failure

- preserve raw source event
- record failure status separately if needed
- allow replay by `sourceEventId`

### Scoring failure

- preserve prior readiness snapshot if one exists
- do not blank the account state
- log and retry asynchronously

### Reason generation failure

- preserve latest readiness snapshot
- fall back to previous reason snapshot if available
- allow UI/agents to continue with numeric readiness only

---

## 9. Migration strategy

Recommended sequence:

1. ship types and contracts
2. ship new tables
3. build new ingestion path for one or two source families
4. build recompute + reason generation jobs
5. expose a read-only readiness context to internal tools or staging UI
6. migrate product surfaces from legacy intent-only scoring to readiness

---

## 10. Guardrails

- do not replace the current `signals` table in-place as the first move
- do not mix LLM-generated prose into the source-of-truth scoring path
- do not recompute readiness synchronously in user-facing request paths unless strictly necessary
- do not let weak contextual signals outweigh strong structured signals
- do not ship agent prompts that consume only prose and not underlying evidence

