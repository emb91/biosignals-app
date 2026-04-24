'use client';

import React, { useState } from 'react';
import { Check, Building2, Briefcase, Users, ChevronDown, ChevronUp, ExternalLink, X, Pencil, Trash2, Save, RefreshCw } from 'lucide-react';
import {
  COMPANY_TYPE_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  MODALITY_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  BUSINESS_AREA_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
} from '@/lib/arcova-taxonomy';

// ── Types ──────────────────────────────────────────────────────────────────

type CardStatus = 'pending' | 'building' | 'complete';

export interface PanelCompanyData {
  companyType: string;
  companySizes: string[];
  therapeuticAreas: string[];
  modalities: string[];
  developmentStages: string[];
  fundingStages: string[];
}

export interface PanelPersonaData {
  functions: string[];
  seniority: string[];
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
  customers_we_serve?: string[] | null;
  value_propositions?: string[] | null;
  competitors_enriched?: CompetitorItem[] | null;
  company_status?: string | null;
  company_type?: string | null;
  company_type_display?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
  employee_count?: number | null;
  employee_range?: string | null;
  follower_count?: number | null;
  founded_year?: number | null;
  funding_stage?: string | null;
  total_funding_usd?: number | null;
  hq_city?: string | null;
  hq_country?: string | null;
  industry?: string | null;
}

export type MyCompanyChangeValue = string | string[] | number | CompetitorItem[] | undefined;

export type IcpChangeValue = string | string[];

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
  onToggleBuyingTeamFn?: (v: string) => void;
  onToggleBuyingTeamSeniority?: (v: string) => void;
  onConfirmBuyingTeam?: () => void;
  onDeletePersona?: () => void;
  onReenrichPersona?: () => void;
  buyingTeamExampleCompany?: string;
  buyingTeamIcpName?: string;
}

// ── Phase sets (building-only — complete is data-driven) ───────────────────

const ICP_BUILDING_PHASES = new Set([
  'customer_url_input', 'customer_url_loading', 'customer_url_review', 'company_select',
  'company_type', 'company_size', 'company_ta', 'company_modality',
  'company_stage', 'company_funding', 'company_saving',
]);

const BUYING_BUILDING_PHASES = new Set([
  'buying_team_loading', 'buying_team_review', 'persona_functions', 'persona_seniority',
]);

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrencyShort(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}

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

// ── Card 1 — Your company ──────────────────────────────────────────────────

function SubSection({
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
      open ? 'border border-white/10 bg-white/[0.06]' : 'bg-white/[0.18] hover:bg-white/[0.22]'
    }`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors"
      >
        <span className={`text-xs font-semibold ${open ? 'text-white/60' : 'text-white'}`}>{label}</span>
        {open
          ? <ChevronUp className="h-3 w-3 text-white/60 shrink-0" />
          : <ChevronDown className="h-3 w-3 text-white shrink-0" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
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
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addPlaceholder?: string;
}) {
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
            className={`flex-1 rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/80 placeholder:text-white/25 focus:outline-none focus:border-arcova-teal/50`}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="shrink-0 text-white/25 hover:text-white/60 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="text-xs text-white/30 hover:text-white/60 transition-colors flex items-center gap-1 pl-2.5"
      >
        <span className="text-base leading-none">+</span> {addPlaceholder}
      </button>
    </div>
  );
}

/** Extracts the short name from a verbose enrichment string like "Guardant360 CDx: FDA-approved…" → "Guardant360 CDx" */
function shortLabel(s: string): string {
  return s.split(/:\s|—|\.\s/)[0].trim();
}

function AddTagSelect({
  options,
  selected,
  onAdd,
  placeholder = 'Add…',
}: {
  options: string[];
  selected: string[];
  onAdd: (v: string) => void;
  placeholder?: string;
}) {
  const remaining = options.filter((o) => !selected.includes(o));
  if (remaining.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
      className="w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/40 focus:outline-none focus:border-arcova-teal/50 cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {remaining.map((o) => (
        <option key={o} value={o} className="bg-slate-900 text-white">{o}</option>
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

function ProfileCard({
  status,
  myCompany,
  analysisLoading,
  editMode = false,
  onMyCompanyChange,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onReenrich,
  collapsed,
  onToggle,
}: {
  status: CardStatus;
  myCompany: PanelMyCompanyData;
  analysisLoading: boolean;
  editMode?: boolean;
  onMyCompanyChange?: (field: keyof PanelMyCompanyData, value: MyCompanyChangeValue) => void;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onReenrich?: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    about: false,
    customers: false,
    valueProps: false,
    firmographics: false,
    social: false,
    competitors: false,
    products: false,
  });
  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Auto-open all sections when entering edit mode so the user can see what they're editing
  const prevEditMode = React.useRef(editMode);
  React.useEffect(() => {
    if (editMode && !prevEditMode.current) {
      setOpenSections({ about: true, customers: true, valueProps: true, firmographics: true, social: true, competitors: true, products: true });
    }
    prevEditMode.current = editMode;
  }, [editMode]);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const {
    companyName, website, logoUrl, tagline, linkedinUrl,
    description, customersWeServe, valuePropositions, goodFit, badFit,
    companyType, companyTypeDisplay, companyStatus, competitorsEnriched,
    therapeuticAreas, modalities, developmentStages,
    productsServices, services, technologies,
    employeeCount, employeeRange, followerCount, foundedYear,
    fundingStage, totalFundingUsd, hqCity, hqCountry,
  } = myCompany;

  const displayDomain = website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  const hasAbout = !!description?.[0] || !!companyType || (therapeuticAreas?.length ?? 0) > 0 || (modalities?.length ?? 0) > 0;
  const hasCustomers = (customersWeServe?.length ?? 0) > 0 || (goodFit?.length ?? 0) > 0 || (badFit?.length ?? 0) > 0;
  const hasValueProps = (valuePropositions?.length ?? 0) > 0;
  const hasFirmographics = !!(employeeCount || employeeRange || foundedYear || hqCity || fundingStage || totalFundingUsd != null || companyStatus);
  const hasSocial = !!(followerCount != null || linkedinUrl);

  return (
    <CardShell icon={Building2} label="Your company" status={status} collapsed={collapsed} onToggle={onToggle}>
      {status === 'pending' && (
        <p className="text-xs text-white/30">Your company profile will appear here.</p>
      )}

      {status === 'building' && analysisLoading && (
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1">
            {[0, 150, 300].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/60"
                style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
          <span className="text-xs text-white/50">Analysing your website…</span>
        </div>
      )}

      {status !== 'pending' && !analysisLoading && (
        <div className="space-y-2">

          {/* Always-visible header — logo + name + domain + tagline */}
          {(companyName || website) && (
            <div className="flex items-start gap-2.5 pb-1">
              {logoUrl && (
                <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain bg-white/10 p-0.5" />
              )}
              <div className="min-w-0">
                {companyName && <p className="text-sm font-semibold text-white leading-tight">{companyName}</p>}
                {displayDomain && (
                  <a href={website} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline mt-0.5">
                    {displayDomain}
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  </a>
                )}
                {tagline && <p className="mt-1 text-xs italic text-white/40 leading-snug line-clamp-1">{tagline}</p>}
              </div>
            </div>
          )}

          {/* About — description + company type + TA + modalities */}
          {(hasAbout || editMode) && (
            <SubSection label="About" open={openSections.about} onToggle={() => toggleSection('about')}>
              {(description?.[0] || editMode) && (
                editMode ? (
                  <textarea
                    value={description?.[0] ?? ''}
                    onChange={(e) => onMyCompanyChange?.('description', [e.target.value])}
                    rows={3}
                    placeholder="Short description…"
                    className={`${EDIT_INPUT} resize-none leading-snug`}
                  />
                ) : (
                  <p className="text-xs text-white/70 leading-snug">{description![0]}</p>
                )
              )}
              {(companyType || editMode) && (
                <div>
                  <p className="mb-1 text-xs text-white/40">Company type</p>
                  {editMode ? (
                    <select
                      value={companyType ?? ''}
                      onChange={(e) => onMyCompanyChange?.('companyType', e.target.value || undefined)}
                      className="w-full rounded-lg bg-white/[0.06] border border-white/15 px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-arcova-teal/50 cursor-pointer"
                    >
                      <option value="" className="bg-slate-900 text-white/40">Select type…</option>
                      {COMPANY_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} className="bg-slate-900 text-white">{o.value}</option>
                      ))}
                    </select>
                  ) : companyType ? (
                    <Tag label={companyType} />
                  ) : null}
                </div>
              )}
              {((therapeuticAreas?.length ?? 0) > 0 || editMode) && (
                <div>
                  <p className="mb-1 text-xs text-white/40">Therapeutic areas</p>
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
                    />
                  )}
                </div>
              )}
              {((modalities?.length ?? 0) > 0 || editMode) && (
                <div>
                  <p className="mb-1 text-xs text-white/40">Modalities</p>
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
                    />
                  )}
                </div>
              )}
              {((developmentStages?.length ?? 0) > 0 || editMode) && (
                <div>
                  <p className="mb-1 text-xs text-white/40">Development stages</p>
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
                    />
                  )}
                </div>
              )}
            </SubSection>
          )}

          {/* Firmographics */}
          {(hasFirmographics || editMode) && (
            <SubSection label="Firmographics" open={openSections.firmographics} onToggle={() => toggleSection('firmographics')}>
              {editMode ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <div>
                    <p className="mb-1 text-xs text-white/40">Employees</p>
                    <input type="number" min={0} value={employeeCount ?? ''} placeholder={employeeRange ?? '—'}
                      onChange={(e) => onMyCompanyChange?.('employeeCount', e.target.value ? Number(e.target.value) : undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-white/40">Founded</p>
                    <input type="number" min={1800} max={2100} value={foundedYear ?? ''} placeholder="Year"
                      onChange={(e) => onMyCompanyChange?.('foundedYear', e.target.value ? Number(e.target.value) : undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-white/40">HQ city</p>
                    <input type="text" value={hqCity ?? ''} placeholder="City"
                      onChange={(e) => onMyCompanyChange?.('hqCity', e.target.value || undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-white/40">HQ country</p>
                    <input type="text" value={hqCountry ?? ''} placeholder="Country"
                      onChange={(e) => onMyCompanyChange?.('hqCountry', e.target.value || undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-white/40">Status</p>
                    <input type="text" value={companyStatus ?? ''} placeholder="e.g. Private"
                      onChange={(e) => onMyCompanyChange?.('companyStatus', e.target.value || undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-white/40">Funding stage</p>
                    <input type="text" value={fundingStage ?? ''} placeholder="e.g. Series B"
                      onChange={(e) => onMyCompanyChange?.('fundingStage', e.target.value || undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div className="col-span-2">
                    <p className="mb-1 text-xs text-white/40">Total funding (USD)</p>
                    <input type="number" min={0} value={totalFundingUsd ?? ''} placeholder="e.g. 50000000"
                      onChange={(e) => onMyCompanyChange?.('totalFundingUsd', e.target.value ? Number(e.target.value) : undefined)}
                      className={EDIT_INPUT} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
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
          )}

          {/* Our customers — pills + good/bad fit */}
          {hasCustomers && (
            <SubSection label="Customers" open={openSections.customers} onToggle={() => toggleSection('customers')}>
              {(customersWeServe?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1">
                  {customersWeServe!.map((c, i) => (
                    <Tag key={i} label={c}
                      onRemove={editMode ? () => onMyCompanyChange?.('customersWeServe', customersWeServe!.filter((_, j) => j !== i)) : undefined}
                    />
                  ))}
                </div>
              )}
              {((goodFit?.length ?? 0) > 0 || (badFit?.length ?? 0) > 0 || editMode) && (
                <div className="space-y-2 border-t border-white/10 pt-2 mt-1">
                  {((goodFit?.length ?? 0) > 0 || editMode) && (
                    <div>
                      <p className="mb-1 text-xs text-white/40">Good fit</p>
                      {editMode ? (
                        <EditableBulletList
                          items={goodFit ?? []}
                          onChange={(v) => onMyCompanyChange?.('goodFit', v)}
                          addPlaceholder="Add good fit…"
                        />
                      ) : (
                        <BulletList items={goodFit!} />
                      )}
                    </div>
                  )}
                  {((badFit?.length ?? 0) > 0 || editMode) && (
                    <div>
                      <p className="mb-1 text-xs text-white/40">Not a fit</p>
                      {editMode ? (
                        <EditableBulletList
                          items={badFit ?? []}
                          onChange={(v) => onMyCompanyChange?.('badFit', v)}
                          addPlaceholder="Add not a fit…"
                        />
                      ) : (
                        <BulletList items={badFit!} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </SubSection>
          )}

          {/* Competitors */}
          {(competitorsEnriched?.length ?? 0) > 0 && (
            <SubSection label="Competitors" open={openSections.competitors} onToggle={() => toggleSection('competitors')}>
              <div className="space-y-1.5">
                {competitorsEnriched!.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer"
                        className="flex flex-1 items-center gap-1 text-xs font-medium text-arcova-teal hover:underline min-w-0">
                        <span className="truncate">{c.name}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    ) : (
                      <p className="flex-1 text-xs font-medium text-white/80 truncate">{c.name}</p>
                    )}
                    {editMode && (
                      <button type="button"
                        onClick={() => onMyCompanyChange?.('competitorsEnriched', competitorsEnriched!.filter((_, j) => j !== i))}
                        className="shrink-0 text-white/25 hover:text-white/60 transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </SubSection>
          )}

          {/* Products, Services & Tech — merged section */}
          {((productsServices?.length ?? 0) > 0 || (services?.length ?? 0) > 0 || (technologies?.length ?? 0) > 0 || editMode) && (
            <SubSection label="Products, Services, Tech" open={openSections.products} onToggle={() => toggleSection('products')}>
              <div className="space-y-2.5">
                {((productsServices?.length ?? 0) > 0 || editMode) && (
                  <div>
                    <p className="mb-1 text-xs text-white/40">Products</p>
                    <div className="flex flex-wrap gap-1">
                      {(productsServices ?? []).map((p, i) => (
                        <Tag key={i} label={shortLabel(p)}
                          onRemove={editMode ? () => onMyCompanyChange?.('productsServices', productsServices!.filter((_, j) => j !== i)) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {((services?.length ?? 0) > 0 || editMode) && (
                  <div>
                    <p className="mb-1 text-xs text-white/40">Services</p>
                    <div className="flex flex-wrap gap-1">
                      {(services ?? []).map((s, i) => (
                        <Tag key={i} label={shortLabel(s)}
                          onRemove={editMode ? () => onMyCompanyChange?.('services', services!.filter((_, j) => j !== i)) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {((technologies?.length ?? 0) > 0 || editMode) && (
                  <div>
                    <p className="mb-1 text-xs text-white/40">Technologies</p>
                    <div className="flex flex-wrap gap-1">
                      {(technologies ?? []).map((t, i) => (
                        <Tag key={i} label={shortLabel(t)}
                          onRemove={editMode ? () => onMyCompanyChange?.('technologies', technologies!.filter((_, j) => j !== i)) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SubSection>
          )}

          {/* Value propositions */}
          {(hasValueProps || editMode) && (
            <SubSection label="Value props" open={openSections.valueProps} onToggle={() => toggleSection('valueProps')}>
              {editMode ? (
                <EditableBulletList
                  items={valuePropositions ?? []}
                  onChange={(v) => onMyCompanyChange?.('valuePropositions', v)}
                  addPlaceholder="Add value prop…"
                />
              ) : (
                <BulletList items={valuePropositions!} />
              )}
            </SubSection>
          )}

          {/* Social */}
          {(hasSocial || editMode) && (
            <SubSection label="Social" open={openSections.social} onToggle={() => toggleSection('social')}>
              {editMode ? (
                <div className="space-y-2.5">
                  <div>
                    <p className="mb-1 text-xs text-white/40">LinkedIn URL</p>
                    <input type="url" value={linkedinUrl ?? ''} placeholder="https://linkedin.com/company/…"
                      onChange={(e) => onMyCompanyChange?.('linkedinUrl', e.target.value || undefined)}
                      className={EDIT_INPUT} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-white/40">LinkedIn followers</p>
                    <input type="number" min={0} value={followerCount ?? ''} placeholder="e.g. 12000"
                      onChange={(e) => onMyCompanyChange?.('followerCount', e.target.value ? Number(e.target.value) : undefined)}
                      className={EDIT_INPUT} />
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {followerCount != null && (
                    <Stat label="LinkedIn followers" value={followerCount.toLocaleString()} />
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
          )}

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
}) {
  const [modelledOnOpen, setModelledOnOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const e = enrichedTargetCompany;

  // ICP taxonomy — prefer confirmed panelCompany, fall back to chipSel while the chip phase is active
  const typeVal = panelCompany.companyType ? [panelCompany.companyType] : (phase === 'company_type' ? chipSel : []);
  const sizesVal = panelCompany.companySizes.length ? panelCompany.companySizes : (phase === 'company_size' ? chipSel : []);
  const taVal = panelCompany.therapeuticAreas.length ? panelCompany.therapeuticAreas : (phase === 'company_ta' ? chipSel : []);
  const modalVal = panelCompany.modalities.length ? panelCompany.modalities : (phase === 'company_modality' ? chipSel : []);
  const stageVal = panelCompany.developmentStages.length ? panelCompany.developmentStages : (phase === 'company_stage' ? chipSel : []);
  const fundingVal = panelCompany.fundingStages.length ? panelCompany.fundingStages : (phase === 'company_funding' ? chipSel : []);

  const hasIcpData = typeVal.length > 0 || taVal.length > 0 || modalVal.length > 0;
  const showIcpProfile = !!(savedIcpName || hasIcpData) && (status === 'building' || status === 'complete');

  const hasCompetitors = (e?.competitors_enriched?.length ?? 0) > 0;
  const hasFirmographics = !!(e?.employee_count || e?.employee_range || e?.founded_year || e?.hq_city || e?.funding_stage || e?.total_funding_usd != null || e?.company_status);
  const hasModelledOnDetails = !!(e?.description?.[0] || e?.customers_we_serve?.length || e?.value_propositions?.length || e?.follower_count != null || e?.linkedin_url);

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

          {/* Modelled on — attribution + expandable enrichment details */}
          {e?.company_name && (
            <div>
              <button
                type="button"
                onClick={() => setModelledOnOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-white/45 hover:text-white/75 transition-colors"
              >
                  <span>Modelled on {e.company_name}</span>
                {modelledOnOpen ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />}
              </button>

              {modelledOnOpen && (
                <div className="mt-1.5 rounded-lg bg-white/[0.04] border border-white/10 p-2 space-y-2">
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
                  {hasModelledOnDetails && (
                    <div className="space-y-1.5 pt-0.5">
                      {(e.customers_we_serve?.length ?? 0) > 0 && (
                        <div>
                          <p className="mb-1 text-xs text-white/35">Customers</p>
                          <div className="flex flex-wrap gap-1">
                            {e.customers_we_serve!.map((c, i) => <Tag key={i} label={c} />)}
                          </div>
                        </div>
                      )}
                      {(e.value_propositions?.length ?? 0) > 0 && (
                        <div>
                          <p className="mb-1 text-xs text-white/35">Value props</p>
                          <BulletList items={e.value_propositions!.slice(0, 3)} />
                        </div>
                      )}
                      {(e.follower_count != null || e.linkedin_url) && (
                        <div className="space-y-1">
                          {e.follower_count != null && (
                            <Stat label="LinkedIn followers" value={e.follower_count.toLocaleString()} />
                          )}
                          {e.linkedin_url && (
                            <a href={e.linkedin_url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline break-all">
                              {e.linkedin_url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
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
          </div>

          {/* Firmographics — always visible */}
          {hasFirmographics && (
            <div className="border-t border-white/10 pt-2 mt-0.5 space-y-1">
              <p className="text-xs text-white/40">Firmographics</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {(e!.employee_count || e!.employee_range) && (
                  <Stat label="Employees" value={e!.employee_count ? e!.employee_count.toLocaleString() : e!.employee_range!} />
                )}
                {e!.founded_year && <Stat label="Founded" value={String(e!.founded_year)} />}
                {e!.hq_city && <Stat label="HQ" value={e!.hq_city} subValue={e!.hq_country ?? undefined} />}
                {e!.company_status && (() => {
                  const match = e!.company_status!.match(/^([^(]+)\s*\(([^)]+)\)\s*$/);
                  return match
                    ? <Stat label="Status" value={match[1].trim()} subValue={match[2].trim()} />
                    : <Stat label="Status" value={e!.company_status!} />;
                })()}
                {e!.funding_stage && <Stat label="Funding stage" value={e!.funding_stage} />}
                {e!.total_funding_usd != null && (
                  <Stat label="Total funding" value={formatCurrencyShort(e!.total_funding_usd)} />
                )}
              </div>
            </div>
          )}

          {/* Competitors — always visible */}
          {hasCompetitors && (
            <div className="border-t border-white/10 pt-2 mt-0.5 space-y-1">
              <p className="text-xs text-white/40">Competitors</p>
              <div className="space-y-1.5">
                {e!.competitors_enriched!.map((c, i) => (
                  c.url ? (
                    <a key={i} href={c.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-medium text-arcova-teal hover:underline">
                      {c.name}
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                    </a>
                  ) : (
                    <p key={i} className="text-xs font-medium text-white/80">{c.name}</p>
                  )
                ))}
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
      <div className="flex flex-wrap gap-1.5">
        {selected.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className="rounded-full bg-arcova-teal px-3 py-1.5 text-sm text-white transition-colors hover:bg-arcova-teal/80"
          >
            {o}
          </button>
        ))}
        {!expanded && unselected.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-full border border-white/20 px-3 py-1.5 text-sm text-white/50 transition-colors hover:border-white/40 hover:text-white/70"
          >
            + {unselected.length} more
          </button>
        )}
        {expanded && unselected.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => { onToggle(o); }}
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/15"
          >
            {o}
          </button>
        ))}
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-full px-3 py-1.5 text-sm text-white/30 transition-colors hover:text-white/50"
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
  savedPersonaName,
  chipSel,
  collapsed,
  onToggle,
  onToggleFn,
  onToggleSeniority,
  onConfirm,
  onDelete,
  onReenrich,
  exampleCompany,
  icpName,
}: {
  status: CardStatus;
  phase: string;
  panelPersona: PanelPersonaData;
  savedPersonaName: string;
  chipSel: string[];
  collapsed?: boolean;
  onToggle?: () => void;
  onToggleFn?: (v: string) => void;
  onToggleSeniority?: (v: string) => void;
  onConfirm?: () => void;
  onDelete?: () => void;
  onReenrich?: () => void;
  exampleCompany?: string;
  icpName?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isReviewing = phase === 'buying_team_review' || editMode;
  const fnVal = panelPersona.functions.length ? panelPersona.functions : (phase === 'persona_functions' ? chipSel : []);
  const senVal = panelPersona.seniority.length ? panelPersona.seniority : (phase === 'persona_seniority' ? chipSel : []);
  const hasAny = fnVal.length > 0 || senVal.length > 0;

  const handleConfirm = () => {
    setEditMode(false);
    onConfirm?.();
  };

  return (
    <CardShell icon={Users} label="Buying teams" status={status} collapsed={collapsed} onToggle={onToggle}>
      {status === 'pending' && (
        <p className="text-xs text-white/30">Your buying teams will appear here.</p>
      )}

      {(status === 'building' || editMode) && isReviewing && onToggleFn && onToggleSeniority && (
        <div className="space-y-4">
          {exampleCompany && (
            <p className="text-xs text-white/40">
              Suggested from your products and services, modelled on{' '}
              <span className="text-white/60">{exampleCompany}</span>
              {icpName ? ` as a reference ${icpName.toLowerCase()}` : ' as a reference account'}.
            </p>
          )}
          <CollapsibleChipGroup
            label="Functions"
            all={BUSINESS_AREA_OPTIONS}
            selected={panelPersona.functions}
            onToggle={onToggleFn}
          />
          <CollapsibleChipGroup
            label="Seniority levels"
            all={SENIORITY_LEVEL_OPTIONS}
            selected={panelPersona.seniority}
            onToggle={onToggleSeniority}
          />
          {editMode && (
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={() => setEditMode(false)} className="text-xs text-white/40 hover:text-white/70 transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="rounded-xl bg-arcova-teal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90"
              >
                Looks right →
              </button>
            </div>
          )}
        </div>
      )}

      {status === 'building' && !isReviewing && !hasAny && (
        <p className="text-xs text-white/40">Generating buying team suggestions…</p>
      )}

      {status === 'building' && !isReviewing && hasAny && (
        <div className="space-y-2.5">
          <FieldRow label="Functions" tags={fnVal} />
          <FieldRow label="Seniority" tags={senVal} />
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
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Functions</p>
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
          </div>
          <div className="flex items-center gap-2 border-t border-white/10 pt-2">
            {onReenrich && (
              <button type="button" onClick={onReenrich} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors">
                <RefreshCw className="h-3 w-3" /> Re-generate
              </button>
            )}
            <button type="button" onClick={() => setEditMode(true)} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors">
              <Pencil className="h-3 w-3" /> Edit
            </button>
            {onDelete && !confirmingDelete && (
              <button type="button" onClick={() => setConfirmingDelete(true)} className="ml-auto flex items-center gap-1 text-xs text-white/40 hover:text-red-400 transition-colors">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            )}
            {confirmingDelete && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-white/50">Sure?</span>
                <button type="button" onClick={() => { setConfirmingDelete(false); onDelete?.(); }} className="text-xs text-red-400 hover:text-red-300 transition-colors">Yes</button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className="text-xs text-white/40 hover:text-white/70 transition-colors">No</button>
              </div>
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
  onToggleBuyingTeamFn,
  onToggleBuyingTeamSeniority,
  onConfirmBuyingTeam,
  onDeletePersona,
  onReenrichPersona,
  buyingTeamExampleCompany,
  buyingTeamIcpName,
}: SetupProfilePanelProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<'c1' | 'c2' | 'c3', boolean>>({
    c1: false, c2: false, c3: false,
  });
  const toggle = (key: 'c1' | 'c2' | 'c3') =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const hasCompany = !!myCompany.companyName;
  const hasIcp     = !!savedIcpName || !!panelCompany.companyType;
  const hasPersona = panelPersona.functions.length > 0 && !!savedPersonaName;

  const s1: CardStatus = hasCompany  ? 'complete' : phase === 'analysis_loading' ? 'building' : 'pending';
  const s2: CardStatus = hasIcp      ? 'complete' : ICP_BUILDING_PHASES.has(phase)    ? 'building' : 'pending';
  const s3: CardStatus = hasPersona  ? 'complete' : BUYING_BUILDING_PHASES.has(phase) ? 'building' : 'pending';
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
    />
  );

  const buyingCard = (
    <BuyingTeamCard
      status={s3}
      phase={phase}
      panelPersona={panelPersona}
      savedPersonaName={savedPersonaName}
      chipSel={chipSel}
      collapsed={s3 === 'complete' ? collapsed.c3 : undefined}
      onToggle={s3 === 'complete' ? () => toggle('c3') : undefined}
      onToggleFn={onToggleBuyingTeamFn}
      onToggleSeniority={onToggleBuyingTeamSeniority}
      onConfirm={onConfirmBuyingTeam}
      onDelete={onDeletePersona}
      onReenrich={onReenrichPersona}
      exampleCompany={buyingTeamExampleCompany}
      icpName={buyingTeamIcpName}
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
