'use client';

/**
 * EntitySignalsList
 *
 * Compact inline signal list for the accounts and contacts side panels.
 * Fetches from /api/signals/feed with an entity-scoped filter and renders
 * a scrollable list of signal cards. Used in the Signals tab of both panels.
 */

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Calendar,
  Banknote,
  FlaskConical,
  FileText,
  Users,
  BookOpen,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress-bar';
import { fitScoreArcColor, percentDisplayNumber } from '@/lib/fit-gauge';
import { conferenceDisplay, isConferenceSignal } from '@/lib/signals/conference-display';

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
  /**
   * When true, the company-signal list is split into collapsible category
   * groups (Conferences, Funding & deals, Hiring, Patents, …) instead of one
   * flat list — the Companies side-panel design. Opt-in so /contacts and
   * /today keep their existing flat list. Only affects the company-only path.
   */
  grouped?: boolean;
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
    <dl className="mt-2 grid grid-cols-2 gap-x-3.5 gap-y-1 rounded-lg bg-[rgba(13,53,71,0.03)] px-2.5 py-2">
      {rows.map(({ label, value }) => (
        <div key={label} className="col-span-1 min-w-0">
          <dt className="mb-0.5 text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-[#7d909a]">
            {label}
          </dt>
          <dd className="truncate text-[11.5px] font-medium leading-snug text-[#4a6470]" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Signal card ────────────────────────────────────────────────────────────

function SignalCard({ item }: { item: SignalItem }) {
  const dealRows = extractDealRows(item.signalKey, item.sourceMetadata ?? {});

  // Conference signals are forward-looking: event_at is the show's START date, so
  // the generic "Xd ago" framing is wrong (an upcoming show reads as "-118d ago").
  // Mirror /today: show the conference name as the title, booth/date as pills,
  // no relative-time label, and no source link.
  const isConference = isConferenceSignal(item.signalKey);
  const conference = isConference ? conferenceDisplay(item.sourceMetadata ?? {}) : null;
  const title = conference?.title ?? signalLabel(item.signalKey);
  // The summary repeats the booth in parentheses; once we surface a booth pill,
  // drop the excerpt for conferences to avoid showing the booth twice.
  const excerpt = isConference ? null : (item.evidenceExcerpt || item.sourceSummary || null);
  const showSource = !isConference && item.sourceUrl;

  // Flat, divided row — design .sigline (dividers come from the group container).
  return (
    <div className="py-[11px]">
      {/* Title + time (design .sigline-head / .conf-title) */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-manrope text-[13px] font-bold leading-tight tracking-[-0.01em] text-[#0d3547]">
          {title}
        </span>
        {!isConference && (
          // When the event actually happened (event_at), not when we scraped it.
          <span className="shrink-0 text-[11px] tabular-nums text-[#7d909a]">
            {relativeTime(item.eventAt ?? item.observedAt)}
          </span>
        )}
      </div>

      {/* Conference booth / date pills (design .sig-pills) */}
      {conference && conference.pills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {conference.pills.map((pill) => (
            <span
              key={pill}
              className="inline-flex items-center rounded-full bg-[rgba(13,53,71,0.05)] px-2.5 py-1 text-[11.5px] font-medium text-[#4a6470]"
            >
              {pill}
            </span>
          ))}
        </div>
      )}

      {/* Excerpt / rationale (design .sigline-ex) */}
      {excerpt && (
        <p className="mt-1.5 text-[12.5px] leading-snug text-[#4a6470] line-clamp-2">{excerpt}</p>
      )}

      {/* Structured deal / event details */}
      <DealDetails rows={dealRows} />

      {/* Source link (design .sig-src) */}
      {showSource && (
        <a
          href={item.sourceUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#0a7b88] hover:underline"
        >
          Source <ExternalLink className="h-3 w-3" />
        </a>
      )}
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

function SignalGroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">{label}</span>
      <span className="h-px flex-1 bg-[rgba(13,53,71,0.08)]" />
      <span className="text-[10px] font-bold tabular-nums text-[#b6c2c8]">{count}</span>
    </div>
  );
}

// ── Category grouping (Companies side-panel "grouped" mode) ─────────────────
// Ordered categories; each company signal lands in the FIRST matching bucket,
// otherwise "Other signals". Only non-empty buckets render, in this order.
const SIGNAL_CATEGORIES: { key: string; title: string; match: (k: string) => boolean }[] = [
  { key: 'conf', title: 'Conferences & events', match: (k) => isConferenceSignal(k) || k.includes('conference') },
  { key: 'deal', title: 'Funding & deals', match: (k) => /fund|ipo|milestone|partnership|ma_event|acquisition|terminated_deal/.test(k) },
  { key: 'clinical', title: 'Clinical & regulatory', match: (k) => /trial|phase|indication|program_discontinuation|fda|breakthrough|fast_track|priority_review|orphan|complete_response|grant_award/.test(k) },
  { key: 'patent', title: 'Patents & IP', match: (k) => k.includes('patent') || k.includes('portfolio') },
  { key: 'hire', title: 'Hiring & people', match: (k) => /hiring|new_to_role|changed_company|promoted|internal_role|title_change|board_or_advisory|leadership_churn|restructuring|key_contact_departed/.test(k) },
  { key: 'pub', title: 'Publications', match: (k) => k.includes('publication') || k.includes('paper') || k.includes('preprint') },
  { key: 'crm', title: 'CRM activity', match: (k) => k.includes('crm') || k.startsWith('prior_') },
];

function categorizeSignal(key: string): string {
  return SIGNAL_CATEGORIES.find((c) => c.match(key))?.title ?? 'Other signals';
}

// Per-category icon chip (design .sig-ic) — colour language pulled from the
// design files, extended across all live buckets so the look stays coherent.
const CATEGORY_ICONS: Record<string, { icon: ReactNode; chip: string }> = {
  conf: { icon: <Calendar />, chip: 'bg-[rgba(192,131,40,0.12)] text-[#c08328]' },
  deal: { icon: <Banknote />, chip: 'bg-[rgba(45,138,138,0.12)] text-[#2d8a8a]' },
  clinical: { icon: <FlaskConical />, chip: 'bg-[rgba(0,164,180,0.12)] text-[#0a7b88]' },
  patent: { icon: <FileText />, chip: 'bg-[rgba(196,107,122,0.14)] text-[#c46b7a]' },
  hire: { icon: <Users />, chip: 'bg-[rgba(13,102,128,0.10)] text-[#0d6680]' },
  pub: { icon: <BookOpen />, chip: 'bg-[rgba(13,53,71,0.06)] text-[#1f475a]' },
  crm: { icon: <RefreshCw />, chip: 'bg-[rgba(255,122,89,0.10)] text-[#e0613f]' },
  other: { icon: <Sparkles />, chip: 'bg-[rgba(13,53,71,0.05)] text-[#7d909a]' },
};

/** Most-recent signal in a group, as a relative label (design .grp-latest).
 *  Uses observedAt (always in the past) so forward-dated conferences don't skew it. */
function latestRelative(items: SignalItem[]): string | null {
  let latest = 0;
  for (const it of items) {
    const t = new Date(it.observedAt).getTime();
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return latest ? relativeTime(new Date(latest).toISOString()) : null;
}

/** One collapsible category card (design .sig-group-card). Large groups start collapsed. */
function SignalCategoryGroup({
  categoryKey,
  title,
  items,
  defaultOpen,
}: {
  categoryKey: string;
  title: string;
  items: SignalItem[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const cat = CATEGORY_ICONS[categoryKey] ?? CATEGORY_ICONS.other;
  const latest = latestRelative(items);
  return (
    <div className="overflow-hidden rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left transition-colors hover:bg-white/60"
      >
        <span className="inline-flex min-w-0 items-center gap-2.5">
          <span className={cn('grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] [&_svg]:h-3.5 [&_svg]:w-3.5', cat.chip)}>
            {cat.icon}
          </span>
          <span className="truncate font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">{title}</span>
          <span className="rounded-full bg-[rgba(13,53,71,0.06)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#7d909a]">
            {items.length}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2">
          {latest && <span className="text-[11px] tabular-nums text-[#7d909a]">{latest}</span>}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200', open ? '' : '-rotate-90')} />
        </span>
      </button>
      {open && (
        <div className="divide-y divide-[rgba(13,53,71,0.06)] border-t border-[rgba(13,53,71,0.06)] px-3.5 pb-1.5 pt-0.5">
          {items.map((item) => (
            <SignalCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Company signals split into ordered, collapsible category groups. */
function GroupedCompanySignals({ items, label = 'Company signals' }: { items: SignalItem[]; label?: string }) {
  const titleToKey = new Map(SIGNAL_CATEGORIES.map((c) => [c.title, c.key]));
  const order = [...SIGNAL_CATEGORIES.map((c) => c.title), 'Other signals'];
  const byCategory = new Map<string, SignalItem[]>();
  for (const item of items) {
    const cat = categorizeSignal(item.signalKey);
    const bucket = byCategory.get(cat);
    if (bucket) bucket.push(item);
    else byCategory.set(cat, [item]);
  }
  const groups = order
    .filter((title) => byCategory.has(title))
    .map((title) => ({ title, key: titleToKey.get(title) ?? 'other', items: byCategory.get(title)! }));
  return (
    <div className="space-y-2.5">
      <SignalGroupHeader label={label} count={items.length} />
      {groups.map((g) => (
        <SignalCategoryGroup
          key={g.title}
          categoryKey={g.key}
          title={g.title}
          items={g.items}
          defaultOpen={g.items.length <= 3}
        />
      ))}
    </div>
  );
}

export function EntitySignalsList({
  companyId,
  contactId,
  primaryScope = 'company',
  effectiveReadinessScore,
  crmCappedReason,
  grouped = false,
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

  // Readiness gauge value — the SAME number the Priority tab shows (passed in via
  // effectiveReadinessScore), so the hero ring and the Priority readiness row can't diverge.
  const readinessPct = percentDisplayNumber(effectiveReadinessScore ?? null);
  const entityLabel =
    (contactId
      ? items.find((i) => i.contactName)?.contactName
      : items.find((i) => i.companyName)?.companyName) || (contactId ? 'This contact' : 'This company');
  const readinessForSummary = items.find((i) => i.readiness)?.readiness ?? null;
  const readinessBlurb = buildReadinessSummary({
    entityLabel,
    items,
    readiness: readinessForSummary,
    effectiveScore: effectiveReadinessScore ?? null,
    cappedReason: crmCappedReason ?? null,
  });
  const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const newCount = items.filter((i) => {
    const t = i.observedAt ? new Date(i.observedAt).getTime() : NaN;
    return Number.isFinite(t) && Date.now() - t <= NEW_WINDOW_MS;
  }).length;

  return (
    <div className="space-y-3">
      {/* Hero readiness gauge — same ring as the Fit & Priority tabs so all three read alike. */}
      <div className="flex flex-col items-center rounded-[14px] border border-[rgba(13,53,71,0.06)] bg-[rgba(246,250,250,0.7)] px-4 py-6 text-center">
        <AnimatedCircularProgressBar
          value={readinessPct ?? 0}
          gaugePrimaryColor={fitScoreArcColor(readinessPct)}
          gaugeSecondaryColor="rgba(13,53,71,0.09)"
          animateOnMount
          deferAnimationMs={160}
          label={
            <span className="block text-xl font-semibold leading-snug tabular-nums text-[#0d3547]">
              {readinessPct != null ? readinessPct : '—'}
            </span>
          }
          className="size-24 [--transition-length:0.95s]"
        />
        <p className="mt-3 font-manrope text-[15px] font-bold tracking-[-0.01em] text-[#0d3547]">Readiness score</p>
        {readinessBlurb ? (
          <p className="mt-3 text-[12.5px] leading-[1.55] text-[#1f475a]">
            {newCount > 0 ? (
              <>
                <b className="text-[#0d3547]">
                  {newCount} new signal{newCount !== 1 ? 's' : ''} detected.
                </b>{' '}
                {readinessBlurb}
              </>
            ) : (
              readinessBlurb
            )}
          </p>
        ) : null}
      </div>

      {/* Signal list. `grouped` (side-panel design) takes precedence: all signals
         split into collapsible category cards. Otherwise: Contact/Company split
         when both scopes are shown, else a single flat group. */}
      {grouped ? (
        <GroupedCompanySignals items={items} label={contactId ? 'Signals' : 'Company signals'} />
      ) : (contactId && companyId) ? (() => {
        const contactItems = items.filter((i) => i.contactId === contactId);
        const companyItems = items.filter((i) => !contactItems.includes(i));
        const [firstGroup, secondGroup] = primaryScope === 'contact'
          ? [{ label: 'Contact signals', items: contactItems }, { label: 'Company signals', items: companyItems }]
          : [{ label: 'Company signals', items: companyItems }, { label: 'Contact signals', items: contactItems }];
        return (
          <div className="space-y-4">
            {[firstGroup, secondGroup].map((g) =>
              g.items.length > 0 ? (
                <div key={g.label} className="space-y-2">
                  <SignalGroupHeader label={g.label} count={g.items.length} />
                  {g.items.map((item) => <SignalCard key={item.id} item={item} />)}
                </div>
              ) : null,
            )}
          </div>
        );
      })() : (
        <div className="space-y-2">
          <SignalGroupHeader
            label={contactId && !companyId ? 'Contact signals' : 'Company signals'}
            count={items.length}
          />
          {items.map((item) => (
            <SignalCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
