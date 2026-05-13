/**
 * Strip internal database identifiers from Arcova agent text shown to operators.
 * Tool calls keep full JSON (with ids); this runs only on user-visible prose.
 */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Parenthetical id tails the model sometimes copies from structured data. */
const ID_PAREN_RE = /\(\s*id\s*:\s*[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\s*\)/gi;

export function redactInternalIdsFromAgentUserText(text: string): string {
  if (!text.trim()) return text;
  let s = text.replace(ID_PAREN_RE, '').replace(UUID_RE, '');
  s = s.replace(/\(\s*id\s*:\s*\)/gi, '').replace(/\s*\(\s*\)/g, '');
  s = s.replace(/\(\s*\)/g, '');
  s = s.replace(/\s+,/g, ',').replace(/,\s*,+/g, ',');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim();
  return s;
}
