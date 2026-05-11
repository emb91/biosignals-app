'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { toast } from 'sonner';
import {
  Briefcase,
  Users,
  Building2,
  ExternalLink,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
  Save,
  RefreshCw,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { getSignalDisplayName } from '@/lib/signal-display-names';
import {
  extractFundingStatus,
  formatCurrencyShort,
} from '@/lib/funding-display';
import { resolveCustomerSegments } from '@/lib/split-customer-segments';
import {
  COMPANY_SIGNALS,
  CONTACT_SIGNALS,
  isContactSignalComingSoon,
  type SignalCategory,
  type SignalDefinition,
} from '@/lib/signals/catalog';
import { normalizeOrderedSignalIds } from '@/lib/signals/normalize-client';
import type { CompetitorItem } from '@/components/SetupProfilePanel';
import {
  BUSINESS_AREA_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  MODALITY_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  LI_FOLLOWER_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  canonicalizeFundingStage,
  arrEstimateToBucket,
  fundingAmountDisplayBucket,
} from '@/lib/arcova-taxonomy';

// ── Types ──────────────────────────────────────────────────────────────────

interface ExampleEnrichment {
  company_name?: string | null;
  website?: string | null;
  logo_url?: string | null;
  tagline?: string | null;
  description?: string[] | null;
  products?: string[] | null;
  services?: string[] | null;
  technologies?: string[] | null;
  target_customers?: string[] | null;
  industries?: string[] | null;
  unique_characteristics?: string[] | null;
  business_model?: string[] | null;
  operating_environment?: string[] | null;
  market_summary?: string[] | null;
  customers_we_serve?: string[] | null;
  why_customers_buy?: string[] | null;
  differentiated_value?: string[] | null;
  status_quo?: string[] | null;
  capabilities?: string[] | null;
  challenges_addressed?: string[] | null;
  customer_benefits?: string[] | null;
  good_fit?: string[] | null;
  bad_fit?: string[] | null;
  value_propositions?: string[] | null;
  competitors_enriched?: { name: string; url?: string }[] | null;
  employee_count?: number | null;
  employee_range?: string | null;
  hq_city?: string | null;
  hq_country?: string | null;
  company_status?: string | null;
  funding_status_label?: string | null;
  funding_resolution_summary?: string | null;
  funding_data_source?: 'apollo' | 'web_search' | null;
  company_type?: string | null;
  company_type_display?: string | null;
  platform_category?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
  customer_therapeutic_areas?: string[] | null;
  customer_modalities?: string[] | null;
  customer_development_stages?: string[] | null;
  arr_estimate?: string | null;
  funding_stage?: string | null;
  total_funding_usd?: number | null;
  latest_funding_date?: string | null;
  linkedin_url?: string | null;
  follower_count?: number | null;
}

interface ICP {
  id: string;
  name: string;
  icp_summary?: string | null;
  company_type: string;
  platform_category?: string | null;
  therapeutic_areas: string[];
  modalities: string[];
  development_stages: string[];
  /** Beachhead: customer disease focus (who they sell into) */
  customer_therapeutic_areas?: string[];
  customer_modalities?: string[];
  customer_development_stages?: string[];
  company_sizes: string[];
  li_follower_sizes: string[];
  funding_stages: string[];
  signals: string[];
  example_company_url: string;
  example_company_enrichment?: ExampleEnrichment | null;
  /** First-class ICP segment columns (backfilled from enrichment blob by migration). */
  target_customers?: string[] | null;
  buyer_types?: string[] | null;
  competitors?: { name: string; url?: string }[] | null;
  reenrichment_status?: 'idle' | 'running' | 'succeeded' | 'failed' | null;
  reenrichment_last_error?: string | null;
  reenrichment_started_at?: string | null;
  reenrichment_finished_at?: string | null;
  created_at: string;
  updated_at?: string;
}

interface Persona {
  id: string;
  name: string;
  functions: string[];
  seniority_levels: string[];
  icp_id: string | null;
  job_titles?: string[];
  signals?: string[];
}

// ── Primitive helpers ──────────────────────────────────────────────────────

function Tag({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-arcova-teal/10 border border-arcova-teal/20 px-2.5 py-0.5 text-xs font-medium text-arcova-teal/80">
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-arcova-teal/40 hover:text-arcova-teal transition-colors">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function AddTagSelect({ options, selected, onAdd, placeholder = 'Add…' }: {
  options: string[];
  selected: string[];
  onAdd: (v: string) => void;
  placeholder?: string;
}) {
  const remaining = options.filter((o) => !selected.includes(o));
  if (!remaining.length) return null;
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
      className="mt-1 w-full rounded-lg bg-white/70 border border-arcova-navy/10 px-2 py-1 text-xs text-arcova-navy/50 focus:outline-none focus:border-arcova-teal/50 cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {remaining.map((o) => (
        <option key={o} value={o} className="bg-white text-arcova-navy">{getSignalDisplayName(o, o)}</option>
      ))}
    </select>
  );
}

function FieldRow({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-arcova-navy/80">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t) => <Tag key={t} label={t} />)}
      </div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-arcova-navy/65 leading-snug">
          <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, subValue }: { label: string; value: string; subValue?: string }) {
  return (
    <div>
      <p className="text-xs text-arcova-navy/75">{label}</p>
      <p className="mt-0.5 text-sm text-arcova-navy/70 leading-tight">{value}</p>
      {subValue && <p className="text-xs text-arcova-navy/45 leading-tight">{subValue}</p>}
    </div>
  );
}

/** Collapsible segment — light glass style */
function Segment({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl overflow-hidden transition-colors ${
      open ? 'border border-arcova-navy/8 bg-white/50' : 'bg-white/60 hover:bg-white/80 border border-arcova-navy/8'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
      >
        <span className="text-xs font-semibold text-arcova-navy/80">{label}</span>
        {open
          ? <ChevronUp className="h-3 w-3 text-arcova-navy/45 shrink-0" />
          : <ChevronDown className="h-3 w-3 text-arcova-navy/45 shrink-0" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function parseFunctionName(f: string): string {
  try { return (JSON.parse(f) as { name?: string }).name ?? f; } catch { return f; }
}

function isSaasCompanyType(value?: string | null): boolean {
  return (value ?? '').trim() === 'SaaS';
}

function visiblePlatformCategory(companyType?: string | null, platformCategory?: string | null): string {
  return isSaasCompanyType(companyType) ? (platformCategory ?? '').trim() : '';
}

function normalizeReenrichmentStatus(status?: ICP['reenrichment_status']): 'idle' | 'running' | 'succeeded' | 'failed' {
  return status === 'running' || status === 'succeeded' || status === 'failed' ? status : 'idle';
}

function reenrichmentStatusMeta(status: ReturnType<typeof normalizeReenrichmentStatus>): {
  label: string;
  className: string;
} | null {
  if (status === 'running') {
    return {
      label: 'Running',
      className: 'border-arcova-teal/30 bg-arcova-teal/10 text-arcova-teal',
    };
  }

  if (status === 'succeeded') {
    return {
      label: 'Done',
      className: 'border-emerald-500/30 bg-emerald-50 text-emerald-700',
    };
  }

  if (status === 'failed') {
    return {
      label: 'Failed',
      className: 'border-red-400/30 bg-red-50 text-red-600',
    };
  }

  return null;
}

/** One line from persisted ICP fields only — used when `icp_summary` is empty (never reference-company enrichment). */
function segmentSummaryFallbackFromIcp(icp: ICP): string {
  const parts: string[] = [];
  if (icp.company_type?.trim()) parts.push(icp.company_type.trim());
  if (visiblePlatformCategory(icp.company_type, icp.platform_category)) {
    parts.push(visiblePlatformCategory(icp.company_type, icp.platform_category));
  }
  const diseaseMod = [...icp.therapeutic_areas, ...icp.modalities].filter(Boolean);
  if (diseaseMod.length > 0) parts.push(diseaseMod.join(', '));
  if (icp.development_stages.length > 0) parts.push(icp.development_stages.join(', '));
  if (icp.company_sizes.length > 0) parts.push(icp.company_sizes.join(', '));
  if (icp.funding_stages.length > 0) parts.push(icp.funding_stages.join(', '));
  return parts.length > 0 ? parts.join(' · ') : '';
}

function simplifyFundingStatusForIcp(value?: string | null): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  if (
    lower.includes('public') ||
    lower.includes('nasdaq') ||
    lower.includes('nyse') ||
    lower.includes('listed on') ||
    lower.includes('stock exchange') ||
    lower.includes('lse') ||
    lower.includes('aex')
  ) {
    return 'Public';
  }
  if (lower.includes('grant')) return 'Grant-funded';
  if (lower.includes('non-profit') || lower.includes('nonprofit') || lower.includes('donation') || lower.includes('grassroots') || lower.includes('community-funded')) return 'Non-profit';
  if (
    lower.includes('private') ||
    lower.includes('venture') ||
    lower.includes('vc') ||
    lower.includes('angel') ||
    lower.includes('bootstrapped') ||
    lower.includes('series') ||
    lower.includes('seed') ||
    lower.includes('growth')
  ) {
    return 'Private';
  }

  return null;
}

const COMPANY_SIGNAL_CATEGORY_ORDER: SignalCategory[] = [
  'Funding & Financial',
  'Pipeline & Clinical',
  'Hiring & Team',
  'Corporate & Strategic',
  'First-Party Engagement',
  'CRM & Relationship',
];

const CONTACT_SIGNAL_CATEGORY_ORDER: SignalCategory[] = [
  'Career & Role Changes',
  'Activity & Network',
  'Publications & Recognition',
  'Hiring & Team',
  'First-Party Engagement',
  'CRM & Relationship',
];

/** In read-only summary, these categories always list every signal (muted) so integration-style signals stay visible. */
const SUMMARY_CATEGORIES_ALWAYS_SHOW_UNSELECTED = new Set<SignalCategory>([
  'First-Party Engagement',
  'CRM & Relationship',
]);

function SignalCatalogByCategory({
  definitions,
  categoryOrder,
  selectedIds,
  readOnly,
  onToggle,
  variant = 'all',
  isManagedServiceSignal,
  onManagedServiceSignalClick,
}: {
  definitions: SignalDefinition[];
  categoryOrder: SignalCategory[];
  selectedIds: readonly string[];
  readOnly: boolean;
  onToggle?: (id: string) => void;
  /** `all`: every catalog signal (edit). `selectedOnly`: only chosen signals (read-only summary). */
  variant?: 'all' | 'selectedOnly';
  /** When set, these signals never show as selected; clicks call `onManagedServiceSignalClick` instead of `onToggle`. */
  isManagedServiceSignal?: (signalId: string) => boolean;
  onManagedServiceSignalClick?: (signalId: string) => void;
}) {
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-3">
      {categoryOrder.map((category) => {
        let inCat = definitions.filter((s) => s.category === category);
        if (variant === 'selectedOnly') {
          const alwaysMuted = readOnly && SUMMARY_CATEGORIES_ALWAYS_SHOW_UNSELECTED.has(category);
          if (!alwaysMuted) {
            inCat = inCat.filter((s) => selected.has(s.id));
          }
        }
        if (!inCat.length) return null;
        return (
          <div key={category}>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-arcova-navy/40">
              {category}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {inCat.map((signal) => {
                const forceUnselected =
                  variant === 'selectedOnly' &&
                  readOnly &&
                  SUMMARY_CATEGORIES_ALWAYS_SHOW_UNSELECTED.has(category);
                const managed = Boolean(isManagedServiceSignal?.(signal.id));
                const isOn = !forceUnselected && !managed && selected.has(signal.id);
                const label = getSignalDisplayName(signal.id, signal.displayName);
                const pillBase =
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors';
                const pillState = isOn
                  ? 'border-arcova-teal/50 bg-arcova-teal/15 text-arcova-teal'
                  : 'border-arcova-navy/15 bg-arcova-navy/5 text-arcova-navy/55';
                if (!readOnly && managed && onManagedServiceSignalClick) {
                  return (
                    <button
                      key={signal.id}
                      type="button"
                      onClick={() => onManagedServiceSignalClick(signal.id)}
                      className={`${pillBase} ${pillState} hover:border-arcova-navy/25 hover:bg-arcova-navy/8 hover:text-arcova-navy/75`}
                    >
                      {label}
                    </button>
                  );
                }
                if (!readOnly && onToggle) {
                  return (
                    <button
                      key={signal.id}
                      type="button"
                      onClick={() => onToggle(signal.id)}
                      className={`${pillBase} ${pillState} ${
                        isOn
                          ? 'hover:bg-arcova-teal/20'
                          : 'hover:border-arcova-navy/25 hover:bg-arcova-navy/8 hover:text-arcova-navy/75'
                      }`}
                    >
                      {label}
                    </button>
                  );
                }
                return (
                  <span
                    key={signal.id}
                    className={`${pillBase} ${pillState}`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Inline edit: removable tags + add dropdown ────────────────────────────

function EditTagField({
  label,
  options,
  selected,
  onRemove,
  onAdd,
  placeholder = 'Add…',
  hideLabel = false,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onRemove: (v: string) => void;
  onAdd: (v: string) => void;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  return (
    <div>
      {!hideLabel && (
        <p className="mb-1.5 text-xs text-arcova-navy/75">{label}</p>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selected.map((v) => (
            <Tag key={v} label={label.toLowerCase().includes('signal') ? getSignalDisplayName(v) : v} onRemove={() => onRemove(v)} />
          ))}
        </div>
      )}
      <AddTagSelect options={[...options]} selected={selected} onAdd={onAdd} placeholder={placeholder} />
    </div>
  );
}

function EditFreeformTagField({
  label,
  selected,
  onRemove,
  onAdd,
  placeholder = 'Add…',
  hideLabel = false,
}: {
  label: string;
  selected: string[];
  onRemove: (v: string) => void;
  onAdd: (v: string) => void;
  placeholder?: string;
  hideLabel?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const addItem = () => {
    const next = draft.trim();
    if (!next) return;
    const exists = selected.some((value) => value.trim().toLowerCase() === next.toLowerCase());
    if (exists) {
      setDraft('');
      return;
    }
    onAdd(next);
    setDraft('');
  };

  return (
    <div>
      {!hideLabel && (
        <p className="mb-1.5 text-xs text-arcova-navy/75">{label}</p>
      )}
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selected.map((value) => (
            <Tag key={value} label={value} onRemove={() => onRemove(value)} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addItem();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-arcova-navy/10 bg-white/60 px-2 py-1 text-xs text-arcova-navy/80 placeholder:text-arcova-navy/30 focus:border-arcova-teal/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={addItem}
          className="shrink-0 rounded-lg border border-arcova-navy/10 px-2.5 py-1 text-xs font-medium text-arcova-navy/55 transition-colors hover:bg-arcova-navy/5 hover:text-arcova-navy"
        >
          Add
        </button>
      </div>
    </div>
  );
}

type IcpCardSegmentOpen = {
  companySignals: boolean;
  contactSignals: boolean;
  criteria: boolean;
  funding: boolean;
  sellToCompanies: boolean;
  competitors: boolean;
  functions: boolean;
  seniority: boolean;
};

function defaultIcpCardSegmentOpen(): IcpCardSegmentOpen {
  return {
    companySignals: false,
    contactSignals: false,
    criteria: false,
    funding: false,
    sellToCompanies: false,
    competitors: false,
    functions: false,
    seniority: false,
  };
}

// ── Combined ICP + buying team card ───────────────────────────────────────

function ICPCard({
  icp,
  index,
  persona,
  collapsed,
  onToggle,
  onDelete,
  onSaved,
  deleting,
  reenriching,
  onPersonaUpdate,
  onPersonaDelete,
  onAddBuyingTeam,
  onReenrich,
}: {
  icp: ICP;
  index: number;
  persona: Persona | null;
  collapsed: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSaved: (updated: ICP) => void;
  deleting: boolean;
  reenriching: boolean;
  onPersonaUpdate: (p: Persona) => void;
  onPersonaDelete: (id: string) => void;
  onAddBuyingTeam: () => void;
  onReenrich: () => void;
}) {
  const e = icp.example_company_enrichment;
  const domain = e?.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const linkedInDisplay = e?.linkedin_url?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const functions = persona?.functions?.map(parseFunctionName) ?? [];
  const seniority = persona?.seniority_levels ?? [];
  const referenceCustomerSegments = resolveCustomerSegments({
    targetCustomers: e?.target_customers ?? [],
    customersWeServe: e?.customers_we_serve ?? [],
    fallbackItems: e?.customers_we_serve ?? [],
  });
  const icpCustomerSegments = (icp.target_customers?.length || icp.buyer_types?.length)
    ? { customerOrganizations: icp.target_customers ?? [], buyerTypes: icp.buyer_types ?? [] }
    : resolveCustomerSegments({
        targetCustomers: e?.target_customers ?? [],
        customersWeServe: e?.customers_we_serve ?? [],
        fallbackItems: e?.customers_we_serve ?? [],
      });
  const displayCompetitors = icp.competitors?.length
    ? icp.competitors
    : (e?.competitors_enriched ?? []);
  const referenceSummary = (e?.description?.[0] ?? '').trim();
  const icpSummaryStored = (icp.icp_summary ?? '').trim();
  /** Stored sentence first; otherwise taxonomy-only (not reference-account description). */
  const icpProfileSummaryDisplay = icpSummaryStored || segmentSummaryFallbackFromIcp(icp);
  const referenceAccountLabel = e?.company_name?.trim() || 'Reference account';
  const modelledOnFundingStatus =
    (e?.funding_status_label ?? '').trim() || (e?.company_status ? extractFundingStatus(e.company_status) : null);
  const modelledOnFundingSummary =
    (e?.funding_resolution_summary ?? e?.company_status ?? '').trim() || null;
  const icpFundingStatus =
    simplifyFundingStatusForIcp(e?.funding_status_label) ??
    simplifyFundingStatusForIcp(e?.company_status) ??
    null;
  const icpSignalIds = normalizeOrderedSignalIds(icp.signals);
  const personaSignalIds = normalizeOrderedSignalIds(persona?.signals ?? []);

  const hasModelledOnNarrative = Boolean(
    e?.description?.[0] ||
    (e?.customers_we_serve?.length ?? 0) > 0 ||
    (e?.value_propositions?.length ?? 0) > 0 ||
    e?.follower_count != null ||
    e?.linkedin_url
  );

  const hasFirmographics = !!(
    e?.employee_count != null ||
    e?.employee_range ||
    e?.hq_city ||
    e?.follower_count != null ||
    e?.company_status ||
    e?.funding_status_label ||
    e?.total_funding_usd != null ||
    e?.funding_stage
  );
  const currentReenrichmentStatus = normalizeReenrichmentStatus(icp.reenrichment_status);
  const currentReenrichmentMeta = reenrichmentStatusMeta(currentReenrichmentStatus);

  const [open, setOpen] = useState<IcpCardSegmentOpen>(defaultIcpCardSegmentOpen);
  const [modelledOnMode, setModelledOnMode] = useState(false);
  const prevCollapsedRef = useRef(collapsed);

  useEffect(() => {
    if (prevCollapsedRef.current && !collapsed) {
      setOpen(defaultIcpCardSegmentOpen());
      setModelledOnMode(false);
    }
    prevCollapsedRef.current = collapsed;
  }, [collapsed]);

  const toggle = (key: keyof IcpCardSegmentOpen) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Unified edit state (covers both criteria and buying team) ────────────
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({
    name: icp.name,
    company_type: icp.company_type,
    platform_category: icp.platform_category ?? '',
    therapeutic_areas: [...icp.therapeutic_areas],
    modalities: [...icp.modalities],
    development_stages: [...icp.development_stages],
    customer_therapeutic_areas: [...(icp.customer_therapeutic_areas ?? [])],
    customer_modalities: [...(icp.customer_modalities ?? [])],
    customer_development_stages: [...(icp.customer_development_stages ?? [])],
    company_sizes: [...icp.company_sizes],
    li_follower_sizes: [...(icp.li_follower_sizes ?? [])],
    funding_stages: [...icp.funding_stages],
    signals: normalizeOrderedSignalIds(icp.signals ?? []),
  });
  const [editFunctions, setEditFunctions] = useState<string[]>([]);
  const [editSeniority, setEditSeniority] = useState<string[]>([]);
  const [editPersonaSignals, setEditPersonaSignals] = useState<string[]>([]);
  const [editCompetitors, setEditCompetitors] = useState<CompetitorItem[]>([]);
  const [editTargetCustomers, setEditTargetCustomers] = useState<string[]>([]);
  const [editBuyerTypes, setEditBuyerTypes] = useState<string[]>([]);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [regeneratingName, setRegeneratingName] = useState(false);


  const resolvedSegments = () => {
    // Prefer first-class columns (post-migration); fall back to blob for old rows.
    if (icp.target_customers?.length || icp.buyer_types?.length) {
      return { customerOrganizations: icp.target_customers ?? [], buyerTypes: icp.buyer_types ?? [] };
    }
    return resolveCustomerSegments({
      targetCustomers: icp.example_company_enrichment?.target_customers ?? [],
      customersWeServe: icp.example_company_enrichment?.customers_we_serve ?? [],
      fallbackItems: icp.example_company_enrichment?.customers_we_serve ?? [],
    });
  };

  const resolvedCompetitors = () =>
    icp.competitors?.length
      ? icp.competitors
      : (icp.example_company_enrichment?.competitors_enriched ?? []);

  const startEdit = () => {
    const segs = resolvedSegments();
    setEditData({
      name: icp.name,
      company_type: icp.company_type,
      platform_category: icp.platform_category ?? '',
      therapeutic_areas: [...icp.therapeutic_areas],
      modalities: [...icp.modalities],
      development_stages: [...icp.development_stages],
      customer_therapeutic_areas: [...(icp.customer_therapeutic_areas ?? [])],
      customer_modalities: [...(icp.customer_modalities ?? [])],
      customer_development_stages: [...(icp.customer_development_stages ?? [])],
      company_sizes: [...icp.company_sizes],
      li_follower_sizes: [...(icp.li_follower_sizes ?? [])],
      funding_stages: [...icp.funding_stages],
      signals: normalizeOrderedSignalIds(icp.signals ?? []),
    });
    setEditFunctions([...functions]);
    setEditSeniority([...seniority]);
    setEditPersonaSignals(
      normalizeOrderedSignalIds(persona?.signals ?? []).filter((id) => !isContactSignalComingSoon(id)),
    );
    setEditCompetitors([...resolvedCompetitors()]);
    setEditTargetCustomers([...segs.customerOrganizations]);
    setEditBuyerTypes([...segs.buyerTypes]);
    setNewCompetitorUrl('');
    setModelledOnMode(false);
    setEditMode(true);
    if (collapsed) onToggle();
  };

  const cancelEdit = () => {
    const segs = resolvedSegments();
    setEditFunctions([...functions]);
    setEditSeniority([...seniority]);
    setEditPersonaSignals(
      normalizeOrderedSignalIds(persona?.signals ?? []).filter((id) => !isContactSignalComingSoon(id)),
    );
    setEditCompetitors([...resolvedCompetitors()]);
    setEditTargetCustomers([...segs.customerOrganizations]);
    setEditBuyerTypes([...segs.buyerTypes]);
    setNewCompetitorUrl('');
    setEditMode(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const summaryRes = await fetch('/api/generate-icp-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyType: editData.company_type,
          platformCategory: visiblePlatformCategory(editData.company_type, editData.platform_category),
          therapeuticAreas: editData.therapeutic_areas,
          modalities: editData.modalities,
          developmentStages: editData.development_stages,
          customerTherapeuticAreas: editData.customer_therapeutic_areas,
          customerModalities: editData.customer_modalities,
          customerDevelopmentStages: editData.customer_development_stages,
          companySizes: editData.company_sizes,
          fundingStages: editData.funding_stages,
          exampleCompanyName: icp.example_company_enrichment?.company_name ?? null,
          exampleCompanyDescription: icp.example_company_enrichment?.description ?? null,
        }),
      }).catch(() => null);
      const { summary: icpSummary } = summaryRes?.ok
        ? await summaryRes.json() as { summary: string }
        : { summary: icp.icp_summary ?? null as string | null };

      const icpRes = await fetch(`/api/company-criteria/${icp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editData.name,
          icpSummary,
          companyType: editData.company_type,
          platformCategory: visiblePlatformCategory(editData.company_type, editData.platform_category),
          therapeuticAreas: editData.therapeutic_areas,
          modalities: editData.modalities,
          developmentStages: editData.development_stages,
          customerTherapeuticAreas: editData.customer_therapeutic_areas,
          customerModalities: editData.customer_modalities,
          customerDevelopmentStages: editData.customer_development_stages,
          companySizes: editData.company_sizes,
          liFollowerSizes: editData.li_follower_sizes,
          fundingStages: editData.funding_stages,
          signals: editData.signals,
          exampleCompanies: [],
          exampleCompanyUrl: icp.example_company_url,
          exampleCompanyEnrichment: icp.example_company_enrichment ?? null,
          targetCustomers: editTargetCustomers,
          buyerTypes: editBuyerTypes,
          competitors: editCompetitors,
        }),
      });

      if (!icpRes.ok) {
        const errorPayload = await icpRes.json().catch(() => null) as { error?: string } | null;
        const message = errorPayload?.error ?? 'Failed to save ICP';
        toast.error(message);
        return;
      }

      const result = await icpRes.json();
      onSaved(result.data ?? { ...icp, ...editData });

      if (persona) {
        const teamRes = await fetch(`/api/contacts/${persona.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: persona.name,
            functions: editFunctions,
            seniorityLevels: editSeniority,
            jobTitles: persona.job_titles ?? [],
            signals: editPersonaSignals,
          }),
        });
        if (teamRes.ok) {
          const { data } = await teamRes.json();
          onPersonaUpdate(data);
        }
      }

      setEditMode(false);
      toast.success('Saved');
    } finally {
      setSaving(false);
    }
  };

  const regenerateName = async () => {
    setRegeneratingName(true);
    try {
      const response = await fetch('/api/generate-icp-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyType: editData.company_type,
          platformCategory: visiblePlatformCategory(editData.company_type, editData.platform_category),
          therapeuticAreas: editData.therapeutic_areas,
          modalities: editData.modalities,
          developmentStages: editData.development_stages,
          customerTherapeuticAreas: editData.customer_therapeutic_areas,
          customerModalities: editData.customer_modalities,
          customerDevelopmentStages: editData.customer_development_stages,
          companySizes: editData.company_sizes,
          fundingStages: editData.funding_stages,
          exampleCompanyName: icp.example_company_enrichment?.company_name ?? null,
          exampleCompanyDescription: icp.example_company_enrichment?.description ?? null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to regenerate ICP name');
      }

      const result = await response.json() as { name?: string };
      if (result.name?.trim()) {
        setEditData((prev) => ({ ...prev, name: result.name!.trim() }));
        toast.success('Title regenerated');
      }
    } catch (error) {
      console.error('Failed to regenerate ICP name:', error);
      toast.error('Failed to regenerate title');
    } finally {
      setRegeneratingName(false);
    }
  };

  const toggleMulti = (field: keyof typeof editData, value: string) =>
    setEditData((prev) => {
      const arr = prev[field] as string[];
      return { ...prev, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });

  const setSingle = (field: keyof typeof editData, value: string) =>
    setEditData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="rounded-2xl border border-arcova-navy/10 bg-white/75 backdrop-blur-xl shadow-arcova">

      {/* Card header */}
      <div className={`flex items-center gap-2.5 px-4 py-3 ${!collapsed ? 'border-b border-arcova-navy/8' : ''}`}>
        {editMode ? (
          <>
            <Briefcase className="h-4 w-4 shrink-0 text-arcova-teal" />
            <div className="flex flex-1 min-w-0 items-center gap-2">
              <input
                value={editData.name}
                onChange={(e) => setEditData((prev) => ({ ...prev, name: e.target.value }))}
                className="flex-1 min-w-0 rounded-lg bg-white/80 border border-arcova-navy/15 px-2.5 py-1 text-sm font-semibold text-arcova-navy placeholder-arcova-navy/30 focus:outline-none focus:border-arcova-teal/60"
                placeholder="Profile name"
              />
              <button
                type="button"
                onClick={() => void regenerateName()}
                disabled={regeneratingName}
                className="shrink-0 rounded-lg border border-arcova-navy/10 px-2.5 py-1 text-xs font-medium text-arcova-navy/60 transition-colors hover:bg-arcova-navy/5 hover:text-arcova-navy disabled:opacity-50"
              >
                {regeneratingName ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              className="flex flex-1 items-center gap-2.5 text-left min-w-0"
            >
              <Briefcase className="h-4 w-4 shrink-0 text-arcova-teal" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="block min-w-0 truncate text-sm font-semibold text-arcova-navy">
                    ICP {index}: {icp.name || 'ICP Profile'}
                  </span>
                  {currentReenrichmentMeta && (
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${currentReenrichmentMeta.className}`}>
                      {currentReenrichmentMeta.label}
                    </span>
                  )}
                </div>
                {collapsed && (
                  <span className="block text-xs text-arcova-navy/40 truncate">
                    {[
                      e?.company_name?.trim() ? `Modelled on ${e.company_name.trim()}` : null,
                      relativeTime(icp.updated_at) ? `Updated ${relativeTime(icp.updated_at)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              {collapsed
                ? <ChevronDown className="h-4 w-4 text-arcova-navy/35 shrink-0" />
                : <ChevronUp className="h-4 w-4 text-arcova-navy/35 shrink-0" />}
            </button>
          </>
        )}
      </div>


      {/* Modelled-on full-panel view */}
      {!collapsed && modelledOnMode && e && (
        <div className="px-4 py-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {e.website ? (
                <a href={e.website} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-arcova-navy hover:underline leading-tight">
                  {e.company_name}<ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                </a>
              ) : (
                <p className="text-sm font-semibold text-arcova-navy leading-tight">{e.company_name}</p>
              )}
              <div className="flex flex-col gap-0.5 mt-0.5">
                {linkedInDisplay && (
                  <a href={e.linkedin_url!} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline">
                    {linkedInDisplay}<ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                )}
              </div>
            </div>
            {e.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.logo_url} alt={e.company_name ?? ''} className="h-20 w-20 shrink-0 rounded-xl object-contain bg-arcova-navy/5 p-1 border border-arcova-navy/8" />
            ) : (
              <div className="h-20 w-20 shrink-0 rounded-xl bg-arcova-navy/5 border border-arcova-navy/8 flex items-center justify-center">
                <Building2 className="h-9 w-9 text-arcova-navy/25" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div className="space-y-5">
              {referenceSummary.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-arcova-navy/80 mb-2">About {referenceAccountLabel}</p>
                  <p className="text-xs text-arcova-navy/65 leading-snug">{referenceSummary}</p>
                </div>
              )}
              {(e.employee_count != null || e.employee_range || e.hq_city || e.follower_count != null) && (
                <div>
                  <p className="text-xs font-semibold text-arcova-navy/80 mb-2">Firmographics</p>
                  <div className="space-y-1">
                    {(e.employee_count != null || e.employee_range) && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">Employees</span>
                        <span className="text-xs text-arcova-navy">
                          {e.employee_count != null ? e.employee_count.toLocaleString() : e.employee_range}
                          {e.employee_count != null && e.employee_range ? ` (${e.employee_range})` : ''}
                        </span>
                      </div>
                    )}
                    {e.hq_city && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">HQ</span>
                        <span className="text-xs text-arcova-navy">{e.hq_city}{e.hq_country ? `, ${e.hq_country}` : ''}</span>
                      </div>
                    )}
                    {e.follower_count != null && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">LinkedIn</span>
                        <span className="text-xs text-arcova-navy">{e.follower_count.toLocaleString()} followers</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(modelledOnFundingStatus || modelledOnFundingSummary || e.funding_stage || e.total_funding_usd != null || e.arr_estimate) && (
                <div>
                  <p className="text-xs font-semibold text-arcova-navy/80 mb-2">Funding</p>
                  <div className="space-y-1">
                    {modelledOnFundingStatus && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">Status</span>
                        <span className="text-xs text-arcova-navy">{modelledOnFundingStatus}</span>
                      </div>
                    )}
                    {e.funding_stage && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">Stage</span>
                        <span className="text-xs text-arcova-navy">{e.funding_stage}</span>
                      </div>
                    )}
                    {e.total_funding_usd != null && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">Total raised</span>
                        <span className="text-xs text-arcova-navy">{formatCurrencyShort(e.total_funding_usd)}</span>
                      </div>
                    )}
                    {e.arr_estimate && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs text-arcova-navy/45 w-28 shrink-0">ARR</span>
                        <span className="text-xs text-arcova-navy">{e.arr_estimate}</span>
                      </div>
                    )}
                  </div>
                  {modelledOnFundingSummary && (
                    <div className="mt-2">
                      <p className="text-xs text-arcova-navy/35 mb-1">Funding summary</p>
                      <p className="text-xs leading-snug text-arcova-navy/50">{modelledOnFundingSummary}</p>
                    </div>
                  )}
                </div>
              )}
              <FieldRow label="Sells to companies like" items={referenceCustomerSegments.customerOrganizations} />
              <FieldRow label="Sells to people like" items={referenceCustomerSegments.buyerTypes} />
              {(e.competitors_enriched?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-arcova-navy/80">Competitors</p>
                  <div className="flex flex-wrap gap-1.5">
                    {e.competitors_enriched!.map((c, i) => {
                      const href = c.url?.trim() || `https://www.google.com/search?q=${encodeURIComponent(c.name)}`;
                      return (
                        <a key={`${c.name}-${i}`} href={href} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 rounded-full bg-arcova-teal/10 border border-arcova-teal/20 px-2.5 py-0.5 text-xs font-medium text-arcova-teal hover:underline">
                          <span className="truncate max-w-[14rem]">{c.name}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-5">
              {(e.products?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-arcova-navy/80">Products</p>
                  <div className="flex flex-wrap gap-1.5">
                    {e.products!.map((p, i) => (
                      <span key={i} className="rounded-full bg-arcova-navy/5 border border-arcova-navy/10 px-2.5 py-0.5 text-xs text-arcova-navy/70">{p}</span>
                    ))}
                  </div>
                </div>
              )}
              {(e.services?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-arcova-navy/80">Services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {e.services!.map((s, i) => (
                      <span key={i} className="rounded-full bg-arcova-navy/5 border border-arcova-navy/10 px-2.5 py-0.5 text-xs text-arcova-navy/70">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {(e.technologies?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-arcova-navy/80">Technology</p>
                  <div className="flex flex-wrap gap-1.5">
                    {e.technologies!.map((t, i) => (
                      <span key={i} className="rounded-full bg-arcova-navy/5 border border-arcova-navy/10 px-2.5 py-0.5 text-xs text-arcova-navy/70">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Two-column body + full-width signals (above footer) */}
      {!collapsed && !modelledOnMode && (
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 divide-x divide-arcova-navy/8">

        {/* Left column — firmographics */}
        <div className="flex-1 min-w-0 px-4 py-4 space-y-2">

          {!editMode && currentReenrichmentStatus === 'running' && (
            <div className="rounded-xl border border-arcova-teal/30 bg-arcova-teal/10 px-3 py-3 text-xs text-arcova-teal">
              Re-enrichment is running in the background. You can leave this page and come back later.
            </div>
          )}

          {!editMode && currentReenrichmentStatus === 'failed' && icp.reenrichment_last_error?.trim() && (
            <div className="rounded-xl border border-red-400/30 bg-red-50 px-3 py-3 text-xs text-red-700">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-red-800">Latest re-enrichment failed</p>
                  <p className="mt-1 leading-snug text-red-700/80">{icp.reenrichment_last_error.trim()}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5 pb-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-arcova-teal" />
            <p className="flex-1 text-sm font-semibold text-arcova-navy">Company criteria</p>
          </div>

          <Segment label="Summary" open={open.criteria} onToggle={() => toggle('criteria')}>
            {icpProfileSummaryDisplay.length > 0 && (
              <div className="pb-3 mb-3 border-b border-arcova-navy/8">
                <p className="text-xs text-arcova-navy/65 leading-snug">{icpProfileSummaryDisplay}</p>
              </div>
            )}
            {editMode ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-arcova-navy/80">Company type</p>
                  {editData.company_type ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Tag label={editData.company_type} onRemove={() => setSingle('company_type', '')} />
                    </div>
                  ) : (
                    <select
                      value=""
                      onChange={(e) => { if (e.target.value) setSingle('company_type', e.target.value); }}
                      className="w-full rounded-lg bg-white/70 border border-arcova-navy/10 px-2 py-1 text-xs text-arcova-navy/50 focus:outline-none focus:border-arcova-teal/50 cursor-pointer"
                    >
                      <option value="">Set type…</option>
                      {COMPANY_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="bg-white text-arcova-navy">{opt.value}</option>
                      ))}
                    </select>
                  )}
                </div>
                {isSaasCompanyType(editData.company_type) && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-arcova-navy/80">Platform category</p>
                    <input
                      type="text"
                      value={editData.platform_category}
                      onChange={(e) => setSingle('platform_category', e.target.value)}
                      placeholder="e.g. Scientific Content Platform"
                      maxLength={48}
                      className="w-full rounded-lg bg-white/70 border border-arcova-navy/10 px-2 py-1 text-xs text-arcova-navy/80 focus:outline-none focus:border-arcova-teal/50 placeholder:text-arcova-navy/30"
                    />
                  </div>
                )}
                <EditTagField label="Therapeutic areas" options={THERAPEUTIC_AREA_OPTIONS} selected={editData.therapeutic_areas} onRemove={(v) => toggleMulti('therapeutic_areas', v)} onAdd={(v) => toggleMulti('therapeutic_areas', v)} />
                <EditTagField label="Modalities" options={MODALITY_OPTIONS} selected={editData.modalities} onRemove={(v) => toggleMulti('modalities', v)} onAdd={(v) => toggleMulti('modalities', v)} />
                <EditTagField label="Development stage" options={DEVELOPMENT_STAGE_OPTIONS} selected={editData.development_stages} onRemove={(v) => toggleMulti('development_stages', v)} onAdd={(v) => toggleMulti('development_stages', v)} />
                <EditTagField label="Company size" options={COMPANY_SIZE_OPTIONS} selected={editData.company_sizes} onRemove={(v) => toggleMulti('company_sizes', v)} onAdd={(v) => toggleMulti('company_sizes', v)} />
                <EditTagField label="LinkedIn follower base" options={LI_FOLLOWER_OPTIONS} selected={editData.li_follower_sizes} onRemove={(v) => toggleMulti('li_follower_sizes', v)} onAdd={(v) => toggleMulti('li_follower_sizes', v)} />
                <EditTagField label="Funding stage" options={FUNDING_STAGE_OPTIONS} selected={editData.funding_stages} onRemove={(v) => toggleMulti('funding_stages', v)} onAdd={(v) => toggleMulti('funding_stages', v)} />
              </div>
            ) : (() => {
              const hasTaxonomy = icp.company_type || visiblePlatformCategory(icp.company_type, icp.platform_category) || icp.therapeutic_areas.length > 0 || icp.modalities.length > 0 || icp.development_stages.length > 0;
              const hasSizing = icp.company_sizes.length > 0 || (icp.li_follower_sizes?.length ?? 0) > 0;
              if (!hasTaxonomy && !hasSizing) {
                return (
                  <p className="text-xs text-arcova-navy/40 italic">
                    No criteria set — this ICP will match any company type, size, or stage. Click Edit to add filters.
                  </p>
                );
              }
              return (
                <>
                  {hasTaxonomy && (
                    <div className="space-y-2.5">
                      {icp.company_type && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-arcova-navy/80">Company type</p>
                          <Tag label={icp.company_type} />
                        </div>
                      )}
                      {visiblePlatformCategory(icp.company_type, icp.platform_category) && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-arcova-navy/80">Platform category</p>
                          <Tag label={visiblePlatformCategory(icp.company_type, icp.platform_category)} />
                        </div>
                      )}
                      <FieldRow label="Therapeutic areas" items={icp.therapeutic_areas} />
                      <FieldRow label="Modalities" items={icp.modalities} />
                      <FieldRow label="Development stage" items={icp.development_stages} />
                    </div>
                  )}
                  {hasSizing && (
                    <div className="space-y-2.5">
                      {icp.company_sizes.length > 0 && <FieldRow label="Company size" items={icp.company_sizes} />}
                      {(icp.li_follower_sizes?.length ?? 0) > 0 && (
                        <FieldRow label="LinkedIn follower base" items={icp.li_follower_sizes ?? []} />
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </Segment>

          {!editMode && (() => {
            const derivedStage = canonicalizeFundingStage(
              e?.funding_stage,
              e?.total_funding_usd,
              e?.company_status ?? e?.funding_status_label ?? null,
            );
            const fundingStages = icp.funding_stages.length > 0
              ? icp.funding_stages
              : derivedStage ? [derivedStage] : [];
            // Dollar bucket from the reference account's total funding amount
            const fundingBucket = fundingAmountDisplayBucket(e?.total_funding_usd);
            // Only show generic ownership status (e.g. "Public", "Grant-funded") when
            // there's no named stage already — avoids the redundant "Private" tag
            // appearing alongside "Series C" + a dollar bucket.
            const fundingStatus = fundingStages.length === 0 ? icpFundingStatus : null;
            const arrBucket = arrEstimateToBucket(e?.arr_estimate);
            const hasFunding = fundingStages.length > 0 || fundingBucket || fundingStatus || arrBucket;
            if (!hasFunding) return null;
            return (
              <Segment label="Funding" open={open.funding} onToggle={() => toggle('funding')}>
                <div className="flex flex-wrap gap-1.5">
                  {fundingStages.map((s) => <Tag key={s} label={s} />)}
                  {fundingBucket && <Tag label={fundingBucket} />}
                  {fundingStatus && <Tag label={fundingStatus} />}
                  {arrBucket && <Tag label={arrBucket} />}
                </div>
              </Segment>
            );
          })()}

          {!editMode && icpCustomerSegments.customerOrganizations.length > 0 && (
            <Segment
              label="Sells to companies like"
              open={open.sellToCompanies}
              onToggle={() => toggle('sellToCompanies')}
            >
              <div className="flex flex-wrap gap-1.5">
                {icpCustomerSegments.customerOrganizations.map((item) => (
                  <Tag key={item} label={item} />
                ))}
              </div>
            </Segment>
          )}

          {editMode && (
            <Segment
              label="Sells to companies like"
              open={open.sellToCompanies}
              onToggle={() => toggle('sellToCompanies')}
            >
              <EditFreeformTagField
                hideLabel
                label="Sells to companies like"
                selected={editTargetCustomers}
                onRemove={(value) => setEditTargetCustomers((prev) => prev.filter((item) => item !== value))}
                onAdd={(value) => setEditTargetCustomers((prev) => [...prev, value])}
                placeholder="Add company segment…"
              />
            </Segment>
          )}

          {!editMode && displayCompetitors.length > 0 && (
            <Segment label="Competitors" open={open.competitors} onToggle={() => toggle('competitors')}>
              <div className="flex flex-wrap gap-1.5">
                {displayCompetitors.map((c, i) => {
                  const href = c.url?.trim() || `https://www.google.com/search?q=${encodeURIComponent(c.name)}`;
                  return (
                    <a
                      key={`${c.name}-${i}`}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 rounded-full bg-arcova-teal/10 border border-arcova-teal/20 px-2.5 py-0.5 text-xs font-medium text-arcova-teal hover:underline"
                    >
                      <span className="truncate max-w-[14rem]">{c.name}</span>
                      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                    </a>
                  );
                })}
              </div>
            </Segment>
          )}

          {editMode && (
            <Segment label="Competitors" open={open.competitors} onToggle={() => toggle('competitors')}>
              <div className="flex flex-wrap gap-1.5">
                {editCompetitors.map((c, i) => {
                  const trimmedUrl = c.url?.trim();
                  const href = trimmedUrl || `https://www.google.com/search?q=${encodeURIComponent(c.name)}`;
                  return (
                    <span
                      key={`${c.name}-${i}`}
                      className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-arcova-teal/10 border border-arcova-teal/20 pl-2.5 pr-1 py-0.5 text-xs font-medium text-arcova-teal"
                    >
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 max-w-[14rem] items-center gap-0.5 truncate hover:underline"
                        title={c.name}
                      >
                        <span className="truncate">{c.name}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setEditCompetitors((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 rounded-full p-0.5 text-arcova-teal/50 transition-colors hover:bg-arcova-teal/20 hover:text-arcova-teal"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newCompetitorUrl}
                  onChange={(ev) => setNewCompetitorUrl(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter' || !newCompetitorUrl.trim()) return;
                    ev.preventDefault();
                    const raw = newCompetitorUrl.trim();
                    let url = raw;
                    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
                    let name = raw;
                    try {
                      name = new URL(url).hostname.replace(/^www\./, '');
                    } catch { /* keep raw as label */ }
                    setEditCompetitors((prev) => [...prev, { name, url }]);
                    setNewCompetitorUrl('');
                  }}
                  placeholder="Paste competitor URL… (Enter)"
                  className="min-w-0 flex-1 rounded-lg border border-arcova-navy/10 bg-white/60 px-2 py-1 text-xs text-arcova-navy/80 placeholder:text-arcova-navy/30 focus:outline-none focus:border-arcova-teal/50"
                />
              </div>
            </Segment>
          )}

        </div>

        {/* Right column — buying team */}
        <div className="w-80 shrink-0 px-4 py-4 space-y-2">
          <div className="flex items-center gap-1.5 pb-2">
            <Users className="h-3.5 w-3.5 text-arcova-teal shrink-0" />
            <p className="text-sm font-semibold text-arcova-navy flex-1">Buying team</p>
          </div>

          {editMode ? (
            persona ? (
              <div className="space-y-2">
                <Segment label="Functions" open={open.functions} onToggle={() => toggle('functions')}>
                  <EditTagField
                    hideLabel
                    label="Functions"
                    options={BUSINESS_AREA_OPTIONS}
                    selected={editFunctions}
                    onRemove={(v) => setEditFunctions((prev) => prev.filter((f) => f !== v))}
                    onAdd={(v) => setEditFunctions((prev) => [...prev, v])}
                  />
                </Segment>
                <Segment label="Seniority" open={open.seniority} onToggle={() => toggle('seniority')}>
                  <EditTagField
                    hideLabel
                    label="Seniority"
                    options={SENIORITY_LEVEL_OPTIONS}
                    selected={editSeniority}
                    onRemove={(v) => setEditSeniority((prev) => prev.filter((s) => s !== v))}
                    onAdd={(v) => setEditSeniority((prev) => [...prev, v])}
                  />
                </Segment>
              </div>
            ) : (
              <p className="text-xs text-arcova-navy/35 leading-snug pt-1">No buying team defined yet.</p>
            )
          ) : persona ? (
            <>
              <Segment label="Functions" open={open.functions} onToggle={() => toggle('functions')}>
                <div className="flex flex-wrap gap-1.5">
                  {functions.map((f) => <Tag key={f} label={f} />)}
                </div>
              </Segment>
              <Segment label="Seniority" open={open.seniority} onToggle={() => toggle('seniority')}>
                <div className="flex flex-wrap gap-1.5">
                  {seniority.map((s) => <Tag key={s} label={s} />)}
                </div>
              </Segment>
            </>
          ) : (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-arcova-navy/35 leading-snug">No buying team defined yet.</p>
              <button
                type="button"
                onClick={onAddBuyingTeam}
                className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal/40 px-3 py-2 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
              >
                <Plus className="h-3.5 w-3.5" />
                Add buying team
              </button>
            </div>
          )}

        </div>

          </div>

          <div className="w-full min-w-0 border-t border-arcova-navy/8 px-4 py-4 space-y-2">
            <div className="flex items-center gap-1.5 pb-2">
              <Activity className="h-3.5 w-3.5 shrink-0 text-arcova-teal" />
              <p className="flex-1 text-sm font-semibold text-arcova-navy">Signals</p>
            </div>
            <Segment
              label="Company signals"
              open={open.companySignals}
              onToggle={() => toggle('companySignals')}
            >
              {editMode ? (
                <SignalCatalogByCategory
                  variant="all"
                  definitions={COMPANY_SIGNALS}
                  categoryOrder={COMPANY_SIGNAL_CATEGORY_ORDER}
                  selectedIds={editData.signals}
                  readOnly={false}
                  onToggle={(id) => toggleMulti('signals', id)}
                />
              ) : (
                <SignalCatalogByCategory
                  variant="selectedOnly"
                  definitions={COMPANY_SIGNALS}
                  categoryOrder={COMPANY_SIGNAL_CATEGORY_ORDER}
                  selectedIds={icpSignalIds}
                  readOnly
                />
              )}
            </Segment>
            <Segment
              label="Contact signals"
              open={open.contactSignals}
              onToggle={() => toggle('contactSignals')}
            >
              {editMode ? (
                persona ? (
                  <SignalCatalogByCategory
                    variant="all"
                    definitions={CONTACT_SIGNALS}
                    categoryOrder={CONTACT_SIGNAL_CATEGORY_ORDER}
                    selectedIds={editPersonaSignals}
                    readOnly={false}
                    isManagedServiceSignal={isContactSignalComingSoon}
                    onManagedServiceSignalClick={(signalId) => {
                      toast.info(
                        'This signal is available with our managed data service. Get in touch and we can enable it for you.',
                      );
                      void fetch('/api/contact-premium-signal-interest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ signalId, personaId: persona.id }),
                      }).catch(() => {});
                    }}
                    onToggle={(id) =>
                      setEditPersonaSignals((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                      )
                    }
                  />
                ) : (
                  <p className="text-xs text-arcova-navy/40 italic">
                    Add a buying team on this ICP to set contact signals.
                  </p>
                )
              ) : persona ? (
                <SignalCatalogByCategory
                  variant="selectedOnly"
                  definitions={CONTACT_SIGNALS}
                  categoryOrder={CONTACT_SIGNAL_CATEGORY_ORDER}
                  selectedIds={personaSignalIds}
                  readOnly
                />
              ) : (
                <p className="text-xs text-arcova-navy/40 italic">
                  No buying team on this ICP. Add a buying team to set contact signals.
                </p>
              )}
            </Segment>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="flex items-center justify-between gap-2 border-t border-arcova-navy/8 px-4 py-3">
          {/* Bottom-left: subtle modelled-on toggle */}
          <div className="flex items-center gap-3">
            {!editMode && e?.company_name && (
              modelledOnMode ? (
                <button
                  onClick={() => setModelledOnMode(false)}
                  className="flex items-center gap-1 text-xs text-arcova-navy/45 underline underline-offset-2 transition-colors hover:text-arcova-navy/70"
                >
                  <ChevronDown className="h-3 w-3 rotate-90" /> Back to summary
                </button>
              ) : (
                <button
                  onClick={() => setModelledOnMode(true)}
                  className="flex items-center gap-1 text-xs text-arcova-navy/45 underline underline-offset-2 transition-colors hover:text-arcova-navy/70"
                >
                  Modelled on {e.company_name} <ExternalLink className="h-3 w-3" />
                </button>
              )
            )}
            {!editMode && relativeTime(icp.updated_at) && (
              <span className="text-xs text-arcova-navy/30">Updated {relativeTime(icp.updated_at)}</span>
            )}
          </div>

          {/* Bottom-right: action buttons */}
          <div className="flex gap-2">
          {editMode ? (
            <>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg bg-arcova-teal px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-arcova-teal/85 disabled:opacity-50"
              >
                <Save className="h-3 w-3" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="flex items-center gap-1 rounded-lg border border-arcova-navy/10 px-3 py-1.5 text-xs font-medium text-arcova-navy/55 transition-colors hover:bg-arcova-navy/5 hover:text-arcova-navy disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </>
          ) : !modelledOnMode && (
            <>
              <button
                onClick={startEdit}
                disabled={reenriching}
                className="flex items-center gap-1 rounded-lg border border-arcova-teal px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button
                onClick={onReenrich}
                disabled={reenriching}
                className="flex items-center gap-1 rounded-lg border border-arcova-navy/10 px-3 py-1.5 text-xs font-medium text-arcova-navy/55 transition-colors hover:bg-arcova-navy/5 hover:text-arcova-navy disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`h-3 w-3 ${reenriching ? 'animate-spin' : ''}`} /> {reenriching ? 'Re-enriching…' : 'Re-enrich'}
              </button>
              <button
                onClick={onDelete}
                disabled={deleting || reenriching}
                className="flex items-center gap-1 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-500/70 transition-colors hover:border-red-400/50 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Page ───────────────────────────────────────────────────────────────────

export default function ICPManagerPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [icps, setIcps] = useState<ICP[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const attemptedSummaryRepairRef = useRef<Set<string>>(new Set());
  const hasRunningReenrichment = icps.some(
    (icp) => normalizeReenrichmentStatus(icp.reenrichment_status) === 'running',
  );

  const refreshPageData = async () => {
    const [icpRes, personaRes] = await Promise.all([
      fetch('/api/company-criteria'),
      fetch('/api/contacts'),
    ]);

    if (icpRes.ok) {
      const result = await icpRes.json();
      const data: ICP[] = result.data || [];
      setIcps(data);
      setExpandedIds((prev) => {
        if (data.length === 0) return new Set();
        const validIds = new Set(data.map((icp) => icp.id));
        const next = new Set([...prev].filter((id) => validIds.has(id)));
        if (next.size === 0) next.add(data[0].id);
        return next;
      });
    }

    if (personaRes.ok) {
      const result = await personaRes.json();
      setPersonas(result.data || []);
    }
  };

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshPageData();
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !hasRunningReenrichment) return;

    const intervalId = window.setInterval(() => {
      void refreshPageData();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [user, hasRunningReenrichment]);

  useEffect(() => {
    const missingSummaries = icps.filter((icp) => {
      const stored = (icp.icp_summary ?? '').trim();
      return (
        stored.length === 0 &&
        normalizeReenrichmentStatus(icp.reenrichment_status) !== 'running' &&
        !attemptedSummaryRepairRef.current.has(icp.id)
      );
    });
    if (missingSummaries.length === 0) return;

    for (const icp of missingSummaries) {
      attemptedSummaryRepairRef.current.add(icp.id);
      void (async () => {
        try {
          const summaryRes = await fetch('/api/generate-icp-summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              companyType: icp.company_type,
              platformCategory: visiblePlatformCategory(icp.company_type, icp.platform_category),
              therapeuticAreas: icp.therapeutic_areas,
              modalities: icp.modalities,
              developmentStages: icp.development_stages,
              customerTherapeuticAreas: icp.customer_therapeutic_areas,
              customerModalities: icp.customer_modalities,
              customerDevelopmentStages: icp.customer_development_stages,
              companySizes: icp.company_sizes,
              fundingStages: icp.funding_stages,
              exampleCompanyName: icp.example_company_enrichment?.company_name ?? null,
              exampleCompanyDescription: icp.example_company_enrichment?.description ?? null,
            }),
          });
          if (!summaryRes.ok) return;
          const { summary } = await summaryRes.json() as { summary?: string };
          const icpSummary = summary?.trim();
          if (!icpSummary) return;

          const updateRes = await fetch(`/api/company-criteria/${icp.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: icp.name,
              icpSummary,
              companyType: icp.company_type,
              platformCategory: visiblePlatformCategory(icp.company_type, icp.platform_category),
              therapeuticAreas: icp.therapeutic_areas,
              modalities: icp.modalities,
              developmentStages: icp.development_stages,
              customerTherapeuticAreas: icp.customer_therapeutic_areas,
              customerModalities: icp.customer_modalities,
              customerDevelopmentStages: icp.customer_development_stages,
              companySizes: icp.company_sizes,
              liFollowerSizes: icp.li_follower_sizes,
              fundingStages: icp.funding_stages,
              signals: icp.signals,
              exampleCompanies: [],
              exampleCompanyUrl: icp.example_company_url,
              exampleCompanyEnrichment: icp.example_company_enrichment ?? null,
            }),
          });
          if (!updateRes.ok) return;
          const { data } = await updateRes.json() as { data: ICP };
          setIcps((prev) => prev.map((item) => (item.id === icp.id ? data : item)));
        } catch (error) {
          console.error('Failed to repair ICP summary:', error);
        }
      })();
    }
  }, [icps]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      // Delete any associated buying team persona first
      const linkedPersona = personas.find((p) => p.icp_id === id);
      if (linkedPersona) {
        await fetch(`/api/contacts/${linkedPersona.id}`, { method: 'DELETE' }).catch(() => {});
        setPersonas((prev) => prev.filter((p) => p.id !== linkedPersona.id));
      }

      const res = await fetch(`/api/company-criteria/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setIcps((prev) => prev.filter((icp) => icp.id !== id));
        setExpandedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        toast.success('Company profile deleted');
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const handleIcpSaved = (updated: ICP) => {
    setIcps((prev) => prev.map((icp) => (icp.id === updated.id ? updated : icp)));
  };

  const handlePersonaUpdate = (updatedPersona: Persona) => {
    setPersonas((prev) => prev.map((persona) => (persona.id === updatedPersona.id ? updatedPersona : persona)));
  };

  const handlePersonaDelete = (deletedPersonaId: string) => {
    setPersonas((prev) => prev.filter((persona) => persona.id !== deletedPersonaId));
  };

  const handleReenrich = async (icp: ICP) => {
    const website = icp.example_company_url;
    if (!website) {
      toast.error('No reference company URL is stored for this ICP');
      return;
    }

    const toastId = `reenrich-${icp.id}`;
    try {
      const response = await fetch(`/api/company-criteria/${icp.id}/reenrich`, {
        method: 'POST',
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: ICP;
        alreadyRunning?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to start ICP re-enrichment');
      }

      if (payload.data) {
        handleIcpSaved(payload.data);
      }

      toast.success(
        payload.alreadyRunning
          ? 'Re-enrichment is already running.'
          : 'Re-enrichment started. You can leave this page.',
        { id: toastId },
      );
      void refreshPageData();
    } catch (error) {
      console.error('Failed to re-enrich ICP:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to re-enrich ICP', { id: toastId });
    }
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center arcova-scroll-surface">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen min-h-0 bg-transparent font-jakarta">
      <AppSidebar />

      <main className="arcova-scroll-surface min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-5xl">

          {/* Page header */}
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-arcova-navy">My ICPs</h1>
              <p className="mt-1 text-sm text-arcova-navy/45">
                The types of accounts you sell to, and who buys within them.
              </p>
            </div>
            <button
              onClick={() => router.push('/company-criteria/new')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/85 shrink-0"
            >
              <Plus className="h-4 w-4" />
              Add new ICP
            </button>
          </div>

          {icps.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-full bg-white/60 border border-arcova-navy/10 flex items-center justify-center mb-4 shadow-arcova">
                <Building2 className="w-8 h-8 text-arcova-navy/25" />
              </div>
              <h3 className="text-lg font-semibold text-arcova-navy mb-2">No target companies yet</h3>
              <p className="text-arcova-navy/45 mb-6 text-sm max-w-xs">
                Add your first target company to define who you sell to and who buys.
              </p>
              <button
                onClick={() => router.push('/company-criteria/new')}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-arcova-teal text-white text-sm font-semibold rounded-lg hover:bg-arcova-teal/85 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add your first company
              </button>
            </div>
          ) : (
            <div className={'space-y-4 [&_.text-xs]:text-[0.9375rem] [&_.text-xs]:leading-normal [&_.text-sm]:text-base [&_.text-sm]:leading-relaxed'}>
              {icps.map((icp, i) => {
                const persona = personas.find((p) => p.icp_id === icp.id) ?? null;
                const collapsed = !expandedIds.has(icp.id);
                return (
                  <ICPCard
                    key={icp.id}
                    icp={icp}
                    index={icps.length - i}
                    persona={persona}
                    collapsed={collapsed}
                    onToggle={() => setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(icp.id)) next.delete(icp.id);
                      else next.add(icp.id);
                      return next;
                    })}
                    onSaved={handleIcpSaved}
                    onDelete={() => setConfirmDeleteId(icp.id)}
                    deleting={deletingId === icp.id}
                    reenriching={normalizeReenrichmentStatus(icp.reenrichment_status) === 'running'}
                    onPersonaUpdate={handlePersonaUpdate}
                    onPersonaDelete={handlePersonaDelete}
                    onAddBuyingTeam={() => router.push(`/personas/new?icpId=${icp.id}`)}
                    onReenrich={() => void handleReenrich(icp)}
                  />
                );
              })}
            </div>
          )}

        </div>
      </main>

      {/* ── Delete confirmation modal ── */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-icp-modal-title"
        >
          <div
            className="absolute inset-0 bg-arcova-navy/20 backdrop-blur-sm"
            onClick={() => setConfirmDeleteId(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-arcova-navy/10 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-6 w-6 text-red-500" />
            </div>
            <h2 id="delete-icp-modal-title" className="mb-2 text-lg font-semibold text-arcova-navy">
              Delete this ICP profile?
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-arcova-navy/60">
              This will permanently remove the target company profile along with its criteria and buying team. Any contacts already found using this profile won&apos;t be affected, but you won&apos;t be able to find new ones with it.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { void handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                disabled={deletingId === confirmDeleteId}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Yes, delete it
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-arcova-navy/10 px-4 py-2.5 text-sm font-medium text-arcova-navy/60 transition-colors hover:bg-arcova-navy/5 hover:text-arcova-navy"
              >
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
