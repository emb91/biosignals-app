/** Integer 0–100 for fit gauges (accepts 0–1 or 0–100 from the API). */
export function percentDisplayNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
}

/** Teal / orange / red arc bands (Contacts and Accounts table gauges). */
export function fitScoreArcColor(pct: number | null): string {
  if (pct == null) return 'rgba(13,53,71,0.14)';
  if (pct >= 80) return '#00A4B4';
  if (pct >= 45) return '#F97316';
  return '#EF4444';
}
