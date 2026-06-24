/**
 * Author-name → normalized "Last F" cross-match token (Phase 3 social-intent).
 *
 * Identical token shape to run-publications-monitor.ts's authorQueryToken, so a
 * social author and a tracked contact resolve through the SAME key: lowercase
 * "lastname firstinitial". The token is the per-user contact cross-match key the
 * social monitor uses; the employer cross-check is the disambiguation guard on top
 * (a common "smith j" token alone is too noisy to trust).
 *
 * Returns null when extraction is unreliable (single-word handle, empty), which is
 * a hard drop — we never emit on an unresolvable author.
 *
 * NEW file. Pure function, no IO — unit-tested against fixtures.
 */

/** Strip credential/suffix noise that follows a name on LinkedIn ("Jane Doe, PhD, MBA"). */
const TRAILING_CREDENTIALS =
  /,?\s*\b(phd|md|mba|msc|bsc|pharmd|do|rn|np|pa|facp|faan|dvm|jd|esq|ii|iii|jr|sr)\b\.?/gi;

/**
 * Extract the lowercase "last f" token from a display name.
 *   "Jane Doe"            → "doe j"
 *   "Doe, Jane"           → "doe j"
 *   "Dr. Jane A. Doe, PhD"→ "doe j"
 * Returns null for single-token or empty names.
 */
export function authorNameToken(fullName: string | null | undefined): string | null {
  let trimmed = (fullName ?? '').trim();
  if (!trimmed) return null;

  // Drop a leading honorific.
  trimmed = trimmed.replace(/^\s*(dr|mr|mrs|ms|prof|professor)\.?\s+/i, '');
  // Drop trailing credentials.
  trimmed = trimmed.replace(TRAILING_CREDENTIALS, '').trim();
  if (!trimmed) return null;

  // "Last, First" format.
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx > 0) {
    const last = trimmed.slice(0, commaIdx).trim();
    const rest = trimmed.slice(commaIdx + 1).trim();
    const firstInitial = rest.charAt(0);
    if (last && firstInitial) return `${last} ${firstInitial}`.toLowerCase();
  }

  // "First [Middle] Last" format.
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const firstInitial = parts[0].charAt(0);
  if (!last || !firstInitial) return null;
  return `${last} ${firstInitial}`.toLowerCase();
}
