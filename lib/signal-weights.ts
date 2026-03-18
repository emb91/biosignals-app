/**
 * Calculate signal weight based on position in the priority list.
 * Position 1 gets weight 1.0, with a decay of 0.15 per position.
 * Minimum weight is 0.1.
 */
export function calculateSignalWeight(position: number): number {
  // position is 0-indexed
  const weight = 1.0 - (position * 0.15);
  return Math.max(0.1, Math.round(weight * 100) / 100); // Round to 2 decimal places, min 0.1
}

/**
 * Transform an ordered array of signal IDs into weighted signal objects.
 */
export function assignSignalWeights(signalIds: string[]): { id: string; weight: number }[] {
  return signalIds.map((id, index) => ({
    id,
    weight: calculateSignalWeight(index),
  }));
}

/**
 * Extract signal IDs from weighted signal objects (for backward compatibility).
 */
export function extractSignalIds(signals: ({ id: string; weight: number } | string)[]): string[] {
  return signals.map(signal => 
    typeof signal === 'string' ? signal : signal.id
  );
}

/**
 * Transform an ordered array of function names into weighted function objects.
 * Uses the same decay curve as signals.
 */
export function assignFunctionWeights(functions: string[]): { name: string; weight: number }[] {
  return functions.map((name, index) => ({
    name,
    weight: calculateSignalWeight(index),
  }));
}
