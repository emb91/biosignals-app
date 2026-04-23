'use client';

import { useState } from 'react';
import { Check, Building2, Briefcase, Users, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

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

export interface PanelMyCompanyData {
  companyName?: string;
  website?: string;
  logoUrl?: string;
  tagline?: string;
  linkedinUrl?: string;
  description?: string[];
  therapeuticAreas?: string[];
  modalities?: string[];
  developmentStages?: string[];
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

export interface SetupProfilePanelProps {
  phase: string;
  // Card 1 — my company
  myCompany: PanelMyCompanyData;
  analysisLoading: boolean;
  // Card 2 — target companies
  reviewedCompanyName: string;
  savedIcpName: string;
  panelCompany: PanelCompanyData;
  chipSel: string[];
  // Card 3 — buying team
  panelPersona: PanelPersonaData;
  savedPersonaName: string;
}

// ── Phase sets ─────────────────────────────────────────────────────────────

const CARD1_BUILDING = new Set(['analysis_loading']);
const CARD1_COMPLETE = new Set([
  'analysis_results', 'customer_url_input', 'customer_url_loading', 'customer_url_review',
  'company_select', 'company_type', 'company_size', 'company_ta', 'company_modality',
  'company_stage', 'company_funding', 'company_saving', 'persona_functions',
  'persona_seniority', 'persona_saving', 'done',
]);

const CARD2_BUILDING = new Set([
  'customer_url_input', 'customer_url_loading', 'customer_url_review', 'company_select',
  'company_type', 'company_size', 'company_ta', 'company_modality',
  'company_stage', 'company_funding', 'company_saving',
]);
const CARD2_COMPLETE = new Set([
  'persona_functions', 'persona_seniority', 'persona_saving', 'done',
]);

const CARD3_BUILDING = new Set(['persona_functions', 'persona_seniority']);
const CARD3_COMPLETE = new Set(['persona_saving', 'done']);

function cardStatus(phase: string, building: Set<string>, complete: Set<string>): CardStatus {
  if (complete.has(phase)) return 'complete';
  if (building.has(phase)) return 'building';
  return 'pending';
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrencyShort(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${usd}`;
}

// ── Primitives ─────────────────────────────────────────────────────────────

function Tag({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-arcova-teal/15 px-2.5 py-0.5 text-xs font-medium text-arcova-teal">
      {label}
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
          className="w-full text-left border-b border-white/10 hover:bg-white/[0.03] transition-colors rounded-t-2xl"
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-0.5 text-sm text-white/80">{value}</p>
    </div>
  );
}

function ProfileCard({
  status,
  myCompany,
  analysisLoading,
  collapsed,
  onToggle,
}: {
  status: CardStatus;
  myCompany: PanelMyCompanyData;
  analysisLoading: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const {
    companyName, website, logoUrl, tagline, linkedinUrl,
    description, therapeuticAreas, modalities, developmentStages,
    employeeCount, employeeRange, followerCount, foundedYear,
    fundingStage, totalFundingUsd, hqCity, hqCountry,
  } = myCompany;

  const displayDomain = website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const hq = [hqCity, hqCountry].filter(Boolean).join(', ') || null;
  const hasTaxonomy = (therapeuticAreas?.length ?? 0) > 0 || (modalities?.length ?? 0) > 0 || (developmentStages?.length ?? 0) > 0;
  const hasStats = employeeCount || employeeRange || followerCount != null || fundingStage || totalFundingUsd != null || foundedYear || hq;
  const descriptionBullets = (description ?? []).filter(Boolean).slice(0, 3);

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
        <div className="space-y-3">

          {/* Header — logo + name + website */}
          {(companyName || website) && (
            <div className="flex items-start gap-2.5">
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
                {tagline && <p className="mt-1 text-xs italic text-white/40 leading-snug">{tagline}</p>}
              </div>
            </div>
          )}

          {/* Taxonomy — therapeutic areas, modalities, dev stages */}
          {hasTaxonomy && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              {(therapeuticAreas?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-white/40">Therapeutic areas</p>
                  <div className="flex flex-wrap gap-1">
                    {therapeuticAreas!.map((t) => <Tag key={t} label={t} />)}
                  </div>
                </div>
              )}
              {(modalities?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-white/40">Modalities</p>
                  <div className="flex flex-wrap gap-1">
                    {modalities!.map((m) => <Tag key={m} label={m} />)}
                  </div>
                </div>
              )}
              {(developmentStages?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1.5 text-xs text-white/40">Development stages</p>
                  <div className="flex flex-wrap gap-1">
                    {developmentStages!.map((s) => <Tag key={s} label={s} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* About — description bullets */}
          {descriptionBullets.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-white/40">About</p>
              <ul className="space-y-1.5">
                {descriptionBullets.map((bullet, i) => (
                  <li key={i} className="flex gap-1.5 text-xs text-white/70 leading-snug">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-arcova-teal/60" />
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Stats grid */}
          {hasStats && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {(employeeCount || employeeRange) && (
                <Stat label="Employees"
                  value={employeeCount ? employeeCount.toLocaleString() : employeeRange!} />
              )}
              {followerCount != null && (
                <Stat label="Followers" value={followerCount.toLocaleString()} />
              )}
              {fundingStage && <Stat label="Funding stage" value={fundingStage} />}
              {totalFundingUsd != null && (
                <Stat label="Total funding" value={formatCurrencyShort(totalFundingUsd)} />
              )}
              {foundedYear && <Stat label="Founded" value={String(foundedYear)} />}
              {hq && <Stat label="HQ" value={hq} />}
            </div>
          )}

          {/* LinkedIn link */}
          {linkedinUrl && (
            <div>
              <p className="text-xs text-white/40">LinkedIn</p>
              <a href={linkedinUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-arcova-teal hover:underline mt-0.5 break-all">
                {linkedinUrl.replace('https://www.linkedin.com/company/', '').replace(/\/$/, '')}
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              </a>
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
  savedIcpName,
  panelCompany,
  chipSel,
  collapsed,
  onToggle,
}: {
  status: CardStatus;
  phase: string;
  reviewedCompanyName: string;
  savedIcpName: string;
  panelCompany: PanelCompanyData;
  chipSel: string[];
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const hasAny =
    panelCompany.companyType !== '' ||
    panelCompany.therapeuticAreas.length > 0 ||
    panelCompany.modalities.length > 0 ||
    panelCompany.companySizes.length > 0 ||
    panelCompany.developmentStages.length > 0 ||
    panelCompany.fundingStages.length > 0;

  // For each field, prefer confirmed panelCompany value, else fall back to chipSel if the
  // active phase matches that field.
  const typeVal = panelCompany.companyType ? [panelCompany.companyType] : (phase === 'company_type' ? chipSel : []);
  const sizesVal = panelCompany.companySizes.length ? panelCompany.companySizes : (phase === 'company_size' ? chipSel : []);
  const taVal = panelCompany.therapeuticAreas.length ? panelCompany.therapeuticAreas : (phase === 'company_ta' ? chipSel : []);
  const modalVal = panelCompany.modalities.length ? panelCompany.modalities : (phase === 'company_modality' ? chipSel : []);
  const stageVal = panelCompany.developmentStages.length ? panelCompany.developmentStages : (phase === 'company_stage' ? chipSel : []);
  const fundingVal = panelCompany.fundingStages.length ? panelCompany.fundingStages : (phase === 'company_funding' ? chipSel : []);

  const showLiveChips = hasAny || (COMPANY_CHIP_PHASES.has(phase) && chipSel.length > 0);

  return (
    <CardShell icon={Briefcase} label="Target companies" status={status} collapsed={collapsed} onToggle={onToggle}>
      {status === 'pending' && (
        <p className="text-xs text-white/30">Your target company profile will appear here.</p>
      )}

      {status === 'building' && !showLiveChips && (
        <p className="text-xs text-white/40">
          {reviewedCompanyName
            ? `Building profile based on ${reviewedCompanyName}…`
            : 'Enter a customer URL to start building this profile.'}
        </p>
      )}

      {status === 'building' && showLiveChips && (
        <div className="space-y-2.5">
          {reviewedCompanyName && (
            <p className="text-xs text-white/40">Based on {reviewedCompanyName}</p>
          )}
          <FieldRow label="Type" tags={typeVal} />
          <FieldRow label="Size" tags={sizesVal} />
          <FieldRow label="Therapeutic areas" tags={taVal} />
          <FieldRow label="Modalities" tags={modalVal} />
          <FieldRow label="Stage" tags={stageVal} />
          <FieldRow label="Funding" tags={fundingVal} />
        </div>
      )}

      {status === 'complete' && (
        <div className="space-y-2">
          {savedIcpName && (
            <p className="text-sm font-medium text-white">{savedIcpName}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {[panelCompany.companyType, ...panelCompany.therapeuticAreas.slice(0, 2)]
              .filter(Boolean)
              .map((t) => <Tag key={t} label={t} />)}
            {panelCompany.therapeuticAreas.length > 2 && (
              <Tag label={`+${panelCompany.therapeuticAreas.length - 2} more`} />
            )}
          </div>
        </div>
      )}
    </CardShell>
  );
}

// ── Card 3 — Buying team ───────────────────────────────────────────────────

function BuyingTeamCard({
  status,
  phase,
  panelPersona,
  savedPersonaName,
  chipSel,
  collapsed,
  onToggle,
}: {
  status: CardStatus;
  phase: string;
  panelPersona: PanelPersonaData;
  savedPersonaName: string;
  chipSel: string[];
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const fnVal = panelPersona.functions.length ? panelPersona.functions : (phase === 'persona_functions' ? chipSel : []);
  const senVal = panelPersona.seniority.length ? panelPersona.seniority : (phase === 'persona_seniority' ? chipSel : []);
  const hasAny = fnVal.length > 0 || senVal.length > 0;

  return (
    <CardShell icon={Users} label="Buying teams" status={status} collapsed={collapsed} onToggle={onToggle}>
      {status === 'pending' && (
        <p className="text-xs text-white/30">Your buying teams will appear here.</p>
      )}

      {status === 'building' && !hasAny && (
        <p className="text-xs text-white/40">Select functions and seniority below to build the profile.</p>
      )}

      {status === 'building' && hasAny && (
        <div className="space-y-2.5">
          <FieldRow label="Functions" tags={fnVal} />
          <FieldRow label="Seniority" tags={senVal} />
        </div>
      )}

      {status === 'complete' && (
        <div className="space-y-2">
          {savedPersonaName && (
            <p className="text-sm font-medium text-white">{savedPersonaName}</p>
          )}
          <div className="space-y-1.5">
            {panelPersona.functions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {panelPersona.functions.slice(0, 3).map((f) => <Tag key={f} label={f} />)}
                {panelPersona.functions.length > 3 && (
                  <Tag label={`+${panelPersona.functions.length - 3} more`} />
                )}
              </div>
            )}
            {panelPersona.seniority.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {panelPersona.seniority.map((s) => <Tag key={s} label={s} />)}
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
  reviewedCompanyName,
  savedIcpName,
  panelCompany,
  chipSel,
  panelPersona,
  savedPersonaName,
}: SetupProfilePanelProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<'c1' | 'c2' | 'c3', boolean>>({
    c1: false, c2: false, c3: false,
  });
  const toggle = (key: 'c1' | 'c2' | 'c3') =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const s1 = cardStatus(phase, CARD1_BUILDING, CARD1_COMPLETE);
  const s2 = cardStatus(phase, CARD2_BUILDING, CARD2_COMPLETE);
  const s3 = cardStatus(phase, CARD3_BUILDING, CARD3_COMPLETE);
  const allComplete = s1 === 'complete' && s2 === 'complete' && s3 === 'complete';

  const profileCard = (
    <ProfileCard
      status={s1}
      myCompany={myCompany}
      analysisLoading={analysisLoading}
      collapsed={s1 === 'complete' ? collapsed.c1 : undefined}
      onToggle={s1 === 'complete' ? () => toggle('c1') : undefined}
    />
  );

  const targetCard = (
    <TargetCard
      status={s2}
      phase={phase}
      reviewedCompanyName={reviewedCompanyName}
      savedIcpName={savedIcpName}
      panelCompany={panelCompany}
      chipSel={chipSel}
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
    />
  );

  if (allComplete) {
    const tabContent = [profileCard, targetCard, buyingCard];
    return (
      <div className="flex flex-col gap-3">
        <div className="flex overflow-hidden rounded-xl border border-white/10">
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveTab(i)}
                className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === i
                    ? 'bg-arcova-teal text-white'
                    : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden truncate xl:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
        {tabContent[activeTab]}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {profileCard}
      {targetCard}
      {buyingCard}
    </div>
  );
}
