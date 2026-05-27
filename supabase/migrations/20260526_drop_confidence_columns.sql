-- Drop confidence columns removed from the scoring system.
-- The scoring formula is now: contribution = strengthWeight * recency * relevance
-- (no confidenceMultiplier). These columns are no longer written or read.

ALTER TABLE normalized_signals
  DROP COLUMN IF EXISTS default_confidence;

ALTER TABLE account_readiness_snapshots
  DROP COLUMN IF EXISTS new_budget_confidence,
  DROP COLUMN IF EXISTS new_needs_confidence,
  DROP COLUMN IF EXISTS new_people_confidence,
  DROP COLUMN IF EXISTS new_strategy_confidence,
  DROP COLUMN IF EXISTS caution_confidence;

ALTER TABLE contact_readiness_snapshots
  DROP COLUMN IF EXISTS new_budget_confidence,
  DROP COLUMN IF EXISTS new_needs_confidence,
  DROP COLUMN IF EXISTS new_people_confidence,
  DROP COLUMN IF EXISTS new_strategy_confidence,
  DROP COLUMN IF EXISTS caution_confidence;

ALTER TABLE account_reason_snapshots
  DROP COLUMN IF EXISTS confidence_label;
