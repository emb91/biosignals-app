'use client';

/**
 * EntitySignalsList
 *
 * Compact inline signal list for the accounts and contacts side panels.
 * Fetches from /api/signals/feed with an entity-scoped filter and renders
 * a scrollable list of signal cards. Used in the Signals tab of both panels.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress-bar';

// ── Types ─────────────────────────────────────────────────────────────────

type SignalItem = {
  id: string;
  signalKey: string;
  dimensions: string[];
  defaultStrength: string;
  defaultConfidence: string;
  observedAt: string;
  eventAt: string | null;
  evidenceExcerpt: string | null;
  sourceTitle: string | null;
  sourceSummary: string | null;
  sourceUrl: string | null;
  buyerFunctions: string[];
  readiness?: {
    overallScore: number | null;
    overallLabel: string | null;
    newBudgetScore: number | null;
    newNeedsScore: number | null;
    newPeopleScore: number | null;
    newStrategyScore: number | null;
    cautionScore: number | null;
  } | null;
  reason?: {
    whyNow: string | null;
    summaryShort: string | null;
  } | null;
};

type Props = {
  /** UUID of the company (accounts panel) */
  companyId?: string;
  /** UUID of the contact (contacts panel) */
  contactId?: string;
};

// ── Display helpers ────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  cmc_hiring: 'CMC Hiring',
  clinical_ops_hiring: 'Clinical Ops Hiring',
  regulatory_hiring: 'Regulatory Hiring',
  bd_hiring: 'BD Hiring',
  commercial_hiring: 'Commercial Hiring',
  job_surge: 'Hiring Surge',
  funding_round: 'Funding Round',
  ipo_or_follow_on: 'IPO / Follow-on',
  milestone_payment: 'Milestone Payment',
  partnership_with_upfront_economics: 'Partnership (Upfront)',
  ma_event: 'M&A Event',
  partnership_deal: 'Partnership Deal',
  patent_filed_or_granted: 'Patent Filed / Granted',
  patent_granted: 'Patent Granted',
  patent_application_published: 'Patent Application',
  new_therapeutic_area_patent: 'New TA Patent',
  assignee_portfolio_acceleration: 'Patent Portfolio Surge',
  clinical_trial_registered: 'Trial Registered',
  clinical_trial_recruiting: 'Trial Recruiting',
  clinical_trial_completed: 'Trial Completed',
  clinical_trial_sponsor_change: 'Sponsor Change',
  phase_transition: 'Phase Transition',
  trial_site_expansion: 'Site Expansion',
  indication_expansion: 'Indication Expansion',
  trial_failure_or_halt: 'Trial Halted',
  program_discontinuation: 'Program Discontinued',
  fda_approval: 'FDA Approval',
  breakthrough_designation: 'Breakthrough',
  fast_track_designation: 'Fast Track',
  priority_review: 'Priority Review',
  orphan_designation: 'Orphan Designation',
  complete_response_letter: 'CRL Received',
  grant_award: 'Grant Award',
  new_to_role: 'New to Role',
  recently_changed_company: 'Changed Company',
  recently_promoted: 'Promoted',
  new_internal_role: 'New Internal Role',
  title_change: 'Title Change',
  board_or_advisory_role: 'Board / Advisory Role',
  open_opportunity_in_crm: 'Open Opportunity',
  closed_lost_in_crm: 'Closed Lost',
  new_contact_added_in_crm: 'New CRM Contact',
  prior_customer_relationship: 'Prior Customer',
  prior_active_deal_relationship: 'Prior Active Deal',
  prior_pipeline_relationship: 'Prior Pipeline',
  key_contact_departed: 'Contact Departed',
};

const DIMENSION_COLORS: Record<string, string> = {
  new_budget: 'bg-emerald-500',
  new_needs: 'bg-blue-500',
  new_people: 'bg-violet-500',
  new_strategy: 'bg-amber-500',
  caution: 'bg-rose-500',
};

const STRENGTH_STYLES: Record<string, string> = {
  strong: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  medium: 'bg-slate-100 text-slate-600 ring-slate-200',
  weak: 'bg-slate-50 text-slate-400 ring-slate-100',
};

const READINESS_LABEL_STYLES: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  low: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const DIMENSION_PILL_STYLES: Record<string, string> = {
  new_budget: 'bg-emerald-50 text-emerald-700',
  new_needs: 'bg-blue-50 text-blue-700',
  new_people: 'bg-violet-50 text-violet-700',
  new_strategy: 'bg-amber-50 text-amber-700',
  caution: 'bg-rose-50 text-rose-700',
};

function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ── Readiness band (company only) ─────────────────────────────────────────

function readinessArcColor(pct: number | null): string {
  if (pct == null) return 'rgba(13,53,71,0.14)';
  if (pct >= 70) return '#10b981'; // emerald-500
  if (pct >= 35) return '#f59e0b'; // amber-500
  return '#ef4444';                // red-500
}

function ReadinessBand({ r }: { r: NonNullable<SignalItem['readiness']> }) {
  if (!r.overallLabel) return null;

  const pct = r.overallScore != null ? Math.round(r.overallScore * 100) : null;
  const arcColor = readinessArcColor(pct);

  const dims = [
    { key: 'new_budget', label: 'Budget', score: r.newBudgetScore },
    { key: 'new_needs', label: 'Needs', score: r.newNeedsScore },
    { key: 'new_people', label: 'People', score: r.newPeopleScore },
    { key: 'new_strategy', label: 'Strategy', score: r.newStrategyScore },
  ].filter((d) => d.score != null && d.score > 0);

  return (
    <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="flex items-center gap-3">
        {/* Circular score gauge */}
        <div className="shrink-0">
          <AnimatedCircularProgressBar
            value={pct ?? 0}
            gaugePrimaryColor={arcColor}
            gaugeSecondaryColor="rgba(13,53,71,0.09)"
            animateOnMount
            deferAnimationMs={160}
            label={
              <span className="block text-sm font-semibold text-gray-700 leading-snug tabular-nums">
                {pct != null ? `${pct}` : '—'}
              </span>
            }
            className="size-12 [--transition-length:0.95s]"
          />
        </div>

        {/* Label + dimensions */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Readiness</p>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
                READINESS_LABEL_STYLES[r.overallLabel] ?? 'bg-slate-100 text-slate-600',
              )}
            >
              {r.overallLabel}
            </span>
          </div>
          {dims.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {dims.map((d) => (
                <div key={d.key} className="flex items-center gap-1">
                  <div className={cn('h-1.5 w-1.5 rounded-full', DIMENSION_COLORS[d.key] ?? 'bg-slate-300')} />
                  <span className="text-[10px] text-slate-500">{d.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Signal card ────────────────────────────────────────────────────────────

function SignalCard({ item }: { item: SignalItem }) {
  const primaryDim = item.dimensions[0] ?? '';
  const accent = DIMENSION_COLORS[primaryDim] ?? 'bg-slate-300';
  const excerpt = item.evidenceExcerpt || item.sourceSummary || null;

  return (
    <div className="relative flex gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2.5 hover:border-slate-200 transition-colors">
      {/* Left accent bar */}
      <div className={cn('mt-1 h-3 w-1 shrink-0 rounded-full', accent)} />

      <div className="min-w-0 flex-1 space-y-1">
        {/* Title row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-slate-900 leading-tight">
            {signalLabel(item.signalKey)}
          </span>
          <span
            className={cn(
              'rounded-full px-1.5 py-px text-[10px] font-medium capitalize ring-1',
              STRENGTH_STYLES[item.defaultStrength] ?? STRENGTH_STYLES.medium,
            )}
          >
            {item.defaultStrength}
          </span>
          <span className="text-[11px] text-slate-400 ml-auto shrink-0">
            {relativeTime(item.observedAt)}
          </span>
        </div>

        {/* Dimension pills */}
        {item.dimensions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.dimensions.map((d) => (
              <span
                key={d}
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-medium',
                  DIMENSION_PILL_STYLES[d] ?? 'bg-slate-100 text-slate-500',
                )}
              >
                {d.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}

        {/* Excerpt */}
        {excerpt && (
          <p className="text-[12px] leading-snug text-slate-500 line-clamp-2">{excerpt}</p>
        )}

        {/* Source link */}
        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-arcova-teal hover:underline"
          >
            Source <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function EntitySignalsList({ companyId, contactId }: Props) {
  const [items, setItems] = useState<SignalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId && !contactId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ pageSize: '50' });
    if (companyId) params.set('company_id', companyId);
    if (contactId) params.set('contact_id', contactId);

    fetch(`/api/signals/feed?${params.toString()}`)
      .then((r) => r.json())
      .then((json: { data?: SignalItem[]; error?: string }) => {
        if (cancelled) return;
        if (json.error) { setError(json.error); return; }
        setItems(json.data ?? []);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [companyId, contactId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
      </div>
    );
  }

  if (error) {
    return <p className="py-8 text-center text-xs text-rose-500">{error}</p>;
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-slate-500">No signals yet</p>
        <p className="mt-1 text-xs text-slate-400">
          Signals appear here as intelligence is collected on this{' '}
          {companyId ? 'account' : 'contact'}.
        </p>
      </div>
    );
  }

  // For company panels, show the readiness band from the first item that has one
  const readiness = companyId ? (items.find((i) => i.readiness?.overallLabel)?.readiness ?? null) : null;
  const whyNow = companyId ? (items.find((i) => i.reason?.whyNow)?.reason?.whyNow ?? null) : null;

  return (
    <div className="space-y-3">
      {/* Readiness band — company only */}
      {readiness && <ReadinessBand r={readiness} />}

      {/* Why now — generated reason */}
      {whyNow && (
        <p className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[12px] leading-snug text-indigo-800">
          {whyNow}
        </p>
      )}

      {/* Signal count */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {items.length} signal{items.length !== 1 ? 's' : ''}
      </p>

      {/* Signal list */}
      <div className="space-y-2">
        {items.map((item) => (
          <SignalCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
