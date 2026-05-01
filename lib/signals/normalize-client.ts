/**
 * Normalize API/store `signals` into ordered string IDs.
 * Handles join-table-backed string[], legacy JSON strings, and `{ id }` objects.
 */

export function normalizeOrderedSignalIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== 'string') {
      if (item && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
        return [(item as { id: string }).id];
      }
      return [];
    }

    const trimmed = item.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed) as { id?: string };
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
        return [parsed.id];
      }
    } catch {
      // Stored as raw id string.
    }

    return [trimmed];
  });
}
