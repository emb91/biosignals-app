/**
 * Cross-page priority types.
 *
 * `/today/priorities` aggregator returns one `TodayPriority` per source (overlap, gap,
 * import failures, stale leads queue, etc.). Each source can also expose its raw items
 * for source-specific pages (the agent inbox on `/icps`, the table on `/health`,
 * etc.) via the `bySource` map.
 */

export type PrioritySeverity = 'low' | 'medium' | 'high';

export type PrioritySource =
  | 'icp-audit'
  | 'pipeline-health'
  | 'enrichment-failures'
  | 'import-ready'
  | 'hubspot-sync'
  | 'setup-incomplete'
  | 'top-leads'
  | 'stale-ready-queue'
  | 'send-outreach'
  | 'new-accounts';

/** Single agenda-item shape used on /today. Always one entry per source per groupKey. */
export interface TodayPriority {
  source: PrioritySource;
  /** Sub-key when a source can produce multiple distinct buckets (rare). Most sources use 'default'. */
  groupKey: string;
  severity: PrioritySeverity;
  title: string;
  detail: string;
  href: string;
  cta: string;
  /** When >1, render a small count pill on the agenda row. */
  count?: number;
}
