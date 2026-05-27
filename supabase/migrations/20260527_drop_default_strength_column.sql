-- Drop default_strength from normalized_signals.
-- The SignalStrength type and defaultStrength field were removed from the
-- type system in favour of points-based scoring (baseImpactScore). Nothing
-- writes to this column anymore.

ALTER TABLE normalized_signals
  DROP COLUMN IF EXISTS default_strength;
