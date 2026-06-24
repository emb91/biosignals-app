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

// ── Types ─────────────────────────────────────────────────────────────────

type SignalItem = {
  id: string;
  signalKey: string;
  dimensions: string[];
  companyId: string | null;
  contactId: string | null;
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
   * When both contactId and companyId are provided, which scope to show first.
   * Defaults to 'company' (accounts panel); pass 'contact' for the contacts panel.
   */
  primaryScope?: 'contact' | 'company';
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
    const signalText =
      topSignals.length === 0
        ? 'recent activity'
        : topSignals.length === 1
          ? topSignals[0]
          : topSignals.length === 2
            ? `${topSignals[0]} and ${topSignals[1]}`
            : `${topSignals[0]}, ${topSignals[1]}, and ${topSignals[2]}`;
    return `Recent signals for ${entityLabel} include ${signalText}.`;
  }

  const score = effectiveScore ?? readiness.overallScore;
  const label = scoreLabel(score);
  const hasActiveSignals =
    [readiness.newBudgetScore, readiness.newNeedsScore, readiness.newPeopleScore, readiness.newStrategyScore]
      .some((s) => s != null && s >= 0.2);

  if (!hasActiveSignals) {
    return `${entityLabel} has low readiness because there are not enough recent buying signals yet. This can change as new account or contact activity appears.`;
  }

  if (label === 'high') {
    return `${entityLabel} has strong recent buying signals and is ready for outreach now.`;
  }
  if (label === 'medium') {
    return `${entityLabel} shows some positive activity, but the signals are still building.`;
  }
  return `${entityLabel} has limited readiness right now. The signals are there, but not yet enough to make this a strong outreach moment.`;
}

async function fetchSignals(params: URLSearchParams): Promise<SignalItem[]> {
  const json: { data?: Array<SignalItem & { sourceMetadata?: Record<string, unknown> }>; error?: string } =
    await fetch(`/api/signals/feed?${params.toString()}`).then((r) => r.json());
  if (json.error) throw new Error(json.error);
  return (json.data ?? []).map((item) => ({ ...item, sourceMetadata: item.sourceMetadata ?? {} }));
}

export function EntitySignalsList({
  companyId,
  contactId,
  primaryScope = 'company',
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

    const bothProvided = !!(companyId && contactId);

    if (bothProvided) {
      // Fetch contact signals and company signals separately, then merge.
      // Contact signals come first when primaryScope='contact' (contacts panel),
      // company signals come first when primaryScope='company' (accounts panel).
      const contactParams = new URLSearchParams({ pageSize: '50', contact_id: contactId! });
      const companyParams = new URLSearchParams({ pageSize: '50', company_id: companyId! });
      Promise.all([fetchSignals(contactParams), fetchSignals(companyParams)])
        .then(([contactItems, companyItems]) => {
          if (cancelled) return;
          // Dedup company items that already appear in contact items
          const contactIds = new Set(contactItems.map((i) => i.id));
          const uniqueCompanyItems = companyItems.filter((i) => !contactIds.has(i.id));
          const merged = primaryScope === 'contact'
            ? [...contactItems, ...uniqueCompanyItems]
            : [...uniqueCompanyItems, ...contactItems];
          setItems(merged);
        })
        .catch((e) => { if (!cancelled) setError(String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      const params = new URLSearchParams({ pageSize: '50' });
      if (companyId) params.set('company_id', companyId);
      if (contactId) params.set('contact_id', contactId);
      fetchSignals(params)
        .then((data) => { if (!cancelled) setItems(data); })
        .catch((e) => { if (!cancelled) setError(String(e)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; };
  }, [companyId, contactId, primaryScope]);

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
          {contactId ? 'contact or their company' : 'account'}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Signal count */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {items.length} signal{items.length !== 1 ? 's' : ''}
      </p>

      {/* Signal list — with optional section headers when both contact + company signals are shown */}
      {(contactId && companyId) ? (() => {
        const contactItems = items.filter((i) => i.contactId === contactId);
        const companyItems = items.filter((i) => !contactItems.includes(i));
        const [firstGroup, secondGroup] = primaryScope === 'contact'
          ? [{ label: 'Contact signals', items: contactItems }, { label: 'Account signals', items: companyItems }]
          : [{ label: 'Account signals', items: companyItems }, { label: 'Contact signals', items: contactItems }];
        return (
          <div className="space-y-4">
            {firstGroup.items.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">{firstGroup.label}</p>
                {firstGroup.items.map((item) => <SignalCard key={item.id} item={item} />)}
              </div>
            )}
            {secondGroup.items.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">{secondGroup.label}</p>
                {secondGroup.items.map((item) => <SignalCard key={item.id} item={item} />)}
              </div>
            )}
          </div>
        );
      })() : (
        <div className="space-y-2">
          {items.map((item) => (
            <SignalCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
