# Arcova Readiness DB Schema
## Proposed schema changes for readiness, evidence, and reason

---

## 1. Scope

This document proposes the database shape for the readiness system defined in [arcova-readiness-signals-spec.md](/Users/emma/biosignals-gtm-2026/biosignals-app/docs/arcova-readiness-signals-spec.md).

This is a planning artifact only. It does not change the current app runtime.

Goals:

- preserve raw source evidence
- normalize source events into canonical signals
- compute readiness independently from ingestion
- provide a stable snapshot payload for agents and product surfaces

---

## 2. Design choice

Recommended approach:

- keep the existing `signals` table working as legacy/current runtime storage
- add new readiness-specific tables rather than mutating current flows immediately
- backfill or dual-write later during migration

Reason:

- the current app already uses `signals` and `intent_score`
- the new readiness model is richer and should not be forced into the old flat shape
- separate tables let us ship incrementally without destabilizing existing signal/event logic

---

## 3. Proposed tables

### 3.1 `signal_source_events`

Purpose:

- immutable record of raw evidence from external or first-party systems

Recommended columns:

```sql
create table signal_source_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_scope text not null check (entity_scope in ('company', 'contact')),
  entity_company_id uuid null references companies(id) on delete cascade,
  entity_contact_id uuid null references contacts(id) on delete cascade,
  source text not null,
  source_event_type text not null,
  source_event_id text null,
  source_url text null,
  title text null,
  summary text null,
  excerpt text null,
  event_at timestamptz null,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signal_source_events_entity_check check (
    (entity_scope = 'company' and entity_company_id is not null and entity_contact_id is null)
    or
    (entity_scope = 'contact' and entity_contact_id is not null)
  )
);
```

Indexes:

```sql
create index signal_source_events_user_company_idx
  on signal_source_events (user_id, entity_company_id, observed_at desc);

create index signal_source_events_user_contact_idx
  on signal_source_events (user_id, entity_contact_id, observed_at desc);

create index signal_source_events_source_dedupe_idx
  on signal_source_events (user_id, source, coalesce(source_event_id, ''), coalesce(source_url, ''));
```

Notes:

- `source_event_id` is preferred for dedupe when available
- `source_url` is fallback dedupe support only
- keep `metadata` raw and source-specific

### 3.2 `normalized_signals`

Purpose:

- source-agnostic, canonical signal rows derived from source events

Recommended columns:

```sql
create table normalized_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id uuid not null references signal_source_events(id) on delete cascade,
  signal_key text not null,
  signal_scope text not null check (signal_scope in ('company', 'contact')),
  company_id uuid null references companies(id) on delete cascade,
  contact_id uuid null references contacts(id) on delete cascade,
  dimensions text[] not null,
  buyer_functions text[] not null default '{}',
  intent_mechanisms text[] not null default '{}',
  default_strength text not null check (default_strength in ('weak', 'medium', 'strong')),
  default_confidence text not null check (default_confidence in ('low', 'medium', 'high')),
  event_at timestamptz null,
  observed_at timestamptz not null,
  evidence_excerpt text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint normalized_signals_entity_check check (
    (signal_scope = 'company' and company_id is not null)
    or
    (signal_scope = 'contact' and contact_id is not null)
  )
);
```

Indexes:

```sql
create index normalized_signals_user_company_idx
  on normalized_signals (user_id, company_id, observed_at desc);

create index normalized_signals_user_contact_idx
  on normalized_signals (user_id, contact_id, observed_at desc);

create index normalized_signals_signal_key_idx
  on normalized_signals (user_id, signal_key, observed_at desc);
```

Notes:

- `dimensions` is stored as a text array for now; app code should still validate against enums
- one source event may create multiple normalized signals if needed

### 3.3 `account_readiness_snapshots`

Purpose:

- computed account-level readiness state for product and agents

Recommended columns:

```sql
create table account_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  fit_score numeric(5,4) null,
  fit_label text null check (fit_label in ('low', 'medium', 'high')),
  overall_score numeric(5,4) not null,
  overall_label text not null check (overall_label in ('low', 'medium', 'high')),
  new_budget_score numeric(5,4) not null,
  new_budget_label text not null check (new_budget_label in ('low', 'medium', 'high')),
  new_budget_confidence text not null check (new_budget_confidence in ('low', 'medium', 'high')),
  new_needs_score numeric(5,4) not null,
  new_needs_label text not null check (new_needs_label in ('low', 'medium', 'high')),
  new_needs_confidence text not null check (new_needs_confidence in ('low', 'medium', 'high')),
  new_people_score numeric(5,4) not null,
  new_people_label text not null check (new_people_label in ('low', 'medium', 'high')),
  new_people_confidence text not null check (new_people_confidence in ('low', 'medium', 'high')),
  new_strategy_score numeric(5,4) not null,
  new_strategy_label text not null check (new_strategy_label in ('low', 'medium', 'high')),
  new_strategy_confidence text not null check (new_strategy_confidence in ('low', 'medium', 'high')),
  caution_score numeric(5,4) not null,
  caution_label text not null check (caution_label in ('low', 'medium', 'high')),
  caution_confidence text not null check (caution_confidence in ('low', 'medium', 'high')),
  top_signal_ids uuid[] not null default '{}',
  freshness_score numeric(5,4) null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);
```

Indexes:

```sql
create index account_readiness_snapshots_user_readiness_idx
  on account_readiness_snapshots (user_id, overall_score desc, updated_at desc);
```

Notes:

- this is the primary table for sorting and list views
- one row per user/account
- overwrite on recompute

### 3.4 `account_reason_snapshots`

Purpose:

- generated explanation layer, decoupled from numeric readiness storage

Recommended columns:

```sql
create table account_reason_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  readiness_snapshot_id uuid not null references account_readiness_snapshots(id) on delete cascade,
  summary_short text not null,
  summary_long text not null,
  why_now text not null,
  affected_functions text[] not null default '{}',
  suggested_angle text not null,
  confidence_label text not null check (confidence_label in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id)
);
```

Notes:

- overwrite on recompute
- keep separate from numeric scoring so reason generation can evolve without touching core scoring tables

### 3.5 `readiness_snapshot_evidence`

Purpose:

- join table linking a readiness snapshot to the normalized signals that support it

Recommended columns:

```sql
create table readiness_snapshot_evidence (
  readiness_snapshot_id uuid not null references account_readiness_snapshots(id) on delete cascade,
  normalized_signal_id uuid not null references normalized_signals(id) on delete cascade,
  dimension text not null check (dimension in ('new_budget', 'new_needs', 'new_people', 'new_strategy', 'caution')),
  contribution numeric(5,4) not null,
  created_at timestamptz not null default now(),
  primary key (readiness_snapshot_id, normalized_signal_id, dimension)
);
```

Notes:

- this is important for explainability and debugging
- agents and UI can trace "why this score?" without recomputing

---

## 4. Optional view for agent consumption

Recommended:

- keep agent payload assembly in application code at first
- later add a SQL view if repeated joins become heavy

Possible future view:

- `account_readiness_context_view`

This would join:

- `companies`
- `account_readiness_snapshots`
- `account_reason_snapshots`
- top evidence via `readiness_snapshot_evidence`

Not recommended as phase 1 because:

- top-N evidence selection is easier in code initially
- prompt payloads may change faster than DB schema

---

## 5. Relationship to existing tables

Current relevant tables:

- `companies`
- `contacts`
- `signals`

Recommended transition path:

### Phase 1

- leave `signals` unchanged
- add readiness tables in parallel
- build new ingestion + normalization + scoring pipeline against the new tables

### Phase 2

- optionally dual-write legacy `signals` and new `signal_source_events`
- compare outputs

### Phase 3

- update UI/agents to read from readiness snapshots instead of legacy intent-only logic

### Phase 4

- decide whether legacy `signals` remains as a compatibility layer or is retired

---

## 6. RLS guidance

All readiness tables should be user-scoped the same way as current data tables.

Recommended rule pattern:

- `user_id = auth.uid()`

Apply RLS to:

- `signal_source_events`
- `normalized_signals`
- `account_readiness_snapshots`
- `account_reason_snapshots`
- `readiness_snapshot_evidence` via parent snapshot ownership

---

## 7. Migration order

Recommended order:

1. create `signal_source_events`
2. create `normalized_signals`
3. create `account_readiness_snapshots`
4. create `account_reason_snapshots`
5. create `readiness_snapshot_evidence`
6. add indexes
7. add RLS policies

---

## 8. Open decisions

- whether company fit label should be stored in readiness snapshots or derived at read time
- whether contact-level readiness snapshots are needed later, or account-level is enough for v1
- whether first-party HubSpot states should also backfill legacy `signals`
- whether reason snapshot history is worth preserving or whether only latest state matters

