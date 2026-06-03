/**
 * Extract human-readable function names from a persona's `functions` column.
 *
 * The column is stored as an array of JSON-encoded strings produced by
 * assignFunctionWeights() during ICP re-enrichment, e.g.
 *   ['{"name":"Business Development","weight":1}', '{"name":"Commercial","weight":0.85}']
 * (older rows may hold plain strings, or already-parsed objects). This
 * normalises all three shapes to a list of names, ordered by weight
 * descending so the primary buying-group functions read first.
 */
export function personaFunctionNames(functions: unknown): string[] {
  if (!Array.isArray(functions)) return [];
  const weighted: Array<{ name: string; weight: number }> = [];
  for (const raw of functions) {
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as { name?: unknown; weight?: unknown };
        if (parsed && typeof parsed.name === 'string') {
          weighted.push({ name: parsed.name, weight: typeof parsed.weight === 'number' ? parsed.weight : 0 });
          continue;
        }
      } catch {
        // not JSON — treat the string itself as the function name
      }
      if (raw.trim()) weighted.push({ name: raw.trim(), weight: 0 });
    } else if (raw && typeof raw === 'object') {
      const obj = raw as { name?: unknown; weight?: unknown };
      if (typeof obj.name === 'string') {
        weighted.push({ name: obj.name, weight: typeof obj.weight === 'number' ? obj.weight : 0 });
      }
    }
  }
  return weighted.sort((a, b) => b.weight - a.weight).map((w) => w.name);
}
