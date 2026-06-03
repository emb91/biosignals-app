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

  observedAt: string;
  eventAt: string | null;
  evidenceExcerpt: string | null;
  sourceTitle: string | null;
  sourceSummary: string | null;
  sourceUrl: string | null;
  sourceMetadata: Record<string, unknown>;
  companyName: string | null;
  contactName: string | null;
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
  /**
   * When set, overrides the raw readiness score shown in the readiness band.
   * Used when CRM status caps the effective readiness (e.g. closed-won customer).
   * Value is 0–1.
   */
  effectiveReadinessScore?: number | null;
  /** Human-readable reason the readiness is capped, shown as a note. */
  crmCappedReason?: string | null;
};

// ── Display helpers ────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, string> = {
  cmc_hiring: 'CMC Hiring',
  clinical_ops_hiring: 'Clinical Ops Hiring',
  regulatory_hiring: 'Regulatory Hiring',
  research_hiring: 'R&D Hiring',
  quality_hiring: 'Quality / GMP Hiring',
  medical_hiring: 'Medical Affairs Hiring',
  bd_hiring: 'BD Hiring',
  commercial_hiring: 'Commercial Hiring',
  data_informatics_hiring: 'Data & Informatics Hiring',
  executive_hiring: 'Executive Hiring',
  hiring_expansion: 'Hiring Expansion',
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
  leadership_churn: 'Leadership Change',
  restructuring: 'Restructuring',
  terminated_deal: 'Deal Terminated',
  acquisition_distraction: 'Acquisition',
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

// ── Readiness band ────────────────────────────────────────────────────────

function readinessArcColor(pct: number | null): string {
  if (pct == null) return 'rgba(13,53,71,0.14)';
  if (pct >= 70) return '#10b981'; // emerald-500
  if (pct >= 35) return '#f59e0b'; // amber-500
  return '#ef4444';                // red-500
}

function ReadinessBand({
  r,
  effectiveScore,
  cappedReason,
}: {
  r: NonNullable<SignalItem['readiness']>;
  effectiveScore?: number | null;
  cappedReason?: string | null;
}) {
  if (!r.overallLabel) return null;

  const rawPct = r.overallScore != null ? Math.round(r.overallScore * 100) : null;
  const effectivePct = effectiveScore != null ? Math.round(effectiveScore * 100) : null;
  const isCapped = effectivePct != null && rawPct != null && effectivePct < rawPct;
  const pct = isCapped ? effectivePct : rawPct;
  const displayLabel = isCapped && effectiveScore != null ? scoreLabel(effectiveScore) : r.overallLabel;
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
                READINESS_LABEL_STYLES[displayLabel] ?? 'bg-slate-100 text-slate-600',
              )}
            >
              {displayLabel}
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
      {isCapped && cappedReason && (
        <p className="mt-2 text-[11px] leading-snug text-amber-800">
          Raw signal readiness is {rawPct}; effective readiness is capped at {effectivePct}.
        </p>
      )}
    </div>
  );
}

// ── Deal details extraction ────────────────────────────────────────────────

function formatUsd(n: unknown): string | null {
  const num = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : null;
  if (num == null || !Number.isFinite(num) || num <= 0) return null;
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(0)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

function coerceStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

type DealRow = { label: string; value: string };

const DEAL_SIGNAL_KEYS = new Set([
  'licensing_deal', 'partnership_with_upfront_economics', 'co_development_deal',
  'partnership_deal', 'milestone_payment', 'ma_event', 'terminated_deal',
]);

function extractDealRows(signalKey: string, metadata: Record<string, unknown>): DealRow[] {
  const rows: DealRow[] = [];
  const c = metadata.classification && typeof metadata.classification === 'object'
    ? (metadata.classification as Record<string, unknown>)
    : null;

  // Form D — structured XML fields sit directly on metadata
  if (signalKey === 'funding_round' && !c) {
    const offered = formatUsd(metadata.total_offering_amount);
    const sold = formatUsd(metadata.total_amount_sold);
    if (offered) rows.push({ label: 'Offering size', value: offered });
    if (sold && sold !== offered) rows.push({ label: 'Raised to date', value: sold });
    return rows;
  }

  if (!c) return rows;

  // 424B prospectus — IPO / follow-on proceeds
  if (signalKey === 'ipo_or_follow_on') {
    const type = coerceStr(c.offering_type);
    const gross = formatUsd(c.gross_proceeds_usd);
    const use = coerceStr(c.use_of_proceeds_summary);
    if (type) rows.push({ label: 'Type', value: type.replace(/_/g, ' ') });
    if (gross) rows.push({ label: 'Gross proceeds', value: gross });
    if (use) rows.push({ label: 'Use of proceeds', value: use });
    return rows;
  }

  // 8-K leadership change
  if (signalKey === 'leadership_churn') {
    const name = coerceStr(c.person_name);
    const role = coerceStr(c.role);
    const type = coerceStr(c.change_type);
    if (name || role) {
      const parts = [type ? type.charAt(0).toUpperCase() + type.slice(1) : null, name, role ? `(${role})` : null]
        .filter(Boolean).join(' ');
      if (parts) rows.push({ label: 'Person', value: parts });
    }
    const circ = coerceStr(c.circumstances);
    if (circ) rows.push({ label: 'Circumstances', value: circ });
    return rows;
  }

  // Terminated deal
  if (signalKey === 'terminated_deal') {
    const party = coerceStr(c.counterparty);
    const agreeType = coerceStr(c.agreement_type);
    const partyType = coerceStr(c.counterparty_type);
    const reason = coerceStr(c.termination_reason);
    if (party) rows.push({ label: 'Counterparty', value: party });
    if (agreeType) rows.push({ label: 'Agreement', value: agreeType.replace(/_/g, ' ') });
    if (partyType) rows.push({ label: 'Counterparty type', value: partyType.toUpperCase() });
    if (reason) rows.push({ label: 'Reason', value: reason.replace(/_/g, ' ') });
    return rows;
  }

  // Deal signals — licensing, partnership, co-dev, milestone, M&A
  if (DEAL_SIGNAL_KEYS.has(signalKey)) {
    const party = coerceStr(c.counterparty);
    const upfront = formatUsd(c.upfront_usd);
    const milestones = formatUsd(c.milestone_max_usd);
    const area = coerceStr(c.therapy_area);
    const territory = coerceStr(c.territory);
    const structure = coerceStr(c.deal_structure);
    if (party) rows.push({ label: 'Counterparty', value: party });
    if (upfront) rows.push({ label: 'Upfront', value: upfront });
    if (milestones) rows.push({ label: 'Max milestones', value: milestones });
    if (area) rows.push({ label: 'Area', value: area });
    if (territory) rows.push({ label: 'Territory', value: territory });
    if (structure) rows.push({ label: 'Structure', value: structure });
  }

  return rows;
}

function DealDetails({ rows }: { rows: DealRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2">
      {rows.map(({ label, value }) => (
        <div key={label} className="col-span-1 min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400 leading-none mb-0.5">
            {label}
          </dt>
          <dd className="text-[11px] text-slate-700 font-medium leading-snug truncate" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Signal card ────────────────────────────────────────────────────────────

function SignalCard({ item }: { item: SignalItem }) {
  const primaryDim = item.dimensions[0] ?? '';
  const accent = DIMENSION_COLORS[primaryDim] ?? 'bg-slate-300';
  const excerpt = item.evidenceExcerpt || item.sourceSummary || null;
  const dealRows = extractDealRows(item.signalKey, item.sourceMetadata ?? {});

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
          <span className="text-[11px] text-slate-400 ml-auto shrink-0">
            {/* When the event actually happened (event_at), not when we scraped
                it (observed_at). A patent filed in April shouldn't read as "1w
                ago" because we detected it last month. */}
            {relativeTime(item.eventAt ?? item.observedAt)}
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

        {/* Excerpt / rationale */}
        {excerpt && (
          <p className="text-[12px] leading-snug text-slate-500 line-clamp-2">{excerpt}</p>
        )}

        {/* Structured deal / event details */}
        <DealDetails rows={dealRows} />

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

function scoreLabel(score: number | null): string {
  if (score == null) return 'low';
  if (score >= 0.7) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

function buildReadinessSummary({
  entityLabel,
  items,
  readiness,
  effectiveScore,
  cappedReason,
  generatedReason,
}: {
  entityLabel: string;
  items: SignalItem[];
  readiness: SignalItem['readiness'] | null;
  effectiveScore?: number | null;
  cappedReason?: string | null;
  generatedReason?: string | null;
}): string | null {
  if (cappedReason) return cappedReason;
  if (generatedReason) return generatedReason;
  if (!readiness?.overallScore && readiness?.overallScore !== 0) {
    const topSignals = items
      .slice(0, 3)
      .map((item) => signalLabel(item.signalKey).toLowerCase());
    const dims = [...new Set(items.flatMap((item) => item.dimensions))].slice(0, 3);
    const signalText =
      topSignals.length === 0
        ? 'recent activity'
        : topSignals.length === 1
          ? topSignals[0]
          : topSignals.length === 2
            ? `${topSignals[0]} and ${topSignals[1]}`
            : `${topSignals[0]}, ${topSignals[1]}, and ${topSignals[2]}`;
    const dimText =
      dims.length === 0
        ? ''
        : ` These signals are mostly in ${dims.map((d) => d.replace(/_/g, ' ')).join(', ')}.`;
    return `Recent signals for ${entityLabel} include ${signalText}.${dimText}`.trim();
  }

  const activeDims = [
    { label: 'new budget', score: readiness.newBudgetScore },
    { label: 'new needs', score: readiness.newNeedsScore },
    { label: 'new people', score: readiness.newPeopleScore },
    { label: 'new strategy', score: readiness.newStrategyScore },
  ]
    .filter((d) => d.score != null && d.score >= 0.2)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((d) => d.label);

  const score = effectiveScore ?? readiness.overallScore;
  const label = scoreLabel(score);
  if (activeDims.length === 0) {
    return `${entityLabel} has low readiness because there are not enough recent buying signals yet. This can change as new account or contact activity appears.`;
  }

  const joined =
    activeDims.length === 1
      ? activeDims[0]
      : activeDims.length === 2
        ? `${activeDims[0]} and ${activeDims[1]}`
        : `${activeDims.slice(0, -1).join(', ')}, and ${activeDims[activeDims.length - 1]}`;

  if (label === 'high') {
    return `A combination of ${joined} signals means ${entityLabel} is ready for outreach now.`;
  }
  if (label === 'medium') {
    return `${entityLabel} has some readiness from ${joined}, but the evidence is still building.`;
  }
  return `${entityLabel} has limited readiness right now. The strongest evidence is ${joined}, but it is not enough to make this a strong outreach moment yet.`;
}

export function EntitySignalsList({
  companyId,
  contactId,
  effectiveReadinessScore,
  crmCappedReason,
}: Props) {
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
      .then((json: { data?: Array<SignalItem & { sourceMetadata?: Record<string, unknown> }>; error?: string }) => {
        if (cancelled) return;
        if (json.error) { setError(json.error); return; }
        setItems((json.data ?? []).map((item) => ({
          ...item,
          sourceMetadata: item.sourceMetadata ?? {},
        })));
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

  const readiness = items.find((i) => i.readiness?.overallLabel)?.readiness ?? null;
  const reason = items.find((i) => i.reason?.whyNow || i.reason?.summaryShort)?.reason ?? null;
  const entityLabel =
    items.find((i) => (contactId ? i.contactName : i.companyName))?.[contactId ? 'contactName' : 'companyName'] ??
    (companyId ? 'This account' : 'This contact');
  const summary = buildReadinessSummary({
    entityLabel,
    items,
    readiness,
    effectiveScore: effectiveReadinessScore,
    cappedReason: crmCappedReason,
    generatedReason: reason?.whyNow ?? reason?.summaryShort ?? null,
  });

  return (
    <div className="space-y-3">
      {summary && (
        <p className={cn(
          'rounded-lg border px-3 py-2 text-[12px] leading-snug',
          crmCappedReason
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-indigo-100 bg-indigo-50 text-indigo-800',
        )}>
          {summary}
        </p>
      )}

      {readiness && (
        <ReadinessBand
          r={readiness}
          effectiveScore={effectiveReadinessScore}
          cappedReason={crmCappedReason}
        />
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
