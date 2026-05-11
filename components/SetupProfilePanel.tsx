'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Check, Building2, Briefcase, Users, ChevronDown, ChevronUp, ExternalLink, X, Pencil, Trash2, Save, RefreshCw } from 'lucide-react';
import {
  COMPANY_TYPE_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  MODALITY_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  LI_FOLLOWER_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  BUSINESS_AREA_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  INDUSTRY_OPTIONS,
  normalizeIndustrySelectValue,
  selectOptionsWithCurrentValue,
} from '@/lib/arcova-taxonomy';
import {
  formatCurrencyShort,
  extractFundingStatus,
} from '@/lib/funding-display';
import { getSignalDisplayName } from '@/lib/signal-display-names';
import { resolveCustomerSegments } from '@/lib/split-customer-segments';
import { PLATFORM_CATEGORY_OPTIONS } from '@/lib/platform-category';

// ── Types ──────────────────────────────────────────────────────────────────

type CardStatus = 'pending' | 'building' | 'complete';

export interface PanelCompanyData {
  companyType: string;
  platformCategory: string;
  companySizes: string[];
  liFollowerSizes: string[];
  /** This company's own therapeutic focus (their science / product). */
  therapeuticAreas: string[];
  modalities: string[];
  developmentStages: string[];
  /** Accounts / beachhead they sell into — not "this company is an oncology company" unless PLANE A matched. */
  customerTherapeuticAreas: string[];
  customerModalities: string[];
  customerDevelopmentStages: string[];
  fundingStages: string[];
  signals: string[];
  /** First-class ICP segment fields — editable, persisted in icps columns. */
  targetCustomers: string[];
  buyerTypes: string[];
  competitors: CompetitorItem[];
}

export interface PanelPersonaData {
  functions: string[];
  seniority: string[];
  jobTitles?: string[];
  signals: string[];
}

export interface CompetitorItem {
  name: string;
  url?: string;
}

export interface PanelMyCompanyData {
  companyName?: string;
  website?: string;
  logoUrl?: string;
  tagline?: string;
  linkedinUrl?: string;
  description?: string[];
  customersWeServe?: string[];
  valuePropositions?: string[];
  goodFit?: string[];
  badFit?: string[];
  competitorsEnriched?: CompetitorItem[];
  companyStatus?: string;
  companyType?: string;
  companyTypeDisplay?: string;
  platformCategory?: string;
  therapeuticAreas?: string[];
  modalities?: string[];
  developmentStages?: string[];
  productsServices?: string[];
  services?: string[];
  technologies?: string[];
  employeeCount?: number;
  employeeRange?: string;
  followerCount?: number;
  foundedYear?: number;
  fundingStage?: string;
  totalFundingUsd?: number;
  hqCity?: string;
  hqCountry?: string;
  industry?: string;
}

export interface PanelTargetCompanyData {
  company_name?: string | null;
  website?: string | null;
  logo_url?: string | null;
  tagline?: string | null;
  linkedin_url?: string | null;
  description?: string[] | null;
  target_customers?: string[] | null;
  customers_we_serve?: string[] | null;
  value_propositions?: string[] | null;
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
  employee_count?: number | null;
  employee_range?: string | null;
  follower_count?: number | null;
  founded_year?: number | null;
  funding_stage?: string | null;
  total_funding_usd?: number | null;
  latest_funding_date?: string | null;
  hq_city?: string | null;
  hq_country?: string | null;
  industry?: string | null;
}

function isSaasCompanyType(value?: string | null): boolean {
  return (value ?? '').trim() === 'SaaS';
}

export type MyCompanyChangeValue = string | string[] | number | CompetitorItem[] | undefined;

export type IcpChangeValue = string | string[] | CompetitorItem[];

export interface SetupProfilePanelProps {
  phase: string;
  // Card 1 — my company
  myCompany: PanelMyCompanyData;
  analysisLoading: boolean;
  editMode?: boolean;
  onMyCompanyChange?: (field: keyof PanelMyCompanyData, value: MyCompanyChangeValue) => void;
  onEditCompany?: () => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onDeleteCompany?: () => void;
  onReenrichCompany?: () => void;
  // Card 2 — target companies
  reviewedCompanyName: string;
  enrichedTargetCompany?: PanelTargetCompanyData | null;
  savedIcpName: string;
  panelCompany: PanelCompanyData;
  chipSel: string[];
  icpEditMode?: boolean;
  onEditIcp?: () => void;
  onSaveIcp?: () => void;
  onCancelIcp?: () => void;
  onReenrichIcp?: () => void;
  onDeleteIcp?: () => void;
  onIcpFieldChange?: (field: string, value: IcpChangeValue) => void;
  // Card 3 — buying team
  panelPersona: PanelPersonaData;
  savedPersonaName: string;
  buyingTeamEditMode?: boolean;
  onEditBuyingTeam?: () => void;
  onCancelBuyingTeamEdit?: () => void;
  onToggleBuyingTeamFn?: (v: string) => void;
  onToggleBuyingTeamSeniority?: (v: string) => void;
  onConfirmBuyingTeam?: () => void;
  buyingTeamExampleCompany?: string;
  buyingTeamIcpName?: string;
  /** When false, hides account- and contact-level intent pills on the cards (e.g. setup auto-applies on save). Default true for other flows. */
  showSignalPills?: boolean;
}

// ── Phase sets (building-only — complete is data-driven) ───────────────────

const ICP_BUILDING_PHASES = new Set([
  'customer_url_input', 'customer_url_loading', 'customer_url_review', 'company_select',
  'company_type', 'company_size', 'company_ta', 'company_modality',
  'company_stage', 'company_funding', 'company_saving',
]);

const BUYING_BUILDING_PHASES = new Set([
  'buying_team_loading',
  'buying_team_review',
  'persona_functions',
  'persona_seniority',
  'persona_saving',
  'done',
]);

// ── Primitives ─────────────────────────────────────────────────────────────

function Tag({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-arcova-teal/15 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">
      {label}
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-arcova-teal/50 hover:text-arcova-teal transition-colors">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function FieldRow({ label, tags }: { label: string; tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-white/40">{label}</p>
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => <Tag key={t} label={t} />)}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: CardStatus }) {
  if (status === 'complete') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-arcova-teal">
        <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'building') {
    return (
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="h-2 w-2 animate-pulse rounded-full bg-arcova-teal" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/20">
      <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
    </span>
  );
}

function CardShell({
  icon: Icon,
  label,
  status,
  collapsed,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  label: string;
  status: CardStatus;
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const isPending = status === 'pending';
  const isComplete = status === 'complete';
  const isCollapsible = isComplete && !!onToggle;

  const header = (
    <div className="flex items-center gap-2.5 px-4 py-3">
      <Icon
        className={`h-4 w-4 shrink-0 ${isPending ? 'text-white/25' : 'text-arcova-teal'}`}
      />
      <span
        className={`flex-1 text-sm font-semibold ${isPending ? 'text-white/30' : 'text-white'}`}
      >
        {label}
      </span>
      {isCollapsible ? (
        <div className="flex items-center gap-1.5">
          <StatusIcon status={status} />
          {collapsed
            ? <ChevronDown className="h-3.5 w-3.5 text-white/40" />
            : <ChevronUp className="h-3.5 w-3.5 text-white/40" />}
        </div>
      ) : (
        <StatusIcon status={status} />
      )}
    </div>
  );

  return (
    <div
      className={`rounded-2xl border transition-all duration-300 ${
        isPending
          ? 'border-white/10 bg-white/[0.03]'
          : status === 'building'
          ? 'border-arcova-teal/25 bg-white/[0.06] shadow-[0_0_20px_-8px_rgba(0,200,180,0.15)]'
          : 'border-white/15 bg-white/[0.06]'
      }`}
    >
      {isCollapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left border-b border-white/10 hover:bg-white/[0.15] transition-colors rounded-t-2xl"
        >
          {header}
        </button>
      ) : (
        <div className={!isPending ? 'border-b border-white/10' : ''}>{header}</div>
      )}
      {!collapsed && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

const LIGHT_SECTION_OPEN = 'rounded-xl overflow-hidden border border-arcova-navy/8 bg-white/50';
const LIGHT_SECTION_CLOSED = 'rounded-xl overflow-hidden bg-arcova-navy/[0.04] hover:bg-arcova-navy/[0.07]';

// ── Card 1 — Your company ──────────────────────────────────────────────────

function SubSection({
  label,
  open,
  onToggle,
  light,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  light?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl overflow-hidden transition-colors ${
        light
          ? open
            ? LIGHT_SECTION_OPEN
            : LIGHT_SECTION_CLOSED
          : open
          ? 'border border-white/10 bg-white/[0.06]'
          : 'bg-white/[0.18] hover:bg-white/[0.22]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors"
      >
        <span
          className={`font-manrope text-sm font-semibold tracking-[-0.012em] ${
            light
              ? open
                ? 'text-arcova-navy'
                : 'text-arcova-navy/88'
              : open
              ? 'text-white/80'
              : 'text-white'
          }`}
        >
          {label}
        </span>
        {open ? (
          <ChevronUp
            className={`h-4 w-4 shrink-0 ${light ? 'text-arcova-navy/45' : 'text-white/60'}`}
          />
        ) : (
          <ChevronDown
            className={`h-4 w-4 shrink-0 ${light ? 'text-arcova-navy' : 'text-white'}`}
          />
        )}
      </button>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs text-white/70 leading-snug">
          <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function EditableBulletList({
  items,
  onChange,
  addPlaceholder = 'Add item…',
  light,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addPlaceholder?: string;
  light?: boolean;
}) {
  const rowInput = light
    ? 'flex-1 rounded-lg border border-arcova-navy/12 bg-white/90 px-2.5 py-1.5 text-[13px] text-arcova-navy placeholder:text-arcova-navy/35 focus:outline-none focus:border-arcova-teal/50'
    : 'flex-1 rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-arcova-teal/50';
  const removeBtn = light
    ? 'shrink-0 text-arcova-navy/30 hover:text-arcova-navy/60 transition-colors'
    : 'shrink-0 text-white/25 hover:text-white/60 transition-colors';
  const addBtn = light
    ? 'text-[12.5px] text-arcova-navy/40 hover:text-arcova-teal transition-colors flex items-center gap-1 pl-2.5'
    : 'text-xs text-white/30 hover:text-white/60 transition-colors flex items-center gap-1 pl-2.5';

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="mt-0 h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
          <input
            type="text"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className={rowInput}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className={removeBtn}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className={addBtn}
      >
        <span className="text-base leading-none">+</span> {addPlaceholder}
      </button>
    </div>
  );
}

function EditableTagList({
  items,
  onChange,
  addPlaceholder = 'Add item…',
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addPlaceholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const addItem = () => {
    const next = draft.trim();
    if (!next) return;
    const exists = items.some((item) => item.trim().toLowerCase() === next.toLowerCase());
    if (exists) {
      setDraft('');
      return;
    }
    onChange([...items, next]);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {items.map((item, index) => (
            <Tag
              key={`${item}-${index}`}
              label={item}
              onRemove={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            />
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
          placeholder={addPlaceholder}
          className={EDIT_INPUT}
        />
        <button
          type="button"
          onClick={addItem}
          className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/80"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/** Extracts the short name from a verbose enrichment string like "Guardant360 CDx: FDA-approved…" → "Guardant360 CDx" */
function shortLabel(s: string): string {
  return s.split(/:\s|—|\.\s/)[0].trim();
}


export function AddTagSelect({
  options,
  selected,
  onAdd,
  placeholder = 'Add…',
  light,
}: {
  options: string[];
  selected: string[];
  onAdd: (v: string) => void;
  placeholder?: string;
  light?: boolean;
}) {
  const remaining = options.filter((o) => !selected.includes(o));
  if (remaining.length === 0) return null;
  const cls = light
    ? 'w-full rounded-lg border border-arcova-navy/12 bg-white/90 px-2.5 py-2 text-[13px] text-arcova-navy/70 focus:outline-none focus:border-arcova-teal/50 cursor-pointer'
    : 'w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/40 focus:outline-none focus:border-arcova-teal/50 cursor-pointer';
  const optCls = light ? 'bg-white text-arcova-navy' : 'bg-slate-900 text-white';
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
      className={cls}
    >
      <option value="">{placeholder}</option>
      {remaining.map((o) => (
        <option key={o} value={o} className={optCls}>{o}</option>
      ))}
    </select>
  );
}

function Stat({ label, value, subValue }: { label: string; value: string; subValue?: string }) {
  return (
    <div>
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-0.5 text-sm text-white/80 leading-tight">{value}</p>
      {subValue && <p className="text-xs text-white/80 leading-tight">{subValue}</p>}
    </div>
  );
}

const EDIT_INPUT = "w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-arcova-teal/50 placeholder:text-white/25";

/** Light-theme tokens for ProfileCard when `appearance="light"` (e.g. my-company glass page). */
const LIGHT_INPUT =
  'w-full rounded-lg border border-arcova-navy/12 bg-white/90 px-2.5 py-2 text-[13px] text-arcova-navy focus:outline-none focus:border-arcova-teal/50 placeholder:text-arcova-navy/35';
const LIGHT_SELECT =
  'w-full rounded-lg border border-arcova-navy/12 bg-white/90 px-2.5 py-2 text-[13px] text-arcova-navy focus:outline-none focus:border-arcova-teal/50 cursor-pointer';

function fieldLabelClass(light: boolean) {
  return light
    ? 'mb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/40'
    : 'mb-1 text-xs text-white/40';
}

function bodyTextClass(light: boolean) {
  return light ? 'text-[13px] text-arcova-navy/75 leading-snug' : 'text-xs text-white/70 leading-snug';
}

export interface ProfileCardProps {
  status: CardStatus;
  myCompany: PanelMyCompanyData;
  analysisLoading: boolean;
  /** Live status message shown during enrichment (replaces the static copy) */
  enrichmentMsg?: string;
  /** 0–100 progress shown as a bar during enrichment */
  enrichmentPct?: number;
  editMode?: boolean;
  onMyCompanyChange?: (field: keyof PanelMyCompanyData, value: MyCompanyChangeValue) => void;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onReenrich?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Start all subsections expanded */
  defaultAllOpen?: boolean;
  /** Render sections in a multi-column grid (desktop only). 2 = top-3 / bottom-4, 3 = balanced thirds */
  columns?: 2 | 3;
  /** `light` matches app glass pages; skips dark CardShell and uses navy/surface inputs. */
  appearance?: 'dark' | 'light';
  /** Hide the small logo + name block (parent page already shows a hero). */
  hideCompanyHeader?: boolean;
}

export function ProfileCard({
  status,
  myCompany,
  analysisLoading,
  enrichmentMsg,
  enrichmentPct,
  editMode = false,
  onMyCompanyChange,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onReenrich,
  collapsed,
  onToggle,
  defaultAllOpen = false,
  columns,
  appearance = 'dark',
  hideCompanyHeader = false,
}: ProfileCardProps) {
  const ALL_OPEN = { about: true, customers: true, valueProps: true, firmographics: true, social: true, competitors: true, products: true };
  const ALL_CLOSED = { about: false, customers: false, valueProps: false, firmographics: false, social: false, competitors: false, products: false };

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    defaultAllOpen ? ALL_OPEN : ALL_CLOSED
  );
  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Auto-open all sections when entering edit mode so the user can see what they're editing
  const prevEditMode = React.useRef(editMode);
  React.useEffect(() => {
    if (editMode && !prevEditMode.current) {
      setOpenSections(ALL_OPEN);
    }
    prevEditMode.current = editMode;
  }, [editMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');

  const {
    companyName, website, logoUrl, tagline, linkedinUrl,
    description, customersWeServe, valuePropositions, goodFit, badFit,
    companyType, companyTypeDisplay, companyStatus, competitorsEnriched,
    platformCategory,
    therapeuticAreas, modalities, developmentStages,
    productsServices, services, technologies,
    employeeCount, employeeRange, followerCount, foundedYear,
    fundingStage, totalFundingUsd, hqCity, hqCountry,
    industry,
  } = myCompany;

  const industrySelectOptions = React.useMemo(() => {
    const raw = (industry ?? '').trim();
    const key = normalizeIndustrySelectValue(raw) || raw;
    return selectOptionsWithCurrentValue([...INDUSTRY_OPTIONS] as string[], key);
  }, [industry]);

  const platformSelectOptions = React.useMemo(() => {
    const c = (platformCategory ?? '').trim();
    return selectOptionsWithCurrentValue([...PLATFORM_CATEGORY_OPTIONS], c);
  }, [platformCategory]);

  const displayDomain = website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const visiblePlatformCategory = isSaasCompanyType(companyType) ? (platformCategory ?? '').trim() : '';

  const hasAbout =
    !!description?.[0] ||
    !!(companyType || companyTypeDisplay) ||
    !!visiblePlatformCategory ||
    (therapeuticAreas?.length ?? 0) > 0 ||
    (modalities?.length ?? 0) > 0 ||
    (developmentStages?.length ?? 0) > 0;
  const hasCustomers = (customersWeServe?.length ?? 0) > 0 || (goodFit?.length ?? 0) > 0 || (badFit?.length ?? 0) > 0;
  const hasValueProps = (valuePropositions?.length ?? 0) > 0;
  const hasFirmographics = !!(
    employeeCount ||
    employeeRange ||
    foundedYear ||
    hqCity ||
    hqCountry ||
    fundingStage ||
    totalFundingUsd != null ||
    companyStatus ||
    industry
  );
  const hasSocial = !!(followerCount != null || linkedinUrl);

  const isLight = appearance === 'light';
  const inputCls = isLight ? LIGHT_INPUT : EDIT_INPUT;
  const selectCls = isLight
    ? LIGHT_SELECT
    : 'w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-arcova-teal/50 cursor-pointer';
  const optionCls = isLight ? 'bg-white text-arcova-navy' : 'bg-slate-900 text-white';
  const optionMutedCls = isLight ? 'bg-white text-arcova-navy/50' : 'bg-slate-900 text-white/40';

  const commitNewCompetitor = React.useCallback(() => {
    if (!editMode || !onMyCompanyChange) return;
    const raw = newCompetitorUrl.trim();
    if (!raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let name = raw;
    try {
      name = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* keep typed text as display name */
    }
    onMyCompanyChange('competitorsEnriched', [...(competitorsEnriched ?? []), { name, url }]);
    setNewCompetitorUrl('');
  }, [editMode, newCompetitorUrl, onMyCompanyChange, competitorsEnriched]);

  const inner = (
    <>
      {status === 'pending' && (
        <p className={isLight ? 'text-[13px] text-arcova-navy/45' : 'text-xs text-white/30'}>
          Your company profile will appear here.
        </p>
      )}

      {status === 'building' && analysisLoading && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex gap-1 shrink-0">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/60"
                  style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
            <span className={isLight ? 'text-[13px] text-arcova-navy/60' : 'text-xs text-white/50'}>
              {enrichmentMsg || 'Analysing your website…'}
            </span>
          </div>
          {typeof enrichmentPct === 'number' && enrichmentPct > 0 && (
            <div className="space-y-1">
              <div className={`relative h-1.5 overflow-hidden rounded-full ${isLight ? 'bg-arcova-navy/10' : 'bg-white/10'}`}>
                <div
                  className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${enrichmentPct}%` }}
                />
              </div>
              <p className={`text-right text-xs tabular-nums ${isLight ? 'text-arcova-navy/45' : 'text-white/30'}`}>
                {enrichmentPct}%
              </p>
            </div>
          )}
        </div>
      )}

      {status !== 'pending' && !analysisLoading && (
        <div className="space-y-2">

          {/* Always-visible header — logo + name + domain + tagline */}
          {!hideCompanyHeader && (companyName || website) && (
            <div className="flex items-start gap-2.5 pb-1">
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt=""
                  className={`h-8 w-8 shrink-0 rounded-lg object-contain p-0.5 ${
                    isLight ? 'bg-arcova-navy/6 ring-1 ring-arcova-navy/8' : 'bg-white/10'
                  }`}
                />
              )}
              <div className="min-w-0">
                {companyName && (
                  <p
                    className={`text-sm font-semibold leading-tight ${
                      isLight ? 'text-arcova-navy' : 'text-white'
                    }`}
                  >
                    {companyName}
                  </p>
                )}
                {displayDomain && (
                  <a href={website} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline mt-0.5">
                    {displayDomain}
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                )}
                {tagline && (
                  <p
                    className={`mt-1 text-xs italic leading-snug line-clamp-1 ${
                      isLight ? 'text-arcova-navy/55' : 'text-white/40'
                    }`}
                  >
                    {tagline}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Sections ── extracted so we can optionally render in two columns */}
          {(() => {
            const aboutSection = (hasAbout || editMode) ? (
              <SubSection key="about" label="About" open={openSections.about} onToggle={() => toggleSection('about')} light={isLight}>
                {(description?.[0] || editMode) && (
                  editMode ? (
                    <textarea
                      value={description?.[0] ?? ''}
                      onChange={(e) => onMyCompanyChange?.('description', [e.target.value])}
                      rows={3}
                      placeholder="Short description…"
                      className={`${inputCls} resize-none leading-snug`}
                    />
                  ) : (
                    <p className={bodyTextClass(isLight)}>{description![0]}</p>
                  )
                )}
                {(companyType || companyTypeDisplay || editMode) && (
                  <div>
                    <p className={fieldLabelClass(isLight)}>Company type</p>
                    {editMode ? (
                      <select
                        value={companyType ?? ''}
                        onChange={(e) => {
                          const v = e.target.value || undefined;
                          onMyCompanyChange?.('companyType', v);
                          onMyCompanyChange?.('companyTypeDisplay', undefined);
                          if (!isSaasCompanyType(v)) onMyCompanyChange?.('platformCategory', undefined);
                        }}
                        className={selectCls}
                      >
                        <option value="" className={optionMutedCls}>Select type…</option>
                        {COMPANY_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value} className={optionCls}>{o.value}</option>
                        ))}
                      </select>
                    ) : (companyTypeDisplay || companyType) ? (
                      <Tag label={String(companyTypeDisplay ?? companyType)} />
                    ) : null}
                  </div>
                )}
                {isSaasCompanyType(companyType) && (visiblePlatformCategory || editMode) && (
                  <div>
                    <p className={fieldLabelClass(isLight)}>Platform category</p>
                    {editMode ? (
                      <select
                        value={platformCategory ?? ''}
                        onChange={(e) =>
                          onMyCompanyChange?.('platformCategory', e.target.value || undefined)
                        }
                        className={selectCls}
                      >
                        <option value="" className={optionMutedCls}>Select platform…</option>
                        {platformSelectOptions.map((o) => (
                          <option key={o} value={o} className={optionCls}>{o}</option>
                        ))}
                      </select>
                    ) : visiblePlatformCategory ? (
                      <Tag label={visiblePlatformCategory} />
                    ) : null}
                  </div>
                )}
                {((therapeuticAreas?.length ?? 0) > 0 || editMode) && (
                  <div>
                    <p className={fieldLabelClass(isLight)}>Therapeutic areas</p>
                    {(therapeuticAreas?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {therapeuticAreas!.map((t) => (
                          <Tag key={t} label={t}
                            onRemove={editMode ? () => onMyCompanyChange?.('therapeuticAreas', therapeuticAreas!.filter((x) => x !== t)) : undefined}
                          />
                        ))}
                      </div>
                    )}
                    {editMode && (
                      <AddTagSelect
                        options={THERAPEUTIC_AREA_OPTIONS as unknown as string[]}
                        selected={therapeuticAreas ?? []}
                        onAdd={(v) => onMyCompanyChange?.('therapeuticAreas', [...(therapeuticAreas ?? []), v])}
                        placeholder="Add therapeutic area…"
                        light={isLight}
                      />
                    )}
                  </div>
                )}
                {((modalities?.length ?? 0) > 0 || editMode) && (
                  <div>
                    <p className={fieldLabelClass(isLight)}>Modalities</p>
                    {(modalities?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {modalities!.map((m) => (
                          <Tag key={m} label={m}
                            onRemove={editMode ? () => onMyCompanyChange?.('modalities', modalities!.filter((x) => x !== m)) : undefined}
                          />
                        ))}
                      </div>
                    )}
                    {editMode && (
                      <AddTagSelect
                        options={MODALITY_OPTIONS as unknown as string[]}
                        selected={modalities ?? []}
                        onAdd={(v) => onMyCompanyChange?.('modalities', [...(modalities ?? []), v])}
                        placeholder="Add modality…"
                        light={isLight}
                      />
                    )}
                  </div>
                )}
                {((developmentStages?.length ?? 0) > 0 || editMode) && (
                  <div>
                    <p className={fieldLabelClass(isLight)}>Development stages</p>
                    {(developmentStages?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1">
                        {developmentStages!.map((s) => (
                          <Tag key={s} label={s}
                            onRemove={editMode ? () => onMyCompanyChange?.('developmentStages', developmentStages!.filter((x) => x !== s)) : undefined}
                          />
                        ))}
                      </div>
                    )}
                    {editMode && (
                      <AddTagSelect
                        options={DEVELOPMENT_STAGE_OPTIONS as unknown as string[]}
                        selected={developmentStages ?? []}
                        onAdd={(v) => onMyCompanyChange?.('developmentStages', [...(developmentStages ?? []), v])}
                        placeholder="Add stage…"
                        light={isLight}
                      />
                    )}
                  </div>
                )}
              </SubSection>
            ) : null;

            const firmographicsSection = (hasFirmographics || editMode) ? (
              <SubSection key="firmographics" label="Firmographics" open={openSections.firmographics} onToggle={() => toggleSection('firmographics')} light={isLight}>
                {editMode ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <div className="col-span-2">
                      <p className={fieldLabelClass(isLight)}>Industry</p>
                      <select
                        value={normalizeIndustrySelectValue(industry ?? '') || industry || ''}
                        onChange={(e) =>
                          onMyCompanyChange?.('industry', e.target.value || undefined)
                        }
                        className={selectCls}
                      >
                        <option value="" className={optionMutedCls}>Select industry…</option>
                        {industrySelectOptions.map((o) => (
                          <option key={o} value={o} className={optionCls}>{o}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>Employees</p>
                      <input type="number" min={0} value={employeeCount ?? ''} placeholder={employeeRange ?? '—'}
                        onChange={(e) => onMyCompanyChange?.('employeeCount', e.target.value ? Number(e.target.value) : undefined)}
                        className={inputCls} />
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>Founded</p>
                      <input type="number" min={1800} max={2100} value={foundedYear ?? ''} placeholder="Year"
                        onChange={(e) => onMyCompanyChange?.('foundedYear', e.target.value ? Number(e.target.value) : undefined)}
                        className={inputCls} />
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>HQ city</p>
                      <input type="text" value={hqCity ?? ''} placeholder="City"
                        onChange={(e) => onMyCompanyChange?.('hqCity', e.target.value || undefined)}
                        className={inputCls} />
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>HQ country</p>
                      <input type="text" value={hqCountry ?? ''} placeholder="Country"
                        onChange={(e) => onMyCompanyChange?.('hqCountry', e.target.value || undefined)}
                        className={inputCls} />
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>Status</p>
                      <input type="text" value={companyStatus ?? ''} placeholder="e.g. Private"
                        onChange={(e) => onMyCompanyChange?.('companyStatus', e.target.value || undefined)}
                        className={inputCls} />
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>Funding stage</p>
                      <input type="text" value={fundingStage ?? ''} placeholder="e.g. Series B"
                        onChange={(e) => onMyCompanyChange?.('fundingStage', e.target.value || undefined)}
                        className={inputCls} />
                    </div>
                    <div className="col-span-2">
                      <p className={fieldLabelClass(isLight)}>Total funding (USD)</p>
                      <input type="number" min={0} value={totalFundingUsd ?? ''} placeholder="e.g. 50000000"
                        onChange={(e) => onMyCompanyChange?.('totalFundingUsd', e.target.value ? Number(e.target.value) : undefined)}
                        className={inputCls} />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                    {industry && (
                      <Stat label="Industry" value={normalizeIndustrySelectValue(industry) || industry} />
                    )}
                    {(employeeCount || employeeRange) && (
                      <Stat label="Employees" value={employeeCount ? employeeCount.toLocaleString() : employeeRange!} />
                    )}
                    {foundedYear && <Stat label="Founded" value={String(foundedYear)} />}
                    {hqCity && <Stat label="HQ" value={hqCity} subValue={hqCountry ?? undefined} />}
                    {companyStatus && (() => {
                      const match = companyStatus.match(/^([^(]+)\s*\(([^)]+)\)\s*$/);
                      return match
                        ? <Stat label="Status" value={match[1].trim()} subValue={match[2].trim()} />
                        : <Stat label="Status" value={companyStatus} />;
                    })()}
                    {fundingStage && <Stat label="Funding stage" value={fundingStage} />}
                    {totalFundingUsd != null && (
                      <Stat label="Total funding" value={formatCurrencyShort(totalFundingUsd)} />
                    )}
                  </div>
                )}
              </SubSection>
            ) : null;

            const customersSection = (hasCustomers || editMode) ? (
              <SubSection key="customers" label="Customers" open={openSections.customers} onToggle={() => toggleSection('customers')} light={isLight}>
                {((customersWeServe?.length ?? 0) > 0 || editMode) && (
                  <div className={((goodFit?.length ?? 0) > 0 || (badFit?.length ?? 0) > 0 || editMode) ? 'mb-2' : ''}>
                    {editMode && <p className={fieldLabelClass(isLight)}>Customer types</p>}
                    {editMode ? (
                      <EditableBulletList
                        items={customersWeServe ?? []}
                        onChange={(v) => onMyCompanyChange?.('customersWeServe', v)}
                        addPlaceholder="Add customer type…"
                        light={isLight}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {customersWeServe!.map((c, i) => (
                          <Tag key={i} label={c} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {((goodFit?.length ?? 0) > 0 || (badFit?.length ?? 0) > 0 || editMode) && (
                  <div className="space-y-2 border-t border-white/10 pt-2 mt-1">
                    {((goodFit?.length ?? 0) > 0 || editMode) && (
                      <div>
                        <p className={fieldLabelClass(isLight)}>Good fit</p>
                        {editMode ? (
                          <EditableBulletList
                            items={goodFit ?? []}
                            onChange={(v) => onMyCompanyChange?.('goodFit', v)}
                            addPlaceholder="Add good fit…"
                            light={isLight}
                          />
                        ) : (
                          <BulletList items={goodFit!} />
                        )}
                      </div>
                    )}
                    {((badFit?.length ?? 0) > 0 || editMode) && (
                      <div>
                        <p className={fieldLabelClass(isLight)}>Not a fit</p>
                        {editMode ? (
                          <EditableBulletList
                            items={badFit ?? []}
                            onChange={(v) => onMyCompanyChange?.('badFit', v)}
                            addPlaceholder="Add not a fit…"
                            light={isLight}
                          />
                        ) : (
                          <BulletList items={badFit!} />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </SubSection>
            ) : null;

            const competitorsSection = ((competitorsEnriched?.length ?? 0) > 0 || editMode) ? (
              <SubSection key="competitors" label="Competitors" open={openSections.competitors} onToggle={() => toggleSection('competitors')} light={isLight}>
                <div className="space-y-2">
                  {(competitorsEnriched ?? []).map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer"
                          className={`flex min-w-0 flex-1 items-center gap-1.5 font-medium hover:underline ${
                            isLight ? 'text-[13px] text-arcova-teal' : 'text-sm text-arcova-teal'
                          }`}>
                          <span className="truncate">{c.name}</span>
                          <ExternalLink className={`shrink-0 ${isLight ? 'h-3.5 w-3.5' : 'h-3 w-3'}`} />
                        </a>
                      ) : (
                        <p className={`flex-1 truncate font-medium ${isLight ? 'text-[13px] text-arcova-navy/85' : 'text-sm text-white/85'}`}>
                          {c.name}
                        </p>
                      )}
                      {editMode && (
                        <button
                          type="button"
                          onClick={() => onMyCompanyChange?.('competitorsEnriched', competitorsEnriched!.filter((_, j) => j !== i))}
                          className={`shrink-0 rounded-md p-1 transition-colors ${
                            isLight
                              ? 'text-arcova-navy/45 hover:bg-red-50 hover:text-red-600'
                              : 'text-white/35 hover:bg-white/[0.08] hover:text-white/80'
                          }`}
                          aria-label={`Remove ${c.name}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {editMode && (
                    <div
                      className={`space-y-1.5 ${
                        (competitorsEnriched?.length ?? 0) > 0
                          ? isLight
                            ? 'mt-2 border-t border-arcova-navy/10 pt-2.5'
                            : 'mt-2 border-t border-white/10 pt-2.5'
                          : ''
                      }`}
                    >
                      <p className={fieldLabelClass(isLight)}>Add a competitor</p>
                      <div className="flex flex-wrap items-stretch gap-2">
                        <input
                          type="text"
                          value={newCompetitorUrl}
                          onChange={(e) => setNewCompetitorUrl(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitNewCompetitor();
                            }
                          }}
                          placeholder="Competitor website URL"
                          className={`min-w-[12rem] flex-1 ${inputCls}`}
                        />
                        <button
                          type="button"
                          onClick={commitNewCompetitor}
                          disabled={!newCompetitorUrl.trim()}
                          className={
                            isLight
                              ? 'shrink-0 rounded-lg border border-arcova-navy/12 bg-white/90 px-3 py-2 text-[13px] font-medium text-arcova-navy shadow-sm transition-colors hover:border-arcova-teal/35 hover:bg-arcova-teal/[0.06] disabled:cursor-not-allowed disabled:opacity-40'
                              : 'shrink-0 rounded-lg border border-white/15 bg-white/[0.08] px-3 py-2 text-sm font-medium text-white/85 transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40'
                          }
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </SubSection>
            ) : null;

            const productsSection = ((productsServices?.length ?? 0) > 0 || (services?.length ?? 0) > 0 || (technologies?.length ?? 0) > 0 || editMode) ? (
              <SubSection key="products" label="Products, Services, Tech" open={openSections.products} onToggle={() => toggleSection('products')} light={isLight}>
                <div className="space-y-2.5">
                  {((productsServices?.length ?? 0) > 0 || editMode) && (
                    <div>
                      <p className={fieldLabelClass(isLight)}>Products</p>
                      {editMode ? (
                        <EditableBulletList
                          items={productsServices ?? []}
                          onChange={(v) => onMyCompanyChange?.('productsServices', v)}
                          addPlaceholder="Add product…"
                          light={isLight}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(productsServices ?? []).map((p, i) => (
                            <Tag key={i} label={shortLabel(p)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {((services?.length ?? 0) > 0 || editMode) && (
                    <div>
                      <p className={fieldLabelClass(isLight)}>Services</p>
                      {editMode ? (
                        <EditableBulletList
                          items={services ?? []}
                          onChange={(v) => onMyCompanyChange?.('services', v)}
                          addPlaceholder="Add service…"
                          light={isLight}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(services ?? []).map((s, i) => (
                            <Tag key={i} label={shortLabel(s)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {((technologies?.length ?? 0) > 0 || editMode) && (
                    <div>
                      <p className={fieldLabelClass(isLight)}>Technologies</p>
                      {editMode ? (
                        <EditableBulletList
                          items={technologies ?? []}
                          onChange={(v) => onMyCompanyChange?.('technologies', v)}
                          addPlaceholder="Add technology…"
                          light={isLight}
                        />
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(technologies ?? []).map((t, i) => (
                            <Tag key={i} label={shortLabel(t)} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </SubSection>
            ) : null;

            const valuePropsSection = (hasValueProps || editMode) ? (
              <SubSection key="valueProps" label="Value props" open={openSections.valueProps} onToggle={() => toggleSection('valueProps')} light={isLight}>
                {editMode ? (
                  <EditableBulletList
                    items={valuePropositions ?? []}
                    onChange={(v) => onMyCompanyChange?.('valuePropositions', v)}
                    addPlaceholder="Add value prop…"
                    light={isLight}
                  />
                ) : (
                  <BulletList items={valuePropositions!} />
                )}
              </SubSection>
            ) : null;

            const socialSection = (hasSocial || editMode) ? (
              <SubSection key="social" label="Social" open={openSections.social} onToggle={() => toggleSection('social')} light={isLight}>
                {editMode ? (
                  <div className="space-y-2.5">
                    <div>
                      <p className={fieldLabelClass(isLight)}>LinkedIn URL</p>
                      <input type="url" value={linkedinUrl ?? ''} placeholder="https://linkedin.com/company/…"
                        onChange={(e) => onMyCompanyChange?.('linkedinUrl', e.target.value || undefined)}
                        className={inputCls} />
                    </div>
                    <div>
                      <p className={fieldLabelClass(isLight)}>LinkedIn followers</p>
                      <input type="number" min={0} value={followerCount ?? ''} placeholder="e.g. 12000"
                        onChange={(e) => onMyCompanyChange?.('followerCount', e.target.value ? Number(e.target.value) : undefined)}
                        className={inputCls} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {followerCount != null && (
                      <Stat
                        label="LinkedIn followers"
                        value={String(followerCount)}
                      />
                    )}
                    {linkedinUrl && (
                      <div>
                        <p className="text-xs text-white/40">LinkedIn</p>
                        <a href={linkedinUrl} target="_blank" rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline break-all">
                          {linkedinUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </SubSection>
            ) : null;

            if (columns === 3) {
              const col1 = [aboutSection, firmographicsSection].filter(Boolean);
              const col2 = [customersSection, competitorsSection].filter(Boolean);
              const col3 = [productsSection, valuePropsSection, socialSection].filter(Boolean);
              if (!col1.length && !col2.length && !col3.length) return null;
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                  <div className="space-y-2">{col1}</div>
                  <div className="space-y-2">{col2}</div>
                  <div className="space-y-2">{col3}</div>
                </div>
              );
            }

            if (columns === 2) {
              const leftSections = [aboutSection, firmographicsSection, competitorsSection, valuePropsSection].filter(Boolean);
              const rightSections = [customersSection, productsSection, socialSection].filter(Boolean);
              if (!leftSections.length && !rightSections.length) return null;
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                  <div className="space-y-2">{leftSections}</div>
                  <div className="space-y-2">{rightSections}</div>
                </div>
              );
            }

            return (
              <>
                {aboutSection}
                {firmographicsSection}
                {customersSection}
                {competitorsSection}
                {productsSection}
                {valuePropsSection}
                {socialSection}
              </>
            );
          })()}

          {/* Edit / Save / Delete actions */}
          {(onEdit || onSave || onDelete) && (
            <div className="border-t border-white/10 pt-2 mt-1">
              {confirmingDelete ? (
                <div className="space-y-2">
                  <p className="text-xs text-white/60">Delete your company profile? This can't be undone.</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setConfirmingDelete(false); onDelete?.(); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : editMode ? (
                <div className="flex items-center gap-2">
                  {onSave && (
                    <button
                      type="button"
                      onClick={onSave}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-arcova-teal/85"
                    >
                      <Save className="h-3 w-3" />
                      Save
                    </button>
                  )}
                  {onCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={onEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  )}
                  {onReenrich && (
                    <button
                      type="button"
                      onClick={onReenrich}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Re-enrich
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-400/70 transition-colors hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </>
  );

  if (isLight) return inner;

  return (
    <CardShell icon={Building2} label="Your company" status={status} collapsed={collapsed} onToggle={onToggle}>
      {inner}
    </CardShell>
  );
}

// ── Card 2 — Target companies ──────────────────────────────────────────────

const COMPANY_CHIP_PHASES = new Set([
  'company_type', 'company_size', 'company_ta', 'company_modality',
  'company_stage', 'company_funding',
]);

function TargetCard({
  status,
  phase,
  reviewedCompanyName,
  enrichedTargetCompany,
  savedIcpName,
  panelCompany,
  chipSel,
  icpEditMode = false,
  onIcpEdit,
  onIcpSave,
  onIcpCancel,
  onIcpReenrich,
  onIcpDelete,
  onIcpFieldChange,
  collapsed,
  onToggle,
  showSignalPills = true,
}: {
  status: CardStatus;
  phase: string;
  reviewedCompanyName: string;
  enrichedTargetCompany?: PanelTargetCompanyData | null;
  savedIcpName: string;
  panelCompany: PanelCompanyData;
  chipSel: string[];
  icpEditMode?: boolean;
  onIcpEdit?: () => void;
  onIcpSave?: () => void;
  onIcpCancel?: () => void;
  onIcpReenrich?: () => void;
  onIcpDelete?: () => void;
  onIcpFieldChange?: (field: string, value: IcpChangeValue) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  showSignalPills?: boolean;
}) {
  const [modelledOnOpen, setModelledOnOpen] = useState(false);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const e = enrichedTargetCompany;

  useEffect(() => {
    if (icpEditMode) setModelledOnOpen(false);
  }, [icpEditMode]);

  // ICP taxonomy — prefer confirmed panelCompany, fall back to chipSel while the chip phase is active
  const typeVal = panelCompany.companyType ? [panelCompany.companyType] : (phase === 'company_type' ? chipSel : []);
  const currentCompanyType = panelCompany.companyType || (phase === 'company_type' ? chipSel[0] ?? '' : '');
  const platformVal = isSaasCompanyType(currentCompanyType) ? panelCompany.platformCategory.trim() : '';
  const sizesVal = panelCompany.companySizes.length ? panelCompany.companySizes : (phase === 'company_size' ? chipSel : []);
  const liFollowerSizesVal = panelCompany.liFollowerSizes?.length ? panelCompany.liFollowerSizes : (phase === 'company_li_followers' ? chipSel : []);
  const taVal = panelCompany.therapeuticAreas.length ? panelCompany.therapeuticAreas : (phase === 'company_ta' ? chipSel : []);
  const modalVal = panelCompany.modalities.length ? panelCompany.modalities : (phase === 'company_modality' ? chipSel : []);
  const stageVal = panelCompany.developmentStages.length ? panelCompany.developmentStages : (phase === 'company_stage' ? chipSel : []);
  const fundingVal = panelCompany.fundingStages.length ? panelCompany.fundingStages : (phase === 'company_funding' ? chipSel : []);
  const signalVal = panelCompany.signals ?? [];

  const hasIcpData = typeVal.length > 0 || !!platformVal || taVal.length > 0 || modalVal.length > 0;
  const showIcpProfile = !!(savedIcpName || hasIcpData) && (status === 'building' || status === 'complete');

  const hasCompetitors = icpEditMode || panelCompany.competitors.length > 0;
  const hasModelledOnNarrative = !!(
    e?.description?.[0] ||
    e?.customers_we_serve?.length ||
    e?.value_propositions?.length ||
    e?.linkedin_url
  );
  const hasModelledOnFirmographics = !!(
    e?.employee_count ||
    e?.employee_range ||
    e?.hq_city ||
    e?.follower_count != null ||
    e?.funding_status_label ||
    e?.funding_stage ||
    e?.total_funding_usd != null ||
    e?.funding_resolution_summary ||
    e?.company_status
  );
  const modelledOnFundingStatus =
    e?.funding_status_label?.trim() || (e?.company_status ? extractFundingStatus(e.company_status) : null);
  const referenceCustomerSegments = resolveCustomerSegments({
    targetCustomers: e?.target_customers ?? [],
    customersWeServe: e?.customers_we_serve ?? [],
    fallbackItems: e?.customers_we_serve ?? [],
  });
  // ICP segments come from panelCompany (first-class fields), not from the reference snapshot.
  const icpCustomerSegments = {
    customerOrganizations: panelCompany.targetCustomers,
    buyerTypes: panelCompany.buyerTypes,
  };

  const displayDomain = e?.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  return (
    <CardShell icon={Briefcase} label="Target companies" status={status} collapsed={collapsed} onToggle={onToggle}>
      {status === 'pending' && (
        <p className="text-xs text-white/30">Your target company profile will appear here.</p>
      )}

      {status === 'building' && !showIcpProfile && (
        <p className="text-xs text-white/40">
          {reviewedCompanyName
            ? `Building profile based on ${reviewedCompanyName}…`
            : 'Enter a customer URL to start building this profile.'}
        </p>
      )}

      {showIcpProfile && (
        <div className="space-y-2">

          {/* Modelled on — reference account (compact toggle) */}
          {e?.company_name && (
            <div className="space-y-2">
              <button
                type="button"
                disabled={icpEditMode}
                onClick={() => !icpEditMode && setModelledOnOpen((v) => !v)}
                aria-expanded={modelledOnOpen}
                className="group flex w-full items-start gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-arcova-teal/35 disabled:cursor-not-allowed disabled:opacity-100"
              >
                <ChevronDown
                  className={`mt-0.5 h-4 w-4 shrink-0 text-white/60 transition-transform duration-200 group-hover:text-white/75 ${modelledOnOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    Modelled on {e.company_name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-white/70">
                    {icpEditMode
                      ? 'Reference snapshot is read-only during edit — Cancel to expand.'
                      : modelledOnOpen
                         ? 'Click to hide'
                         : 'Click to see reference account enrichment'}
                  </span>
                </span>
              </button>

              {modelledOnOpen && (
                <div className="rounded-lg bg-white/[0.04] border border-white/10 p-2 space-y-2">
                  {displayDomain && (
                    <a href={e.website!} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline">
                      {displayDomain}
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                    </a>
                  )}
                  {e.tagline && <p className="text-xs italic text-white/40 leading-snug">{e.tagline}</p>}
                  {e.description?.[0] && (
                    <p className="text-xs text-white/60 leading-snug">{e.description[0]}</p>
                  )}
                  {hasModelledOnFirmographics && (
                    <div className="space-y-1.5 pt-0.5">
                      <p className="text-xs text-white/35">Firmographics</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        {(e.employee_count || e.employee_range) && (
                          <Stat label="Employees" value={e.employee_count ? e.employee_count.toLocaleString() : e.employee_range!} />
                        )}
                        {e.hq_city && <Stat label="HQ" value={e.hq_city} subValue={e.hq_country ?? undefined} />}
                        {e.follower_count != null && (
                          <Stat label="LinkedIn followers" value={e.follower_count.toLocaleString()} />
                        )}
                        {modelledOnFundingStatus && <Stat label="Funding status" value={modelledOnFundingStatus} />}
                        {e.funding_stage && <Stat label="Funding stage" value={e.funding_stage} />}
                        {e.total_funding_usd != null && (
                          <Stat label="Total funding" value={formatCurrencyShort(e.total_funding_usd)} />
                        )}
                      </div>
                      {(e.funding_resolution_summary || e.company_status) && (
                        <div>
                          <p className="mb-1 text-xs text-white/35">Funding summary</p>
                          <p className="text-xs leading-snug text-white/55">{e.funding_resolution_summary ?? e.company_status}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {hasModelledOnNarrative && (
                    <div className="space-y-1.5 pt-0.5">
                      {(referenceCustomerSegments.customerOrganizations.length > 0 || referenceCustomerSegments.buyerTypes.length > 0) && (
                        <div className="space-y-1.5">
                          <FieldRow label="Customer organisations" tags={referenceCustomerSegments.customerOrganizations} />
                          <FieldRow label="Buyer / user types" tags={referenceCustomerSegments.buyerTypes} />
                        </div>
                      )}
                      {(e.value_propositions?.length ?? 0) > 0 && (
                        <div>
                          <p className="mb-1 text-xs text-white/35">Value props</p>
                          <BulletList items={e.value_propositions!.slice(0, 3)} />
                        </div>
                      )}
                      {e.linkedin_url && (
                        <div className="space-y-1">
                          <a href={e.linkedin_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline break-all">
                            {e.linkedin_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ICP profile name */}
          {icpEditMode ? (
            <input
              type="text"
              value={savedIcpName}
              onChange={(ev) => onIcpFieldChange?.('icpName', ev.target.value)}
              className={EDIT_INPUT}
              placeholder="Profile name"
            />
          ) : (
            savedIcpName && (
              <p className="text-sm font-semibold text-white leading-tight">{savedIcpName}</p>
            )
          )}

          {/* ICP taxonomy chips */}
          <div className="border-t border-white/10 pt-2 mt-0.5 space-y-2">

            {/* Company type */}
            {(typeVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Company type</p>
                {typeVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {typeVal.map((t) => (
                      <Tag key={t} label={t}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('companyType', '') : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && typeVal.length === 0 && (
                  <AddTagSelect
                    options={COMPANY_TYPE_OPTIONS.map((o) => o.value)}
                    selected={[]}
                    onAdd={(v) => onIcpFieldChange?.('companyType', v)}
                    placeholder="Select company type…"
                  />
                )}
              </div>
            )}

            {isSaasCompanyType(currentCompanyType) && (platformVal || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Platform category</p>
                {icpEditMode ? (
                  <input
                    type="text"
                    value={platformVal}
                    onChange={(e) => onIcpFieldChange?.('platformCategory', e.target.value)}
                    placeholder="e.g. Sales Intelligence Platform"
                    maxLength={48}
                    className={EDIT_INPUT}
                  />
                ) : platformVal ? (
                  <Tag label={platformVal} />
                ) : null}
              </div>
            )}

            {/* Therapeutic areas */}
            {(taVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Therapeutic areas</p>
                {taVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {taVal.map((t) => (
                      <Tag key={t} label={t}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('therapeuticAreas', taVal.filter((x) => x !== t)) : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && (
                  <AddTagSelect
                    options={THERAPEUTIC_AREA_OPTIONS as unknown as string[]}
                    selected={taVal}
                    onAdd={(v) => onIcpFieldChange?.('therapeuticAreas', [...taVal, v])}
                    placeholder="Add therapeutic area…"
                  />
                )}
              </div>
            )}

            {/* Modalities */}
            {(modalVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Modalities</p>
                {modalVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {modalVal.map((m) => (
                      <Tag key={m} label={m}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('modalities', modalVal.filter((x) => x !== m)) : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && (
                  <AddTagSelect
                    options={MODALITY_OPTIONS as unknown as string[]}
                    selected={modalVal}
                    onAdd={(v) => onIcpFieldChange?.('modalities', [...modalVal, v])}
                    placeholder="Add modality…"
                  />
                )}
              </div>
            )}

            {/* Development stages */}
            {(stageVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Development stages</p>
                {stageVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {stageVal.map((s) => (
                      <Tag key={s} label={s}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('developmentStages', stageVal.filter((x) => x !== s)) : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && (
                  <AddTagSelect
                    options={DEVELOPMENT_STAGE_OPTIONS as unknown as string[]}
                    selected={stageVal}
                    onAdd={(v) => onIcpFieldChange?.('developmentStages', [...stageVal, v])}
                    placeholder="Add stage…"
                  />
                )}
              </div>
            )}

            {/* Company sizes */}
            {(sizesVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Company size</p>
                {sizesVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {sizesVal.map((s) => (
                      <Tag key={s} label={s}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('companySizes', sizesVal.filter((x) => x !== s)) : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && (
                  <AddTagSelect
                    options={COMPANY_SIZE_OPTIONS as unknown as string[]}
                    selected={sizesVal}
                    onAdd={(v) => onIcpFieldChange?.('companySizes', [...sizesVal, v])}
                    placeholder="Add size band…"
                  />
                )}
              </div>
            )}

            {/* LI follower sizes */}
            {(liFollowerSizesVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">LinkedIn follower base</p>
                {liFollowerSizesVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {liFollowerSizesVal.map((s) => (
                      <Tag key={s} label={s}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('liFollowerSizes', liFollowerSizesVal.filter((x) => x !== s)) : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && (
                  <AddTagSelect
                    options={LI_FOLLOWER_OPTIONS as unknown as string[]}
                    selected={liFollowerSizesVal}
                    onAdd={(v) => onIcpFieldChange?.('liFollowerSizes', [...liFollowerSizesVal, v])}
                    placeholder="Add follower band…"
                  />
                )}
              </div>
            )}

            {/* Funding stages */}
            {(fundingVal.length > 0 || icpEditMode) && (
              <div>
                <p className="mb-1 text-xs text-white/40">Funding stage</p>
                {fundingVal.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {fundingVal.map((f) => (
                      <Tag key={f} label={f}
                        onRemove={icpEditMode ? () => onIcpFieldChange?.('fundingStages', fundingVal.filter((x) => x !== f)) : undefined}
                      />
                    ))}
                  </div>
                )}
                {icpEditMode && (
                  <AddTagSelect
                    options={FUNDING_STAGE_OPTIONS as unknown as string[]}
                    selected={fundingVal}
                    onAdd={(v) => onIcpFieldChange?.('fundingStages', [...fundingVal, v])}
                    placeholder="Add funding stage…"
                  />
                )}
              </div>
            )}

            {showSignalPills && signalVal.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-white/40">Company signals</p>
                <div className="flex flex-wrap gap-1">
                  {signalVal.map((signalId) => (
                    <Tag key={signalId} label={getSignalDisplayName(signalId)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {(icpCustomerSegments.customerOrganizations.length > 0 || icpCustomerSegments.buyerTypes.length > 0 || icpEditMode) && (
            <div className="border-t border-white/10 pt-2 mt-0.5 space-y-1.5">
              <p className="text-xs text-white/40">Customer segments</p>
              {icpEditMode ? (
                <div className="space-y-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-white/40">Sells to companies like</p>
                    <EditableTagList
                      items={icpCustomerSegments.customerOrganizations}
                      onChange={(items) => onIcpFieldChange?.('targetCustomers', items)}
                      addPlaceholder="Add company segment…"
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-white/40">Sells to people like</p>
                    <EditableTagList
                      items={icpCustomerSegments.buyerTypes}
                      onChange={(items) => onIcpFieldChange?.('customersWeServe', items)}
                      addPlaceholder="Add buyer or team segment…"
                    />
                  </div>
                </div>
              ) : (
                <>
                  {icpCustomerSegments.customerOrganizations.length > 0 && (
                    <FieldRow label="Sells to companies like" tags={icpCustomerSegments.customerOrganizations} />
                  )}
                  {icpCustomerSegments.buyerTypes.length > 0 && (
                    <FieldRow label="Sells to people like" tags={icpCustomerSegments.buyerTypes} />
                  )}
                </>
              )}
            </div>
          )}

          {/* Competitors */}
          {hasCompetitors && (
            <div className="border-t border-white/10 pt-2 mt-0.5 space-y-1">
              <p className="text-xs text-white/40">Competitors</p>
              <div className="space-y-1.5">
                {panelCompany.competitors.map((c, i) => (
                  <div key={`${c.name}-${i}`} className="flex items-center gap-1.5">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      {c.url ? (
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 items-center gap-1 text-xs font-medium text-arcova-teal hover:underline"
                        >
                          <span className="truncate">{c.name}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      ) : (
                        <p className="truncate text-xs font-medium text-white/80">{c.name}</p>
                      )}
                    </div>
                    {icpEditMode && onIcpFieldChange && (
                      <button
                        type="button"
                        onClick={() =>
                          onIcpFieldChange(
                            'competitors',
                            panelCompany.competitors.filter((_, j) => j !== i),
                          )}
                        className="shrink-0 text-white/25 transition-colors hover:text-white/60"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {icpEditMode && onIcpFieldChange && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="mt-0 h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
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
                        } catch { /* keep typed text as label */ }
                        onIcpFieldChange('competitors', [...panelCompany.competitors, { name, url }]);
                        setNewCompetitorUrl('');
                      }}
                      placeholder="Add competitor URL… (Enter)"
                      className="flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-arcova-teal/50"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Edit / Re-enrich / Delete — same pattern as My company card */}
          {(onIcpEdit || onIcpReenrich || onIcpDelete) && (
            <div className="border-t border-white/10 pt-2 mt-1">
              {confirmingDelete ? (
                <div className="space-y-2">
                  <p className="text-xs text-white/60">Delete this target company profile? This can't be undone.</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setConfirmingDelete(false); onIcpDelete?.(); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/80 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : icpEditMode ? (
                <div className="flex items-center gap-2">
                  {onIcpSave && (
                    <button
                      type="button"
                      onClick={onIcpSave}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-arcova-teal/85"
                    >
                      <Save className="h-3 w-3" />
                      Save
                    </button>
                  )}
                  {onIcpCancel && (
                    <button
                      type="button"
                      onClick={onIcpCancel}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {onIcpEdit && (
                    <button
                      type="button"
                      onClick={onIcpEdit}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  )}
                  {onIcpReenrich && (
                    <button
                      type="button"
                      onClick={onIcpReenrich}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Re-enrich
                    </button>
                  )}
                  {onIcpDelete && (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-medium text-red-400/70 transition-colors hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </CardShell>
  );
}

// ── Card 3 — Buying team ───────────────────────────────────────────────────

function CollapsibleChipGroup({
  label,
  all,
  selected,
  onToggle,
}: {
  label: string;
  all: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const unselected = all.filter((o) => !selected.includes(o));

  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/50">{label}</p>
      <div className="flex flex-wrap gap-1">
        {selected.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className="rounded-full bg-arcova-teal/15 px-2.5 py-0.5 text-xs font-medium text-arcova-teal transition-colors hover:bg-arcova-teal/25"
          >
            {o}
          </button>
        ))}
        {!expanded && unselected.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs font-medium text-white/50 transition-colors hover:border-white/40 hover:text-white/70"
          >
            + {unselected.length} more
          </button>
        )}
        {expanded && unselected.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => { onToggle(o); }}
            className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/15"
          >
            {o}
          </button>
        ))}
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-full px-2.5 py-0.5 text-xs font-medium text-white/30 transition-colors hover:text-white/50"
          >
            Less
          </button>
        )}
      </div>
    </div>
  );
}

function BuyingTeamCard({
  status,
  phase,
  panelPersona,
  chipSel,
  collapsed,
  onToggle,
  editMode = false,
  onEdit,
  onCancelEdit,
  onConfirmEdit,
  onToggleFn,
  onToggleSeniority,
  exampleCompany,
  icpName,
  showSignalPills = true,
}: {
  status: CardStatus;
  phase: string;
  panelPersona: PanelPersonaData;
  chipSel: string[];
  collapsed?: boolean;
  onToggle?: () => void;
  editMode?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  /** Persists edits and completes setup — same behaviour as chat "Looks right →". */
  onConfirmEdit?: () => void;
  onToggleFn?: (v: string) => void;
  onToggleSeniority?: (v: string) => void;
  exampleCompany?: string;
  icpName?: string;
  showSignalPills?: boolean;
}) {
  const isReviewing = phase === 'buying_team_review' || editMode;
  const fnVal = panelPersona.functions.length ? panelPersona.functions : (phase === 'persona_functions' ? chipSel : []);
  const senVal = panelPersona.seniority.length ? panelPersona.seniority : (phase === 'persona_seniority' ? chipSel : []);
  const hasAny = fnVal.length > 0 || senVal.length > 0;

  return (
    <CardShell icon={Users} label="Buying teams" status={status} collapsed={collapsed} onToggle={onToggle}>
      {status === 'pending' && (
        <p className="text-xs text-white/30">Your buying teams will appear here.</p>
      )}

      {status === 'building' && !isReviewing && !hasAny && (
        <p className="text-xs text-white/40">Generating buying team suggestions…</p>
      )}

      {isReviewing && !editMode && hasAny && (
        <div className="space-y-3">
          {exampleCompany && (
            <p className="text-xs text-white/35">
              Suggested from your products and services, modelled on {exampleCompany}
              {icpName ? ` as a reference ${icpName.toLowerCase()}` : ' as a reference account'}.
            </p>
          )}
          <div className="space-y-2">
            <FieldRow label="Teams" tags={fnVal} />
            <FieldRow label="Seniority" tags={senVal} />
            {(panelPersona.jobTitles?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Example titles</p>
                <p className="text-xs leading-relaxed text-white/55">
                  {panelPersona.jobTitles!.join(' · ')}
                </p>
              </div>
            )}
            {showSignalPills && panelPersona.signals.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Contact signals</p>
                <div className="flex flex-wrap gap-1.5">
                  {panelPersona.signals.map((signalId) => (
                    <Tag key={signalId} label={getSignalDisplayName(signalId)} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-white/10 pt-2">
            <div className="flex items-center justify-between gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editMode && onToggleFn && onToggleSeniority && (
        <div className="space-y-4">
          {exampleCompany && (
            <p className="text-xs text-white/40">
              Suggested from your products and services, modelled on{' '}
              <span className="text-white/60">{exampleCompany}</span>
              {icpName ? ` as a reference ${icpName.toLowerCase()}` : ' as a reference account'}.
            </p>
          )}
          <CollapsibleChipGroup
            label="Teams"            all={BUSINESS_AREA_OPTIONS}
            selected={panelPersona.functions}
            onToggle={onToggleFn}
          />
          <CollapsibleChipGroup
            label="Seniority levels"
            all={SENIORITY_LEVEL_OPTIONS}
            selected={panelPersona.seniority}
            onToggle={onToggleSeniority}
          />
          {(panelPersona.jobTitles?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Example titles</p>
              <p className="text-xs leading-relaxed text-white/55">
                {panelPersona.jobTitles!.join(' · ')}
              </p>
            </div>
          )}
          {showSignalPills && panelPersona.signals.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Contact signals</p>
              <div className="flex flex-wrap gap-1.5">
                {panelPersona.signals.map((signalId) => (
                  <Tag key={signalId} label={getSignalDisplayName(signalId)} />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
            {onConfirmEdit && (
              <button
                type="button"
                onClick={onConfirmEdit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-arcova-teal/85"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
            )}
            <button type="button" onClick={onCancelEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/80">
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === 'complete' && !editMode && (
        <div className="space-y-3">
          {exampleCompany && (
            <p className="text-xs text-white/35">Modelled on {exampleCompany}</p>
          )}
          <div className="space-y-2">
            {panelPersona.functions.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Teams</p>
                <div className="flex flex-wrap gap-1.5">
                  {panelPersona.functions.map((f) => <Tag key={f} label={f} />)}
                </div>
              </div>
            )}
            {panelPersona.seniority.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Seniority</p>
                <div className="flex flex-wrap gap-1.5">
                  {panelPersona.seniority.map((s) => <Tag key={s} label={s} />)}
                </div>
              </div>
            )}
            {(panelPersona.jobTitles?.length ?? 0) > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Example titles</p>
                <p className="text-xs leading-relaxed text-white/55">
                  {panelPersona.jobTitles!.join(' · ')}
                </p>
              </div>
            )}
            {showSignalPills && panelPersona.signals.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Contact signals</p>
                <div className="flex flex-wrap gap-1.5">
                  {panelPersona.signals.map((signalId) => <Tag key={signalId} label={getSignalDisplayName(signalId)} />)}
                </div>
              </div>
            )}
          </div>
          <div className="border-t border-white/10 pt-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal px-3 py-1.5 text-xs font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/10"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>
        </div>
      )}
    </CardShell>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const TABS = [
  { label: 'Your company', icon: Building2 },
  { label: 'Target companies', icon: Briefcase },
  { label: 'Buying teams', icon: Users },
];

export default function SetupProfilePanel({
  phase,
  myCompany,
  analysisLoading,
  editMode,
  onMyCompanyChange,
  onEditCompany,
  onSaveEdit,
  onCancelEdit,
  onDeleteCompany,
  onReenrichCompany,
  reviewedCompanyName,
  enrichedTargetCompany,
  savedIcpName,
  panelCompany,
  chipSel,
  icpEditMode,
  onEditIcp,
  onSaveIcp,
  onCancelIcp,
  onReenrichIcp,
  onDeleteIcp,
  onIcpFieldChange,
  panelPersona,
  savedPersonaName,
  buyingTeamEditMode,
  onEditBuyingTeam,
  onCancelBuyingTeamEdit,
  onToggleBuyingTeamFn,
  onToggleBuyingTeamSeniority,
  onConfirmBuyingTeam,
  buyingTeamExampleCompany,
  buyingTeamIcpName,
  showSignalPills = true,
}: SetupProfilePanelProps) {
  const [activeTab, setActiveTab] = useState(0);

  // Start collapsed if we're already past that card (e.g. resuming mid-setup)
  const [collapsed, setCollapsed] = useState<Record<'c1' | 'c2' | 'c3', boolean>>(() => ({
    c1: ICP_BUILDING_PHASES.has(phase) || BUYING_BUILDING_PHASES.has(phase),
    c2: BUYING_BUILDING_PHASES.has(phase),
    c3: false,
  }));
  const toggle = (key: 'c1' | 'c2' | 'c3') =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  // Compute card statuses before effects so the refs/effects can reference them
  const hasCompany = !!myCompany.companyName;
  const hasIcp     = !!savedIcpName || !!panelCompany.companyType;
  const hasPersona = panelPersona.functions.length > 0 && !!savedPersonaName;

  const s1: CardStatus = hasCompany  ? 'complete' : phase === 'analysis_loading' ? 'building' : 'pending';
  const s2: CardStatus = hasIcp      ? 'complete' : ICP_BUILDING_PHASES.has(phase)    ? 'building' : 'pending';
  const s3: CardStatus = hasPersona  ? 'complete' : BUYING_BUILDING_PHASES.has(phase) ? 'building' : 'pending';

  const prevS2Ref = useRef(s2);
  const prevS3Ref = useRef(s3);

  // Auto-collapse the previous card when the next phase becomes active
  useEffect(() => {
    if (prevS2Ref.current !== 'building' && s2 === 'building') {
      setCollapsed((prev) => ({ ...prev, c1: true }));
    }
    prevS2Ref.current = s2;
  }, [s2]);

  useEffect(() => {
    if (prevS3Ref.current !== 'building' && s3 === 'building') {
      setCollapsed((prev) => ({ ...prev, c2: true }));
    }
    prevS3Ref.current = s3;
  }, [s3]);
  const allComplete = s1 === 'complete' && s2 === 'complete' && s3 === 'complete';

  const profileCard = (
    <ProfileCard
      status={s1}
      myCompany={myCompany}
      analysisLoading={analysisLoading}
      editMode={editMode}
      onMyCompanyChange={onMyCompanyChange}
      onEdit={onEditCompany}
      onSave={onSaveEdit}
      onCancel={onCancelEdit}
      onDelete={onDeleteCompany}
      onReenrich={onReenrichCompany}
      collapsed={s1 === 'complete' ? collapsed.c1 : undefined}
      onToggle={s1 === 'complete' ? () => toggle('c1') : undefined}
    />
  );

  const targetCard = (
    <TargetCard
      status={s2}
      phase={phase}
      reviewedCompanyName={reviewedCompanyName}
      enrichedTargetCompany={enrichedTargetCompany}
      savedIcpName={savedIcpName}
      panelCompany={panelCompany}
      chipSel={chipSel}
      icpEditMode={icpEditMode}
      onIcpEdit={onEditIcp}
      onIcpSave={onSaveIcp}
      onIcpCancel={onCancelIcp}
      onIcpReenrich={onReenrichIcp}
      onIcpDelete={onDeleteIcp}
      onIcpFieldChange={onIcpFieldChange}
      collapsed={s2 === 'complete' ? collapsed.c2 : undefined}
      onToggle={s2 === 'complete' ? () => toggle('c2') : undefined}
      showSignalPills={showSignalPills}
    />
  );

  const buyingCard = (
    <BuyingTeamCard
      status={s3}
      phase={phase}
      panelPersona={panelPersona}
      chipSel={chipSel}
      collapsed={s3 === 'complete' ? collapsed.c3 : undefined}
      onToggle={s3 === 'complete' ? () => toggle('c3') : undefined}
      editMode={buyingTeamEditMode}
      onEdit={onEditBuyingTeam}
      onCancelEdit={onCancelBuyingTeamEdit}
      onConfirmEdit={onConfirmBuyingTeam}
      onToggleFn={onToggleBuyingTeamFn}
      onToggleSeniority={onToggleBuyingTeamSeniority}
      exampleCompany={buyingTeamExampleCompany}
      icpName={buyingTeamIcpName}
      showSignalPills={showSignalPills}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {profileCard}
      {targetCard}
      {buyingCard}
    </div>
  );
}
