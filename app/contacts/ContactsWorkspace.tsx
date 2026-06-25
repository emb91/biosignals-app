'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type ReactNode } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel, type AgentLeadsFilter, type AgentPendingMessage } from '@/components/AgentPanel';
import { AgentChatBar } from '@/components/AgentChatBar';
import { useScrollMask } from '@/hooks/use-scroll-mask';
import type { QueryLead } from '@/lib/leads-data';
import {
  type LeadAction,
  type SequenceDispatchStatus,
  applyOutreachOverride,
  applyFixOverride,
  effectiveReadiness,
  isCrmSuppressed,
  getActionFromScores,
  getLeadAction,
  getLeadActionFromFits,
  formatLeadActionLabel,
  resolveCompanyFitForLeadAction,
  resolveContactFitForLeadAction,
  isLeadReadyAwaitingContactSignal,
  LEAD_ACTION_PILL_CLASS,
  LEAD_ACTION_SORT_ORDER,
} from '@/lib/lead-action';
import {
  normalizeScore01,
  resolveEffectivePriority,
} from '@/lib/effective-priority';
import { formatProvenanceImportedAt } from '@/lib/data-provenance';
import { ROUTES, withQuery } from '@/lib/routes';
import Nango from '@nangohq/frontend';
import { looksLikeEmail, type ContactEmailRow, type EmailVerificationResultItem, EMAIL_DELIVERABILITY_USER_OPTIONS, emailDeliverabilityEditKey, contactEmailMayBeOutdated, getContactEmailDeliverabilityDisplayMeta } from '@/lib/contact-emails';
import { looksLikePhone, type ContactPhoneRow } from '@/lib/contact-phones';
import {
  buildContactEmailDisplayRows,
  parseContactLocation,
} from '@/lib/contact-profile-display';
import { cn } from '@/lib/utils';
import { useAgentCollapsed } from '@/hooks/use-agent-collapsed';
import { cachedJson, invalidateCache } from '@/lib/page-fetch-cache';
import { OutreachPanel } from '@/components/OutreachPanel';
import { TableFitGaugeButton } from '@/components/TableFitGaugeButton';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress-bar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import '@/app/contacts/contacts-layout.css';
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Pencil,
  Trash2,
  X,
  ExternalLink,
  RotateCw,
  Ban,
  Upload,
  Download,
  MailCheck,
  Check,
  Plus,
  AlertTriangle,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { EntitySignalsList } from '@/components/EntitySignalsList';

interface EmploymentHistoryItem {
  company_name: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  current: boolean;
}

interface CompanyFirmographics {
  name?: string | null;
  company_type?: string | null;
  platform_category?: string | null;
  description?: string | null;
  bio_summary?: string | null;
  tagline?: string | null;
  website?: string | null;
  domain?: string | null;
  logo_url?: string | null;
  follower_count?: number | null;
  employee_count?: number | null;
  employee_range?: string | null;
  industry?: string | null;
  founded_year?: number | null;
  hq_city?: string | null;
  hq_state?: string | null;
  hq_country?: string | null;
  specialties?: string[] | null;
  products_services?: string[] | null;
  services?: string[] | null;
  technologies?: string[] | null;
  linkedin_url?: string | null;
  funding_stage?: string | null;
  funding_status_label?: string | null;
  funding_resolution_summary?: string | null;
  total_funding_usd?: number | null;
  latest_funding_date?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
}

type CompanyFitComponentKey =
  | 'company_type'
  | 'offering'
  | 'development_stages'
  | 'company_size'
  | 'funding'
  // Legacy keys — kept so pre-company_fit_v2 breakdowns still render.
  | 'platform_category'
  | 'therapeutic_areas'
  | 'modalities';

interface CompanyFitBreakdownComponent {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedCount?: number;
  totalSelected?: number;
  matchStatus?: string;
  matchedValues?: string[];
  unmatchedValues?: string[];
}

interface CompanyFitBreakdown {
  score_version: string;
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    score_cap01: number;
    coverage01: number;
    reasoning: string;
  };
  components: Record<CompanyFitComponentKey, CompanyFitBreakdownComponent>;
}

interface CompanyFitCandidate {
  icp_id: string;
  icp_name: string | null;
  icp_index: number | null;
  final_score: number | null;
  raw_score: number | null;
  score_cap: number | null;
  coverage: number | null;
  company_type_match_status: string | null;
  breakdown: CompanyFitBreakdown | null;
}

interface CompanyFitDetails {
  company_id: string;
  company_fit_score: number | null;
  company_fit_coverage: number | null;
  company_fit_scored_at: string | null;
  company_fit_version: string | null;
  matched_icp_id: string | null;
  matched_icp_name: string | null;
  winning_breakdown: CompanyFitBreakdown | null;
  icp_scores: CompanyFitCandidate[];
}

interface CompanyFitFetchState {
  loading: boolean;
  data: CompanyFitDetails | null;
  error: string | null;
  message: string | null;
}

type ContactFitComponentKey = 'business_area' | 'seniority';

interface ContactFitBreakdownComponent {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedValue?: string | null;
  matchStatus?: string;
}

interface ContactFitBreakdown {
  score_version: string;
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    coverage01: number;
    reasoning: string;
  };
  components: Record<ContactFitComponentKey, ContactFitBreakdownComponent>;
}

interface ContactFitCandidate {
  persona_id: string;
  persona_name: string | null;
  icp_id: string | null;
  icp_name: string | null;
  final_score: number | null;
  raw_score: number | null;
  coverage: number | null;
}

interface ContactFitDetails {
  contact_id: string;
  contact_fit_score: number | null;
  contact_fit_coverage: number | null;
  contact_fit_scored_at: string | null;
  contact_fit_version: string | null;
  scored_against_persona_id: string | null;
  matched_persona_name: string | null;
  matched_icp_id: string | null;
  matched_icp_name: string | null;
  winning_breakdown: ContactFitBreakdown | null;
  persona_scores: ContactFitCandidate[];
}

interface ContactFitFetchState {
  loading: boolean;
  data: ContactFitDetails | null;
  error: string | null;
  message: string | null;
}

interface HubSpotCrmDeal {
  hubspot_deal_id: string;
  deal_name: string | null;
  deal_stage: string | null;
  amount: number | null;
  close_date: string | null;
  hs_lastmodifieddate: string | null;
  synced_at: string | null;
  hubspot_company_name: string | null;
  hubspot_company_domain: string | null;
  arcova_company_id: string | null;
  resolution_status: string | null;
  resolution_suppressed: boolean;
  mismatch_reason: string | null;
  matched_arcova_contact_ids: string[];
  matched_arcova_company_ids: string[];
  hubspot_contact_id: string | null;
  hubspot_contact_email: string | null;
  hubspot_contact_name: string | null;
  pushed_arcova_contact_id: string | null;
  pushed_arcova_company_id: string | null;
  pushed_arcova_company_name: string | null;
  pushed_arcova_company_domain: string | null;
}

interface HubSpotCrmContext {
  contact_id: string;
  arcova_company_id: string | null;
  arcova_company_name: string | null;
  arcova_company_domain: string | null;
  deals: HubSpotCrmDeal[];
}

interface HubSpotCrmFetchState {
  loading: boolean;
  data: HubSpotCrmContext | null;
  error: string | null;
}

interface PanelSummaries {
  contactSummary: string;
  fitSummary: string;
}

interface PanelSummariesFetchState {
  loading: boolean;
  data: PanelSummaries | null;
  error: string | null;
}

interface Lead {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  job_title_standardised: string | null;
  seniority_level: string | null;
  business_area: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  email: string | null;
  email_status: string | null;
  email_status_reasoning: string | null;
  email_deliverability: string | null;
  linkedin_url: string | null;
  profile_photo_url: string | null;
  profile_photo_cached: string | null;
  headline: string | null;
  location: string | null;
  city?: string | null;
  country?: string | null;
  resolved_current_company_name: string | null;
  resolved_current_company_domain: string | null;
  resolved_current_job_title: string | null;
  resolved_employment_history: EmploymentHistoryItem[] | null;
  contact_bio: string[] | null;
  contact_discovery_status: string | null;
  linkedin_resolution_status: string | null;
  profile_enrichment_status: string | null;
  linkedin_resolution_last_error?: string | null;
  profile_enrichment_last_error?: string | null;
  linkedin_resolution_started_at?: string | null;
  linkedin_resolution_completed_at?: string | null;
  profile_enrichment_started_at?: string | null;
  profile_enrichment_completed_at?: string | null;
  enrichment_refresh_status?: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled' | null;
  enrichment_refresh_last_error?: string | null;
  enrichment_refresh_started_at?: string | null;
  enrichment_refresh_finished_at?: string | null;
  fit_score: number | null;
  readiness_score: number | null;
  overall_fit_score: number | null;
  company_fit_score: number | null;
  contact_fit_score: number | null;
  source: string;
  created_at: string;
  updated_at: string | null;
  company_id: string | null;
  matched_icp_name: string | null;
  matched_icp_index?: number | null;
  matched_icp_label?: string | null;
  /** CSV, HubSpot, Arcova label from API */
  data_provenance_type?: string | null;
  data_provenance_imported_at?: string | null;
  contact_emails?: ContactEmailRow[] | null;
  contact_phones?: ContactPhoneRow[] | null;
  hubspot_lead_state?: 'active' | 'customer' | 'dormant' | 'context_only' | 'none' | null;
  hubspot_latest_deal_stage?: string | null;
  hubspot_latest_deal_name?: string | null;
  hubspot_latest_deal_updated_at?: string | null;
  attribution_is_arcova_sourced?: boolean | null;
  attribution_is_arcova_enriched?: boolean | null;
  attribution_arcova_touchpoint_count?: number | null;
  attribution_arcova_touchpoints?: Array<{ type?: string; at?: string }> | null;
  attribution_first_arcova_touch_at?: string | null;
  attribution_latest_arcova_touch_at?: string | null;
  attribution_latest_arcova_touch_type?: string | null;
  attribution_latest_closed_won_deal_id?: string | null;
  attribution_latest_closed_won_deal_name?: string | null;
  attribution_latest_closed_won_at?: string | null;
  attribution_won_after_arcova_touch?: boolean | null;
  attribution_computed_at?: string | null;
  contact_readiness_label?: string | null;
  contact_readiness_score?: number | null;
  /** Account-level readiness mirrored from org company state by the readiness cron. */
  company_readiness_score?: number | null;
  /** Most recent outreach_sequences.dispatch_status for this contact, surfaced by /api/contacts. */
  latest_sequence_status?: SequenceDispatchStatus;
  contact_panel_summary?: string | null;
  contact_fit_summary?: string | null;
  /** Mirrored from contact_readiness_snapshots.priority_score by the readiness cron. */
  priority_score?: number | null;
  companies: {
    company_name: string | null;
    domain: string | null;
    website: string | null;
    linkedin_url: string | null;
    description: string | null;
    bio_summary: string | null;
    tagline: string | null;
    logo_url: string | null;
    follower_count: number | null;
    company_type: string | null;
    company_type_display: string | null;
    platform_category: string | null;
    funding_stage: string | null;
    funding_status_label: string | null;
    total_funding_usd: number | null;
    funding_data_source: string | null;
    funding_resolution_confidence: string | null;
    funding_resolution_summary: string | null;
    founded_year: number | null;
    headquarters_city: string | null;
    headquarters_state: string | null;
    headquarters_country: string | null;
    specialties: string[] | null;
    products_services: string[] | null;
    services: string[] | null;
    technologies: string[] | null;
    therapeutic_areas: string[] | null;
    modalities: string[] | null;
    development_stages: string[] | null;
    clinical_stage: string | null;
    employee_count: number | null;
    employee_range: string | null;
    industry: string | null;
    latest_funding_date: string | null;
    matched_icp_id: string | null;
    last_enriched_at: string | null;
    company_fit_score?: number | null;
  } | null;
}

type EditableLeadFields = {
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  headline: string;
  linkedin_url: string;
  company_name: string;
  company_domain: string;
  company_linkedin_url: string;
  location: string;
  city: string;
  country: string;
  user_secondary_emails: string[];
  user_phones: string[];
  /** Normalized email address -> deliverability status (null = not verified). */
  email_deliverability_by_email: Record<string, string | null>;
};

type EnrichmentStageKey =
  | 'queued'
  | 'linkedin_processing'
  | 'linkedin_resolved'
  | 'profile_processing'
  | 'complete'
  | 'stopped';

type LeadRefreshStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

type EnrichmentVisualState = {
  stageKey: EnrichmentStageKey;
  startedAt: number;
  startPercent: number;
};

const PAGE_SIZE = 50;
/**
 * Responsive table grid — three tiers based on how much horizontal room the table
 * has after sidebar + agent panel get their share. The grid TEMPLATE is set inline
 * via the `style` attribute (using `useLeadsTableGridCols` below) so Tailwind
 * doesn't have to compile a giant chain of `min-[1280px]:grid-cols-[...]`
 * arbitrary classes (it dropped the longest variant and HubSpot + Action wrapped
 * onto a second row at full width). Visibility stays on Tailwind via
 * `hidden lg:flex` / `hidden min-[1280px]:flex`.
 *
 * Tiers:
 * - <1024px: 3 columns — Name / Company / Contact fit. (Agent panel is hidden at
 *   <768px, so the table has plenty of room for Company even on phones.)
 * - 1024–1279px: 4 columns — adds Job title.
 * - ≥1280px: 6 columns — adds HubSpot + Action.
 */
const LEADS_TABLE_GRID = 'grid gap-x-5';

const LEADS_GRID_COLS_SM =
  'minmax(0,1.15fr) minmax(0,1.15fr) minmax(5.5rem,0.7fr)';
const LEADS_GRID_COLS_LG =
  'minmax(0,1fr) minmax(0,1fr) minmax(0,1.15fr) minmax(5.5rem,0.7fr)';
const LEADS_GRID_COLS_FULL =
  'minmax(0,0.85fr) minmax(0,1fr) minmax(0,0.95fr) minmax(4rem,0.45fr) minmax(0,5.25rem) minmax(9.5rem,1.15fr)';

// When the agent is collapsed the table reclaims its ~360px column, so each tier
// kicks in ~one breakpoint earlier (LG at md, FULL at lg). The cell-visibility
// classes (`[.arcova-agent-collapsed_&]:md:block` / `:lg:flex`) use the SAME
// thresholds so the grid track count always matches the visible cells.
function pickLeadsGridCols(width: number, agentCollapsed: boolean): string {
  if (agentCollapsed) {
    if (width >= 1024) return LEADS_GRID_COLS_FULL;
    if (width >= 768) return LEADS_GRID_COLS_LG;
    return LEADS_GRID_COLS_SM;
  }
  if (width >= 1280) return LEADS_GRID_COLS_FULL;
  if (width >= 1024) return LEADS_GRID_COLS_LG;
  return LEADS_GRID_COLS_SM;
}

/** Returns the right `grid-template-columns` value for the current viewport. */
function useLeadsTableGridCols(): string {
  const agentCollapsed = useAgentCollapsed();
  // Initialize synchronously from `window.innerWidth` so there's no flash of the
  // wrong (default 6-col) template on first render — that flash caused the data
  // rows to render with cells in the wrong column slots before the effect ran.
  const [cols, setCols] = useState<string>(() =>
    typeof window === 'undefined' ? LEADS_GRID_COLS_FULL : pickLeadsGridCols(window.innerWidth, agentCollapsed),
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setCols(pickLeadsGridCols(window.innerWidth, agentCollapsed));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [agentCollapsed]);
  return cols;
}

function blurInputOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.currentTarget.blur();
}
const MAX_VISIBLE_WORK_HISTORY = 3;
const COMPANY_FIT_COMPONENT_ORDER: CompanyFitComponentKey[] = [
  'company_type',
  'offering',
  'development_stages',
  'company_size',
  'funding',
  // Legacy keys last — only render for pre-v2 breakdowns.
  'platform_category',
  'therapeutic_areas',
  'modalities',
];
const CONTACT_FIT_COMPONENT_ORDER: ContactFitComponentKey[] = ['business_area', 'seniority'];

const formatLastUpdated = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatPercentValue = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${Math.round((value <= 1 ? value * 100 : value))}%`;
};

const formatUsdValue = (value: number | null | undefined): string | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
};

const formatHubSpotResolutionLabel = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
};

const formatHubSpotStageLabel = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const knownLabels: Record<string, string> = {
    appointmentscheduled: 'Appt set',
    qualifiedtobuy: 'Qualified',
    presentationscheduled: 'Presentation',
    decisionmakerboughtin: 'Buy-in',
    contractsent: 'Contract',
    closedwon: 'Closed won',
    closedlost: 'Closed lost',
    dealswon: 'Won',
  };
  if (knownLabels[normalized]) return knownLabels[normalized];
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(' ');
};

function getHubSpotTableBadge(lead: Lead): {
  label: string;
  className: string;
} {
  const stageLabel = formatHubSpotStageLabel(lead.hubspot_latest_deal_stage);

  switch (lead.hubspot_lead_state) {
    case 'customer':
      return {
        // Closed-won deal — flagged as "Won" so it reads next to "Lost" in the
        // CRM column. The Action column folds both Won and Lost into
        // Deprioritise (deal cycle resolved); CRM column keeps them distinct.
        label: 'Won',
        className: 'border-[rgba(45,138,138,0.24)] bg-[rgba(45,138,138,0.08)] text-[#2d8a8a]',
      };
    case 'dormant':
      return {
        // Red, not grey — grey reads as "deprioritised" (cold lead), whereas
        // Lost is a closed-out deal and deserves its own signal.
        label: 'Lost',
        className: 'border-[rgba(220,38,38,0.24)] bg-[rgba(220,38,38,0.08)] text-[#b91c1c]',
      };
    case 'active':
      return {
        label: stageLabel || 'Active deal',
        className: 'border-[rgba(245,115,22,0.24)] bg-[rgba(255,122,89,0.08)] text-[#cc5b3f]',
      };
    // 'context_only' (in HubSpot, no actionable deal) and 'none' both render
    // as "No deal" — same neutral pill, since users don't distinguish them.
    default: {
      // A contact that's not in HubSpot at all AND can't be pushed (bad/missing
      // email) reads as "Not synced" so the sync blocker is visible in the CRM
      // column — matches the "Fix" action. context_only already lives in HubSpot,
      // so it stays "No deal".
      const notInHubspot = lead.hubspot_lead_state == null || lead.hubspot_lead_state === 'none';
      if (notInHubspot && contactHasSyncIssue(lead)) {
        return {
          label: 'Not synced',
          className: 'border-[rgba(179,74,38,0.24)] bg-[#ffe7dd] text-[#b34a26]',
        };
      }
      return {
        label: 'No deal',
        className: 'border-[rgba(13,53,71,0.08)] bg-[rgba(13,53,71,0.03)] text-[#7d909a]',
      };
    }
  }
}

/** Integer 0–100 for progress bars */
const percentDisplayNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value <= 1 ? value * 100 : value);
};

/** Normalise any 0–1 or 0–100 score to a 0–1 fraction. */
const normalize01 = normalizeScore01;

/** Minimal lead shape the CRM-suppression display helpers read. Structural so
 *  it accepts both the lean list `Lead` and the `QueryLead` sort rows. */
type CrmSuppressibleLead = {
  hubspot_lead_state?: Lead['hubspot_lead_state'];
  hubspot_latest_deal_updated_at?: string | null;
  company_readiness_score?: number | null;
  contact_readiness_score?: number | null;
  contact_fit_score: number | null;
  priority_score?: number | null;
  intrinsic_priority_score?: number | null;
  company_fit_score?: number | null;
  companies?: { company_fit_score?: number | null } | null;
};

/**
 * Effective readiness for DISPLAY — folds in the CRM suppression cooldown.
 * Within a closed-won/lost cooldown the deal is "resolved", so readiness is
 * floored to 0.01 (it nullifies the account's other signals). Once the cooldown
 * passes, the floor lifts and normal effective readiness (company OR contact
 * signals) drives the contact again — that's how a closed deal resurfaces.
 */
function displayEffectiveReadiness(lead: CrmSuppressibleLead): number | null {
  const intrinsicReadiness = effectiveReadiness(
    lead.company_readiness_score ?? null,
    lead.contact_readiness_score ?? null,
  );
  return resolveEffectivePriority({
    intrinsicPriority: lead.intrinsic_priority_score ?? lead.priority_score ?? null,
    companyFit: lead.company_fit_score ?? lead.companies?.company_fit_score ?? null,
    contactFit: lead.contact_fit_score,
    intrinsicReadiness,
    crmState: lead.hubspot_lead_state ?? null,
    crmClosedAt: lead.hubspot_latest_deal_updated_at ?? null,
  }).effectiveReadiness;
}

/**
 * Priority for DISPLAY — the single helper the table gauge, the sort comparator
 * and the side-panel gauge all call, so they can never diverge (there is ONE
 * priority value on screen). Within a CRM cooldown it bypasses the stored
 * intrinsic priority (which carries no CRM context) and recomputes from the
 * floored readiness; otherwise it returns the stored value, falling back to the
 * live calc only when the stored column is null.
 */
function displayContactPriority(lead: CrmSuppressibleLead): number | null {
  const companyFit = lead.company_fit_score ?? lead.companies?.company_fit_score ?? null;
  const intrinsicReadiness = effectiveReadiness(
    lead.company_readiness_score ?? null,
    lead.contact_readiness_score ?? null,
  );
  return resolveEffectivePriority({
    intrinsicPriority: lead.intrinsic_priority_score ?? lead.priority_score ?? null,
    companyFit,
    contactFit: lead.contact_fit_score,
    intrinsicReadiness,
    crmState: lead.hubspot_lead_state ?? null,
    crmClosedAt: lead.hubspot_latest_deal_updated_at ?? null,
  }).effectivePriority;
}

/**
 * One-line plain-English explanation of the priority score. Deterministic —
 * shares the 0.7 thresholds with lib/lead-action.ts so the narrative agrees
 * with the action pill. CRM state (customer/dormant) wins first so the user
 * sees "deal already closed" instead of low-readiness fluff.
 *
 * Reads off the same inputs as `contactPriorityScore`: company fit, contact
 * fit, effective readiness (max of company + contact readiness), and HubSpot
 * lead state. Returns null when no inputs are usable (the panel hides the
 * blurb in that case).
 */
function getPriorityExplanation(args: {
  firstName: string | null;
  companyName: string | null;
  companyFit: number | null | undefined;
  contactFit: number | null | undefined;
  companyReadiness: number | null | undefined;
  contactReadiness: number | null | undefined;
  crmState: 'active' | 'customer' | 'dormant' | 'context_only' | 'none' | null | undefined;
  dealClosedAt?: string | null;
}): string | null {
  const company = normalize01(args.companyFit);
  const contact = normalize01(args.contactFit);
  // Effective readiness — same combine the action tree + priority use, so the
  // narrative agrees with both.
  const readiness = effectiveReadiness(args.companyReadiness, args.contactReadiness) ?? 0;
  const HIGH = 0.7;
  const who = args.firstName?.trim() || 'this contact';
  const where = args.companyName?.trim() || 'this company';

  // CRM-resolved messaging only applies DURING the suppression cooldown. Once it
  // passes, the deal no longer holds the contact back, so we fall through to the
  // normal fit/readiness narrative (which is how a closed deal resurfaces).
  const suppressed = isCrmSuppressed(args.crmState, args.dealClosedAt ?? null);
  if (suppressed && args.crmState === 'customer') {
    return `${where} is already a closed-won customer, so ${who} drops off today's outreach list — even if the persona and account fit are strong. They become eligible again about a year after close for renewal or expansion.`;
  }
  if (suppressed && args.crmState === 'dormant') {
    return `The deal at ${where} closed lost, so we're holding off reaching out to ${who} for now. They can resurface after ~6 months if a new signal fires (e.g. a new decision-maker, fresh funding).`;
  }
  if (company == null && contact == null) return null;

  const companyLow = company != null && company < HIGH;
  const contactLow = contact != null && contact < HIGH;
  const readinessLow = readiness < HIGH;

  if (companyLow) {
    return `${where} sits below your ICP threshold, so ${who} isn't a priority today — even with a good persona match, a wrong-fit account isn't worth pursuing.`;
  }
  if (contactLow) {
    return `${where} is a strong ICP match, but ${who}'s role isn't your buyer persona — source a better-fit contact at this account instead.`;
  }
  if (readinessLow) {
    return `${who} is the right persona at a strong-fit account, but there's no buying signal firing yet — keep them on your radar and reach out when something moves.`;
  }
  return `${who} is the right persona at a strong-fit account and signals are firing — high priority to reach out today.`;
}

/** Teal / orange / red bands for fit / readiness gauges. Matches lib/fit-gauge. */
function fitScoreArcColor(pct: number | null): string {
  if (pct == null) return 'rgba(13,53,71,0.14)';
  if (pct >= 80) return '#00A4B4';
  if (pct >= 45) return '#F97316';
  return '#EF4444';
}

/** Softer bands for the priority gauge (matches lib/fit-gauge.priorityScoreArcColor). */
function priorityScoreArcColor(pct: number | null): string {
  if (pct == null) return 'rgba(13,53,71,0.14)';
  if (pct >= 60) return '#00A4B4';
  if (pct >= 30) return '#F97316';
  return '#EF4444';
}

/**
 * One priority sub-score row (company fit / contact fit / readiness) for the
 * side panel's Priority view. Defined at MODULE scope on purpose: when it lived
 * inside the panel render body its function identity changed every render, so
 * React remounted the gauge on each parent re-render (the 5s lead poll, live
 * recompute, etc.), replaying the fill animation 2–3× instead of once.
 */
function ScoreRow({
  label,
  pct,
  arcColor,
  onOpen,
}: {
  label: string;
  pct: number | null;
  arcColor: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 flex items-center gap-4 text-left transition-colors hover:bg-arcova-teal/5"
    >
      <AnimatedCircularProgressBar
        value={pct ?? 0}
        gaugePrimaryColor={arcColor}
        gaugeSecondaryColor="rgba(13,53,71,0.09)"
        animateOnMount
        deferAnimationMs={160}
        label={
          <span className="block text-xs font-semibold text-gray-800 leading-snug tabular-nums">
            {pct != null ? pct : '—'}
          </span>
        }
        className="size-12 shrink-0 [--transition-length:0.95s]"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
          {label}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-arcova-teal">
          See details →
        </p>
      </div>
    </button>
  );
}

/**
 * Compute the contact's recommended action from company_fit + contact_fit +
 * contact_readiness + HubSpot lead state. Single source of truth used by the
 * action pill, the action drawer, the sort comparator and the CSV export.
 * `resolveCompanyFitForLeadAction` handles all the places the company fit can
 * live on a Lead (lead.company_fit_score, lead.companies.company_fit_score,
 * lead.fit_score).
 */
/**
 * Why a contact can't be pushed to HubSpot, or null if it can. Mirrors the
 * push-enrichment route's filter (which keys on the primary `email` field):
 * no email, or an email that doesn't look valid. Drives the "Fix" action and
 * the "Not synced" CRM badge.
 */
function contactSyncIssueReason(lead: Pick<Lead, 'email'>): 'no_email' | 'invalid_email' | null {
  const email = lead.email?.trim() ?? '';
  if (!email) return 'no_email';
  if (!looksLikeEmail(email)) return 'invalid_email';
  return null;
}

function contactHasSyncIssue(lead: Pick<Lead, 'email'>): boolean {
  return contactSyncIssueReason(lead) !== null;
}

function getContactAction(
  lead: Lead,
): LeadAction {
  // CRM-resolved (won/lost) only forces Deprioritise DURING the suppression
  // cooldown (won 1yr / lost 6mo). Past it, treat the contact as non-resolved so
  // normal fit/readiness logic — and any new signals — can resurface them.
  const crmForAction = isCrmSuppressed(
    lead.hubspot_lead_state ?? null,
    lead.hubspot_latest_deal_updated_at ?? null,
  )
    ? lead.hubspot_lead_state ?? null
    : null;
  const base = getActionFromScores(
    resolveCompanyFitForLeadAction(lead),
    lead.contact_fit_score ?? null,
    // Action tree expects EFFECTIVE readiness (company OR contact, plus bump if
    // both). Passing only contact readiness here misclassifies great contacts at
    // hot companies as Monitor — keep this in sync with /api/outreach/hooks and
    // /api/outreach/sequence, which both fold company + contact readiness.
    effectiveReadiness(lead.company_readiness_score ?? null, lead.contact_readiness_score ?? null),
    crmForAction,
  );
  // Outreach state overlays the score-driven action: a staged draft promotes
  // to "Send outreach"; a sent sequence to "Await reply". Pass crmState so a
  // closed-won / closed-lost contact still reads as Deprioritise even with a
  // historic sequence on file (during cooldown only).
  const withOutreach = applyOutreachOverride(
    base,
    (lead.latest_sequence_status ?? null) as SequenceDispatchStatus,
    crmForAction,
  );
  // Data-quality overlay wins last: a contact we'd otherwise engage but can't
  // push to HubSpot (bad/missing email) surfaces as "Fix".
  return applyFixOverride(withOutreach, contactHasSyncIssue(lead));
}

const LEAD_EDIT_INPUT_CLASS =
  'w-full rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-arcova-teal/30';

function userSecondaryEmailsFromLead(lead: Lead): string[] {
  const primary = (lead.email || '').trim().toLowerCase();
  const rows = lead.contact_emails || [];
  const out: string[] = [];
  for (const row of rows) {
    if (row.category !== 'user') continue;
    const e = row.email.trim();
    if (!e) continue;
    if (primary && e.toLowerCase() === primary) continue;
    out.push(row.email);
  }
  return out;
}

function userPhonesFromLead(lead: Lead): string[] {
  const rows = lead.contact_phones || [];
  const out: string[] = [];
  for (const row of rows) {
    if (row.category !== 'user') continue;
    const p = (row.phone || '').trim();
    if (!p) continue;
    out.push(row.phone);
  }
  return out;
}

function emailDeliverabilityFromLead(lead: Lead): Record<string, string | null> {
  const rows = buildContactEmailDisplayRows(lead.email, lead.contact_emails, 'full');
  const out: Record<string, string | null> = {};
  for (const row of rows) {
    out[emailDeliverabilityEditKey(row.email)] = row.email_deliverability ?? null;
  }
  return out;
}

function collectEmailDeliverabilityOverrides(
  lead: Lead,
  editingFields: EditableLeadFields,
): Array<{ email: string; email_deliverability: string | null }> {
  const primaryTrim = editingFields.email.trim();
  const secondaryTrimmed = editingFields.user_secondary_emails.map((s) => s.trim()).filter(Boolean);
  const enrichmentRows = buildContactEmailDisplayRows(lead.email, lead.contact_emails, 'enrichmentOnly');

  const emails: string[] = [];
  if (primaryTrim) emails.push(primaryTrim);
  emails.push(...secondaryTrimmed);
  for (const row of enrichmentRows) emails.push(row.email.trim());

  const seen = new Set<string>();
  const overrides: Array<{ email: string; email_deliverability: string | null }> = [];
  for (const email of emails) {
    const key = emailDeliverabilityEditKey(email);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(key in editingFields.email_deliverability_by_email)) continue;
    overrides.push({
      email,
      email_deliverability: editingFields.email_deliverability_by_email[key] ?? null,
    });
  }
  return overrides;
}

const LEAD_EDIT_SELECT_CLASS =
  'rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-arcova-teal/30';

function EmailDeliverabilitySelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      className={LEAD_EDIT_SELECT_CLASS}
      aria-label="Email deliverability status"
    >
      {EMAIL_DELIVERABILITY_USER_OPTIONS.map((option) => (
        <option key={option.value || 'not-verified'} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function actionDrawerRelativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return null;
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

type ActionFitCriterion = { ok: 'pass' | 'warn' | 'miss'; text: string; val: string };

function score01ToFitOk(score01: number, matchStatus?: string | null): ActionFitCriterion['ok'] {
  if (matchStatus === 'mismatch') return 'miss';
  if (score01 >= 0.84) return 'pass';
  if (score01 >= 0.45) return 'warn';
  return 'miss';
}

const formatPercent = (value: number | null | undefined): string | null => {
  const percent = formatPercentValue(value);
  return percent ? `${percent} fit` : null;
};

const formatCoverage = (value: number | null | undefined): string | null => {
  const percent = formatPercentValue(value);
  return percent ? `${percent} coverage` : null;
};

const formatMatchStatus = (value: string | null | undefined): string | null => {
  if (!value) return null;
  return value.replace(/_/g, ' ');
};

const getExactCompanyFitPillLabels = (
  key: CompanyFitComponentKey,
  detail: string | null | undefined,
): string[] => {
  if (!detail) return [];

  if (key === 'company_type') {
    const match = detail.match(/^Matches\s+(.+?)\.$/i);
    return match?.[1] ? [match[1]] : [];
  }

  if (key === 'company_size') {
    const match = detail.match(/^Exact size-band match on\s+(.+?)\.$/i);
    return match?.[1] ? [match[1]] : [];
  }

  if (key === 'funding') {
    const labels: string[] = [];
    const stageMatch = detail.match(/Funding stage\s+(.+?)\s+compared with ICP target/i);
    if (stageMatch?.[1]) labels.push(stageMatch[1]);

    const bucketMatch = detail.match(/Raised bucket\s+(.+?)\s+compared with ICP target bucket/i);
    if (bucketMatch?.[1]) labels.push(bucketMatch[1]);

    return labels;
  }

  return [];
};

const getExactCompanyFitStatusLabel = (
  key: CompanyFitComponentKey,
  component: { matchStatus?: string | null; detail?: string | null },
): string | null => {
  const hasExactPillFallback = getExactCompanyFitPillLabels(key, component.detail).length > 0;
  if (component.matchStatus !== 'exact' && !hasExactPillFallback) return null;

  if (key === 'company_type') return 'Company type match';
  if (key === 'company_size') return 'Company size match';
  if (key === 'funding') return 'Funding match';

  return null;
};

const getDisplayedCompanyFirmographics = (lead: Lead | null): CompanyFirmographics | null => {
  if (!lead) return null;

  const company = lead.companies;
  if (!company && !lead.resolved_current_company_name && !lead.company_name) {
    return null;
  }

  return {
    name: company?.company_name || lead.resolved_current_company_name || lead.company_name || null,
    company_type: company?.company_type || company?.company_type_display || null,
    platform_category: company?.platform_category || null,
    description: company?.description || null,
    bio_summary: company?.bio_summary || null,
    tagline: company?.tagline || null,
    website: company?.website || null,
    domain: company?.domain || lead.resolved_current_company_domain || lead.company_domain || null,
    logo_url: company?.logo_url || null,
    follower_count: company?.follower_count ?? null,
    employee_count: company?.employee_count ?? null,
    employee_range: company?.employee_range ?? null,
    industry: company?.industry || null,
    founded_year: company?.founded_year ?? null,
    hq_city: company?.headquarters_city || null,
    hq_state: company?.headquarters_state || null,
    hq_country: company?.headquarters_country || null,
    specialties: company?.specialties || null,
    products_services: company?.products_services || null,
    services: company?.services || null,
    technologies: company?.technologies || null,
    linkedin_url: company?.linkedin_url || lead.company_linkedin_url || null,
    funding_stage: company?.funding_stage || null,
    funding_status_label: company?.funding_status_label || null,
    funding_resolution_summary: company?.funding_resolution_summary || null,
    total_funding_usd: company?.total_funding_usd ?? null,
    latest_funding_date: company?.latest_funding_date || null,
    therapeutic_areas: company?.therapeutic_areas || null,
    modalities: company?.modalities || null,
    development_stages: company?.development_stages || null,
  };
};

const getEnrichmentStage = (lead: Lead): {
  key: EnrichmentStageKey;
  label: string;
  floor: number;
  ceiling: number;
  paceMs: number;
} => {
  const linkedinStatus = lead.linkedin_resolution_status || 'pending';
  const profileStatus = lead.profile_enrichment_status || 'pending';

  if (profileStatus === 'completed' || profileStatus === 'ambiguous') {
    return { key: 'complete', label: 'Enrichment complete', floor: 100, ceiling: 100, paceMs: 1 };
  }

  if (profileStatus === 'failed' || profileStatus === 'blocked') {
    return { key: 'stopped', label: 'Enrichment stopped', floor: 100, ceiling: 100, paceMs: 1 };
  }

  if (profileStatus === 'processing') {
    return {
      key: 'profile_processing',
      label: 'Resolving company data',
      floor: 68,
      ceiling: 94,
      paceMs: 12000,
    };
  }

  if (linkedinStatus === 'completed' && profileStatus === 'pending') {
    return {
      key: 'linkedin_resolved',
      label: 'Gathering company details',
      floor: 48,
      ceiling: 66,
      paceMs: 7000,
    };
  }

  if (linkedinStatus === 'processing') {
    return {
      key: 'linkedin_processing',
      label: 'Finding LinkedIn contact',
      floor: 16,
      ceiling: 46,
      paceMs: 10000,
    };
  }

  return {
    key: 'queued',
    label: 'Queued for enrichment',
    floor: 6,
    ceiling: 18,
    paceMs: 6000,
  };
};

const getEnrichmentLabel = (
  stage: ReturnType<typeof getEnrichmentStage>,
  percent: number
): string => {
  if (stage.key === 'complete' || stage.key === 'stopped' || stage.key === 'queued') {
    return stage.label;
  }

  if (stage.key === 'linkedin_processing') {
    return percent < 32 ? 'Finding LinkedIn contact' : 'Building contact profile';
  }

  if (stage.key === 'linkedin_resolved') {
    return percent < 58 ? 'Gathering company details' : 'Building company profile';
  }

  if (stage.key === 'profile_processing') {
    return percent < 84 ? 'Resolving company data' : 'Finalizing enrichment';
  }

  return stage.label;
};

const getInterpolatedEnrichmentPercent = (
  startPercent: number,
  stage: ReturnType<typeof getEnrichmentStage>,
  elapsedMs: number
): number => {
  if (stage.floor >= stage.ceiling) {
    return stage.ceiling;
  }

  const safeStart = Math.min(Math.max(startPercent, stage.floor), stage.ceiling);
  const progress = 1 - Math.exp(-Math.max(elapsedMs, 0) / stage.paceMs);
  return safeStart + (stage.ceiling - safeStart) * progress;
};

const getEnrichmentErrorMessage = (lead: Lead): string | null => {
  const refreshError = lead.enrichment_refresh_last_error?.trim();
  if (refreshError) return refreshError;

  const profileError = lead.profile_enrichment_last_error?.trim();
  if (profileError) return profileError;

  const linkedinError = lead.linkedin_resolution_last_error?.trim();
  if (linkedinError) return linkedinError;

  if ((lead.profile_enrichment_status || '') === 'blocked') {
    return 'Blocked because LinkedIn resolution did not complete successfully.';
  }

  return null;
};

function parseIsoTime(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isArcovaSourcedLead(lead: Lead): boolean {
  if (typeof lead.attribution_is_arcova_sourced === 'boolean') {
    return lead.attribution_is_arcova_sourced;
  }
  const provenance = (lead.data_provenance_type || '').trim().toLowerCase();
  const source = (lead.source || '').trim().toLowerCase();
  return provenance === 'arcova' || source === 'arcova';
}

function isArcovaEnrichedLead(lead: Lead): boolean {
  if (typeof lead.attribution_is_arcova_enriched === 'boolean') {
    return lead.attribution_is_arcova_enriched;
  }
  if (lead.enrichment_refresh_status === 'succeeded') return true;
  if (lead.enrichment_refresh_finished_at) return true;
  if (lead.profile_enrichment_completed_at) return true;
  return ['completed', 'ambiguous'].includes((lead.profile_enrichment_status || '').trim().toLowerCase());
}

function getLatestArcovaTouchIso(lead: Lead): string | null {
  if (lead.attribution_latest_arcova_touch_at) {
    return lead.attribution_latest_arcova_touch_at;
  }
  const candidates = [
    lead.enrichment_refresh_finished_at,
    lead.profile_enrichment_completed_at,
    lead.data_provenance_imported_at,
    lead.updated_at,
    lead.created_at,
  ]
    .map((value) => ({ value, time: parseIsoTime(value) }))
    .filter((entry): entry is { value: string; time: number } => Boolean(entry.value) && entry.time != null)
    .sort((a, b) => b.time - a.time);

  return candidates[0]?.value ?? null;
}

function isWonAfterArcovaTouch(lead: Lead): boolean {
  if (typeof lead.attribution_won_after_arcova_touch === 'boolean') {
    return lead.attribution_won_after_arcova_touch;
  }
  if (lead.hubspot_lead_state !== 'customer') return false;
  const wonAt = parseIsoTime(lead.hubspot_latest_deal_updated_at);
  const touchedAt = parseIsoTime(getLatestArcovaTouchIso(lead));
  if (wonAt == null || touchedAt == null) return false;
  return touchedAt <= wonAt;
}

const normalizeLeadRefreshStatus = (
  status?: Lead['enrichment_refresh_status'],
): LeadRefreshStatus => {
  if (status === 'running' || status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    return status;
  }

  return 'idle';
};

const getLeadRefreshStatusMeta = (
  status: LeadRefreshStatus,
): { label: string; className: string } => {
  switch (status) {
    case 'running':
      return {
        label: 'Enrichment in progress',
        className: 'border-arcova-teal/25 bg-arcova-teal/5 text-arcova-teal',
      };
    case 'succeeded':
      return {
        label: 'Enrichment done',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    case 'failed':
      return {
        label: 'Previous enrichment failed to run',
        className: 'border-amber-200 bg-amber-50 text-amber-700',
      };
    case 'cancelled':
      return {
        label: 'Enrichment stopped',
        className: 'border-slate-200 bg-slate-50 text-slate-600',
      };
    default:
      return {
        label: 'Idle',
        className: 'border-gray-200 bg-gray-50 text-gray-500',
      };
  }
};

function isAvanzadoTestContact(lead: { full_name?: string | null; linkedin_url?: string | null }): boolean {
  const name = (lead.full_name || '').toLowerCase();
  const linkedin = (lead.linkedin_url || '').toLowerCase();
  return name.includes('avanzado') || linkedin.includes('a-avanzado');
}

function getEmailDeliverabilityMeta(
  status: string | null | undefined,
  options?: { email?: string; companyDomain?: string | null },
) {
  return getContactEmailDeliverabilityDisplayMeta(status, options);
}

function getSortValue(lead: Lead | QueryLead, col: string): string | number {
  switch (col) {
    case 'name':
      return (
        (lead as Lead).full_name ||
        [(lead as Lead).first_name, (lead as Lead).last_name].filter(Boolean).join(' ') ||
        ''
      ).toLowerCase();
    case 'job_title':
      return ((lead.resolved_current_job_title || lead.job_title) ?? '').toLowerCase();
    case 'company':
      return (
        (lead.resolved_current_company_name || lead.company_name) ?? ''
      ).toLowerCase();
    case 'status': {
      const order = LEAD_ACTION_SORT_ORDER;
      // Gate CRM-resolved state by the suppression cooldown (same as getContactAction).
      const crmForAction = isCrmSuppressed(
        (lead as Lead).hubspot_lead_state ?? null,
        (lead as Lead).hubspot_latest_deal_updated_at ?? null,
      )
        ? (lead as Lead).hubspot_lead_state ?? null
        : null;
      return order[applyOutreachOverride(
        getActionFromScores(
          resolveCompanyFitForLeadAction(lead),
          lead.contact_fit_score ?? null,
          effectiveReadiness(
            (lead as Lead).company_readiness_score ?? null,
            (lead as Lead).contact_readiness_score ?? null,
          ),
          crmForAction,
        ),
        ((lead as Lead).latest_sequence_status ?? null) as SequenceDispatchStatus,
        crmForAction,
      )] ?? 0;
    }
    case 'company_fit':
      return (
        (lead as QueryLead).company_fit_score ??
        (lead as QueryLead).companies?.company_fit_score ??
        -1
      );
    case 'contact_fit':
      return lead.contact_fit_score ?? -1;
    case 'priority':
      return displayContactPriority(lead as Lead) ?? -1;
    case 'crm': {
      // Cluster CRM badges by engagement so sorting groups them sensibly:
      // open deal → won → lost → no deal. Mirrors getHubSpotTableBadge states.
      const crmOrder: Record<string, number> = { active: 4, customer: 3, dormant: 2, context_only: 1, none: 0 };
      return crmOrder[(lead as Lead).hubspot_lead_state ?? 'none'] ?? 0;
    }
    case 'source':
      return ((lead as QueryLead).data_provenance_type ?? '').toLowerCase();
    case 'signals':
      return lead.readiness_score && lead.readiness_score > 0 ? 1 : 0;
    case 'icp_match':
      return ((lead as QueryLead).matched_icp_label ?? '').toLowerCase();
    case 'funding_stage':
      return ((lead as QueryLead).companies?.funding_stage ?? '').toLowerCase();
    case 'therapeutic_areas':
      return (((lead as QueryLead).companies?.therapeutic_areas ?? [])[0] ?? '').toLowerCase();
    case 'seniority':
      return (lead.seniority_level ?? '').toLowerCase();
    default:
      return '';
  }
}

function applySortCol<T extends Lead | QueryLead>(
  items: T[],
  col: string | null,
  dir: 'asc' | 'desc',
): T[] {
  if (!col) return items;
  return [...items].sort((a, b) => {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb));
    return dir === 'asc' ? cmp : -cmp;
  });
}

function SortArrow({ col, activeCol, dir }: { col: string; activeCol: string | null; dir: 'asc' | 'desc' }) {
  if (col !== activeCol) return <ChevronsUpDown className="w-3 h-3 text-gray-300 shrink-0" />;
  return dir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-arcova-teal shrink-0" />
    : <ChevronDown className="w-3 h-3 text-arcova-teal shrink-0" />;
}

// ─────────────────────────────────────────────────────────────────────────────

export function ContactsWorkspace() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [agentTrigger, setAgentTrigger] = useState<AgentPendingMessage | undefined>();
  // Value of the floating "Intercom-style" chat bar shown while a contact card is open.
  // On submit we dismiss the contact card and forward the text to AgentPanel as a
  // pending message — the agent expands back into view and answers immediately.
  const [agentChatBarValue, setAgentChatBarValue] = useState('');
  // Docked mode: while a contact panel is open and the user expands the agent,
  // the agent takes the top half and the drawer drops to the bottom half (design 50/50).
  const [agentDocked, setAgentDocked] = useState(false);
  const fireAgent = (text: string, threadPreview?: string) =>
    setAgentTrigger((prev) => ({
      text,
      nonce: (prev?.nonce ?? 0) + 1,
      ...(threadPreview ? { threadPreview } : {}),
    }));
  const dashboardAgentTaskFiredRef = useRef<string | null>(null);
  const leadsScrollRef = useRef<HTMLDivElement | null>(null);

  // Inline `grid-template-columns` value — driven by viewport width. See the const
  // declarations above for the four tiers. We set this via `style` rather than long
  // chained Tailwind arbitrary classes because the JIT compiler dropped the longest
  // variant and the columns broke at full width.
  const leadsGridCols = useLeadsTableGridCols();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<EditableLeadFields | null>(null);
  const [leadEditError, setLeadEditError] = useState<string | null>(null);
  const [savingLeadId, setSavingLeadId] = useState<string | null>(null);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [refreshingLeadId, setRefreshingLeadId] = useState<string | null>(null);
  const [findingEmailLeadId, setFindingEmailLeadId] = useState<string | null>(null);
  const [revealingPhoneLeadId, setRevealingPhoneLeadId] = useState<string | null>(null);
  const [findEmailErrorByLeadId, setFindEmailErrorByLeadId] = useState<Record<string, string>>({});
  const [activeLeadsCap, setActiveLeadsCap] = useState<{ used: number; cap: number } | null>(null);
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [pushingToHubspot, setPushingToHubspot] = useState(false);
  const [pullingHubspotCrm, setPullingHubspotCrm] = useState(false);
  const [runningEmailVerification, setRunningEmailVerification] = useState(false);
  const [emailVerificationResult, setEmailVerificationResult] = useState<{
    scanned: number;
    eligible: number;
    finderAttempts?: number;
    finderFound?: number;
    finderFailed?: number;
    verified: number;
    invalid: number;
    catchAll: number;
    unknown: number;
    failed: number;
    skippedInvalidEmail: number;
    priorityMin: number;
    limit: number;
    items?: EmailVerificationResultItem[];
    error?: string;
  } | null>(null);
  const [hubspotSyncResult, setHubspotSyncResult] = useState<{
    contacts: { upserted: number; errors: number };
    skipped: number;
    skippedContacts: { name: string; company: string | null; reason: string }[];
    error?: string;
    code?: string;
  } | null>(null);
  const [hubspotPullResult, setHubspotPullResult] = useState<{
    fetchedContacts: number;
    mirroredContacts: number;
    contactEventsEmitted: number;
    contactContextOnlyEvents: number;
    contactRecomputedCompanies: number;
    contactSkippedUnresolvedCompanies: number;
    fetchedDeals: number;
    mirroredDeals: number;
    emittedEvents: number;
    recomputedCompanies: number;
    skippedUnresolvedCompanies: number;
    contactItems?: { name: string | null; company: string | null }[];
    dealItems?: { name: string | null; company: string | null }[];
    error?: string;
    code?: string;
  } | null>(null);
  const [syncResultExpanded, setSyncResultExpanded] = useState(false);
  // Which pull-banner metric's item list is expanded ('contacts' | 'deals' | null).
  const [pullDetailOpen, setPullDetailOpen] = useState<string | null>(null);
  const [emailVerificationDetailOpen, setEmailVerificationDetailOpen] = useState<string | null>(null);
  const [stoppingLeadId, setStoppingLeadId] = useState<string | null>(null);
  const [stopEnrichmentError, setStopEnrichmentError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Detail fetched per-selection from /api/contacts/[id]. Side panel reads from
  // merged { ...selectedLeadLean, ...selectedLeadDetail } so it has both the
  // lean-list fields (readiness, attribution, hubspot state) AND the canonical
  // detail fields (full companies(...) nested data) without bloating the list.
  const [selectedLeadDetailById, setSelectedLeadDetailById] = useState<Record<string, Partial<Lead>>>({});
  const [selectedPreview, setSelectedPreview] = useState<'contact' | 'hubspot' | 'scoring' | 'action' | 'signals' | 'priority' | 'outreach'>('contact');
  // Mirror the AgentPanel column's bounding rect so the contact drawer can
  // overlay it pixel-for-pixel regardless of viewport width or padding maths.
  // The AgentPanel renders its outermost div with the marker class
  // `.contacts-leads-agent-col` (passed via the `className` prop below).
  const [agentRect, setAgentRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Leaving a contact returns the agent to its normal full-column layout.
  useEffect(() => {
    if (!selectedLeadId) setAgentDocked(false);
  }, [selectedLeadId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = document.querySelector<HTMLElement>('.contacts-leads-agent-col');
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      // Below 768px the AgentPanel is `display: none` — its bounding rect is 0×0.
      // Null out the rect in that case so the contact card / floating chat bar fall
      // back to their CSS-class positioning (full-bleed glass card from the right).
      if (r.width === 0 || r.height === 0) {
        setAgentRect(null);
        return;
      }
      setAgentRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  const [isWorkHistoryExpanded, setIsWorkHistoryExpanded] = useState(false);
  const [contactPanelOpen, setContactPanelOpen] = useState({
    fit: true,
    about: true,
    details: true,
    workHistory: true,
  });
  const [scoringPanelOpen, setScoringPanelOpen] = useState({
    priority: true,
    icpFit: true,
    contactFit: true,
    otherIcps: false,
  });
  const [expandedBars, setExpandedBars] = useState<Set<string>>(new Set());
  const toggleBar = (key: string) => setExpandedBars(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const [companyFitByCompanyId, setCompanyFitByCompanyId] = useState<Record<string, CompanyFitFetchState>>({});
  const [contactFitByContactId, setContactFitByContactId] = useState<Record<string, ContactFitFetchState>>({});
  const [hubspotCrmByContactId, setHubspotCrmByContactId] = useState<Record<string, HubSpotCrmFetchState>>({});
  const [panelSummariesByContactId, setPanelSummariesByContactId] = useState<Record<string, PanelSummariesFetchState>>({});
  const [failedProfilePhotoByContactId, setFailedProfilePhotoByContactId] = useState<Record<string, true>>({});
  const companyFitCacheRef = useRef(companyFitByCompanyId);
  companyFitCacheRef.current = companyFitByCompanyId;
  const contactFitCacheRef = useRef(contactFitByContactId);
  contactFitCacheRef.current = contactFitByContactId;
  const hubspotCrmCacheRef = useRef(hubspotCrmByContactId);
  hubspotCrmCacheRef.current = hubspotCrmByContactId;
  const panelSummariesCacheRef = useRef(panelSummariesByContactId);
  panelSummariesCacheRef.current = panelSummariesByContactId;
  const [enrichmentVisuals, setEnrichmentVisuals] = useState<Record<string, EnrichmentVisualState>>({});
  const [progressNow, setProgressNow] = useState(() => Date.now());

  // Agent-driven filter state — just the set of matching contact IDs
  const [agentFilterIds, setAgentFilterIds] = useState<Set<string> | null>(null);

  // Column sort state (client-side, applies to current page / agent filter)
  const [tableSortCol, setTableSortCol] = useState<string | null>('priority');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!selectedLeadId) return;
    const selected = leads.find((lead) => lead.id === selectedLeadId);
    if (!selected?.profile_photo_cached && !selected?.profile_photo_url) return;
    setFailedProfilePhotoByContactId((prev) => {
      if (!prev[selectedLeadId]) return prev;
      const next = { ...prev };
      delete next[selectedLeadId];
      return next;
    });
  }, [selectedLeadId, leads]);

  const fetchLeads = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoadingLeads(true);
    // `silent` is the convention for "just-mutated, need fresh data" so
    // we bypass the module-level cache. Initial load (silent=false) and
    // tab-switch returns happily use the cache.
    if (silent) invalidateCache('/api/contacts');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set('search', search);

      const { data: result } = await cachedJson<{
        data?: Lead[];
        total?: number;
      }>(`/api/contacts?${params}`);
      const nextLeads = (result.data || []).slice().sort((a: Lead, b: Lead) => {
        const aScore = a.overall_fit_score ?? -1;
        const bScore = b.overall_fit_score ?? -1;
        return bScore - aScore;
      });
      setLeads(nextLeads);
      setTotal(result.total || 0);

      // Preserve the user's current selection if it's still present.
      setSelectedLeadId((current) => {
        if (current && nextLeads.some((lead: Lead) => lead.id === current)) return current;
        return null;
      });
    } catch (err) {
      console.error('Error fetching leads:', err);
    } finally {
      if (!silent) setLoadingLeads(false);
    }
  }, [user, page, search]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Fetch full detail for the selected lead (full companies(...) + extra lead
  // fields) — these aren't in the lean list response. Cached via page-fetch-cache
  // so re-selecting is instant.
  useEffect(() => {
    if (!selectedLeadId) return;
    if (selectedLeadDetailById[selectedLeadId]) return; // already loaded
    let cancelled = false;
    (async () => {
      try {
        const { data: result } = await cachedJson<{ data?: Partial<Lead> }>(
          `/api/contacts/${encodeURIComponent(selectedLeadId)}`,
        );
        if (cancelled || !result.data) return;
        setSelectedLeadDetailById((prev) => ({
          ...prev,
          [selectedLeadId]: result.data!,
        }));
      } catch (e) {
        console.error('Error fetching lead detail:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, selectedLeadDetailById]);

  useEffect(() => {
    fetch('/api/hubspot/status')
      .then((r) => r.json())
      .then((data) => setHubspotConnected(data.connected === true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/billing/summary')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.activeLeads) setActiveLeadsCap(data.activeLeads);
      })
      .catch(() => {});
  }, []);

  // Opens the Nango Connect UI (same flow as /import). Returns true once the modal
  // is open; the actual reconnect + retry happen in the onEvent 'connect' handler.
  // Returns false only if we couldn't get a session token / open the modal at all.
  const handleHubSpotReconnect = useCallback(async (afterReconnect?: () => void): Promise<boolean> => {
    try {
      const sessionRes = await fetch('/api/nango/session', { method: 'POST' });
      if (!sessionRes.ok) return false;
      const { sessionToken } = await sessionRes.json();
      if (!sessionToken) return false;

      const nangoClient = new Nango();
      const connectUI = nangoClient.openConnectUI({
        onEvent: async (event) => {
          if (event.type === 'connect') {
            const { connectionId, providerConfigKey } = event.payload;
            await fetch('/api/nango/connection', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ integrationId: providerConfigKey, connectionId }),
            });
            setHubspotConnected(true);
            setHubspotSyncResult(null);
            setHubspotPullResult(null);
            afterReconnect?.();
          }
        },
      });
      connectUI.setSessionToken(sessionToken);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handlePushToHubspot = useCallback(async () => {
    if (pushingToHubspot) return;
    setPushingToHubspot(true);
    setHubspotSyncResult(null);
    setSyncResultExpanded(false);
    try {
      const res = await fetch('/api/hubspot/push-enrichment', { method: 'POST' });
      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* unparseable body */ }
      if (res.ok) {
        if (data?.contacts) {
          setHubspotSyncResult(data as Parameters<typeof setHubspotSyncResult>[0]);
        }
      } else {
        const code = (data?.code as string) || undefined;
        if (code === 'token_error') {
          const reconnected = await handleHubSpotReconnect(handlePushToHubspot);
          if (!reconnected) {
            setHubspotSyncResult({ contacts: { upserted: 0, errors: 0 }, skipped: 0, skippedContacts: [], error: 'HubSpot token expired — reconnect HubSpot in Settings to continue.', code });
          }
        } else {
          const msg = (data?.error as string) || text || `HTTP ${res.status}`;
          setHubspotSyncResult({ contacts: { upserted: 0, errors: 0 }, skipped: 0, skippedContacts: [], error: msg, code });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHubspotSyncResult({ contacts: { upserted: 0, errors: 0 }, skipped: 0, skippedContacts: [], error: msg });
    } finally {
      setPushingToHubspot(false);
    }
  }, [pushingToHubspot]);

  const handlePullHubspotCrm = useCallback(async () => {
    if (pullingHubspotCrm) return;
    setPullingHubspotCrm(true);
    setHubspotPullResult(null);
    setPullDetailOpen(null);
    try {
      const res = await fetch('/api/hubspot/pull-crm', { method: 'POST' });
      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* unparseable body */ }
      if (!res.ok) {
        const code = (data?.code as string) || undefined;
        if (code === 'token_error') {
          const reconnected = await handleHubSpotReconnect(handlePullHubspotCrm);
          if (!reconnected) {
            setHubspotPullResult({ fetchedContacts: 0, mirroredContacts: 0, contactEventsEmitted: 0, contactContextOnlyEvents: 0, contactRecomputedCompanies: 0, contactSkippedUnresolvedCompanies: 0, fetchedDeals: 0, mirroredDeals: 0, emittedEvents: 0, recomputedCompanies: 0, skippedUnresolvedCompanies: 0, error: 'HubSpot token expired — reconnect HubSpot in Settings to continue.', code });
          }
          return;
        }
        const msg = (data?.error as string) || text || `HTTP ${res.status}`;
        setHubspotPullResult({ fetchedContacts: 0, mirroredContacts: 0, contactEventsEmitted: 0, contactContextOnlyEvents: 0, contactRecomputedCompanies: 0, contactSkippedUnresolvedCompanies: 0, fetchedDeals: 0, mirroredDeals: 0, emittedEvents: 0, recomputedCompanies: 0, skippedUnresolvedCompanies: 0, error: msg, code });
        return;
      }
      if (data?.result) {
        setHubspotPullResult(data.result as Parameters<typeof setHubspotPullResult>[0]);
        await fetchLeads(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHubspotPullResult({ fetchedContacts: 0, mirroredContacts: 0, contactEventsEmitted: 0, contactContextOnlyEvents: 0, contactRecomputedCompanies: 0, contactSkippedUnresolvedCompanies: 0, fetchedDeals: 0, mirroredDeals: 0, emittedEvents: 0, recomputedCompanies: 0, skippedUnresolvedCompanies: 0, error: msg });
    } finally {
      setPullingHubspotCrm(false);
    }
  }, [pullingHubspotCrm, fetchLeads]);

  const handleRunEmailVerification = useCallback(async () => {
    if (runningEmailVerification) return;
    setRunningEmailVerification(true);
    setEmailVerificationResult(null);
    setEmailVerificationDetailOpen(null);
    try {
      const res = await fetch('/api/contacts/run-email-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 25 }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setEmailVerificationResult({
          scanned: 0,
          eligible: 0,
          finderAttempts: 0,
          finderFound: 0,
          finderFailed: 0,
          verified: 0,
          invalid: 0,
          catchAll: 0,
          unknown: 0,
          failed: 0,
          skippedInvalidEmail: 0,
          priorityMin: 0,
          limit: 25,
          error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
        });
        return;
      }

      setEmailVerificationResult(data.result ?? null);
      await fetchLeads(true);
    } catch (error) {
      setEmailVerificationResult({
        scanned: 0,
        eligible: 0,
        finderAttempts: 0,
        finderFound: 0,
        finderFailed: 0,
        verified: 0,
        invalid: 0,
        catchAll: 0,
        unknown: 0,
        failed: 0,
        skippedInvalidEmail: 0,
        priorityMin: 0,
        limit: 25,
        error: error instanceof Error ? error.message : 'Could not refresh emails.',
      });
    } finally {
      setRunningEmailVerification(false);
    }
  }, [runningEmailVerification, fetchLeads]);

  const handleFindNewEmail = useCallback(async (leadId: string) => {
    if (findingEmailLeadId) return;
    if (!window.confirm('Find and validate a new email for 11 credits?')) return;
    setFindingEmailLeadId(leadId);
    setFindEmailErrorByLeadId((prev) => {
      const next = { ...prev };
      delete next[leadId];
      return next;
    });
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(leadId)}/find-new-email`, {
        method: 'POST',
        headers: { 'x-operation-id': crypto.randomUUID() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
        setFindEmailErrorByLeadId((prev) => ({ ...prev, [leadId]: message }));
        return;
      }

      const contactPatch = (data.data?.contact ?? {}) as Partial<Lead>;
      const contactEmails = (data.data?.contact_emails ?? null) as ContactEmailRow[] | null;
      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                email: contactPatch.email ?? lead.email,
                email_deliverability: contactPatch.email_deliverability ?? lead.email_deliverability,
                email_status: contactPatch.email_status ?? lead.email_status,
                contact_emails: contactEmails ?? lead.contact_emails,
                updated_at: contactPatch.updated_at ?? lead.updated_at,
              }
            : lead,
        ),
      );
      setSelectedLeadDetailById((prev) => ({
        ...prev,
        [leadId]: {
          ...prev[leadId],
          email: contactPatch.email ?? prev[leadId]?.email,
          email_deliverability: contactPatch.email_deliverability ?? prev[leadId]?.email_deliverability,
          email_status: contactPatch.email_status ?? prev[leadId]?.email_status,
          contact_emails: contactEmails ?? prev[leadId]?.contact_emails,
          updated_at: contactPatch.updated_at ?? prev[leadId]?.updated_at,
        },
      }));
      invalidateCache(`/api/contacts/${encodeURIComponent(leadId)}`);
      await fetchLeads(true);
    } catch (error) {
      setFindEmailErrorByLeadId((prev) => ({
        ...prev,
        [leadId]: error instanceof Error ? error.message : 'Could not find a new email.',
      }));
    } finally {
      setFindingEmailLeadId(null);
    }
  }, [findingEmailLeadId, fetchLeads]);

  const handleRevealPhone = useCallback(async (leadId: string) => {
    if (revealingPhoneLeadId) return;
    if (!window.confirm('Reveal a phone number for 20 credits?')) return;
    setRevealingPhoneLeadId(leadId);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(leadId)}/reveal-phone`, {
        method: 'POST',
        headers: { 'x-operation-id': crypto.randomUUID() },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Phone reveal could not be started.');
      await fetchLeads(true);
      invalidateCache(`/api/contacts/${encodeURIComponent(leadId)}`);
    } catch (error) {
      setLeadEditError(error instanceof Error ? error.message : 'Phone reveal failed.');
    } finally {
      setRevealingPhoneLeadId(null);
    }
  }, [revealingPhoneLeadId, fetchLeads]);

  const handleDownloadCsv = useCallback(async () => {
    // Fetch all leads (loop pages)
    const allLeads: Lead[] = [];
    let p = 1;
    while (true) {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: '100',
      });
      if (search) params.set('search', search);
      const res = await fetch(`/api/contacts?${params}`);
      if (!res.ok) break;
      const result = await res.json();
      const batch: Lead[] = result.data || [];
      allLeads.push(...batch);
      if (allLeads.length >= (result.total || 0) || batch.length === 0) break;
      p++;
    }

    const actionLabel = (lead: Lead) => formatLeadActionLabel(getContactAction(lead));

    const pct = (n: number | null | undefined) =>
      n != null && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '';

    const headers = [
      // Contact
      'Name', 'Email', 'LinkedIn', 'Job Title', 'Seniority', 'Function',
      // Company
      'Company', 'Company Domain', 'Company LinkedIn',
      // Firmographics
      'Company Type', 'Therapeutic Areas', 'Modalities', 'Development Stages',
      'Funding Stage', 'Total Raised (USD)', 'Employees', 'HQ City', 'HQ Country', 'Founded',
      // Fit & ICP
      'Overall Fit', 'Company Fit', 'Contact Fit', 'ICP Best Match',
      // Action
      'Action',
    ];

    const rows = allLeads.map((l) => {
      const co = l.companies;
      return [
        // Contact
        l.full_name ?? '',
        l.email ?? '',
        l.linkedin_url ?? '',
        l.job_title ?? '',
        l.seniority_level ?? '',
        l.business_area ?? '',
        // Company
        l.company_name ?? co?.company_name ?? '',
        l.company_domain ?? co?.domain ?? '',
        co?.linkedin_url ?? '',
        // Firmographics
        co?.company_type ?? '',
        (co?.therapeutic_areas ?? []).join('; '),
        (co?.modalities ?? []).join('; '),
        (co?.development_stages ?? []).join('; '),
        co?.funding_stage ?? '',
        co?.total_funding_usd != null ? String(co.total_funding_usd) : '',
        co?.employee_count != null ? String(co.employee_count) : (co?.employee_range ?? ''),
        co?.headquarters_city ?? '',
        co?.headquarters_country ?? '',
        co?.founded_year != null ? String(co.founded_year) : '',
        // Fit & ICP
        pct(l.overall_fit_score),
        pct(typeof l.company_fit_score === 'number' ? l.company_fit_score : co?.company_fit_score ?? null),
        pct(l.contact_fit_score),
        l.matched_icp_label ?? '',
        // Action
        actionLabel(l),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.map((h) => `"${h}"`).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [search]);


  useEffect(() => {
    const id = searchParams.get('lead');
    if (!id || leads.length === 0) return;
    if (leads.some((l) => l.id === id)) {
      setSelectedLeadId(id);
      // Allow deep-linking straight to a panel tab (e.g. the accounts page sends
      // ?lead=<id>&tab=outreach when you click Reach out on an account).
      const tab = searchParams.get('tab');
      const validTabs = ['contact', 'hubspot', 'scoring', 'action', 'signals', 'priority', 'outreach'] as const;
      setSelectedPreview(
        (validTabs as readonly string[]).includes(tab ?? '')
          ? (tab as (typeof validTabs)[number])
          : 'contact',
      );
    }
  }, [searchParams, leads]);

  const urlSearchParam = searchParams.get('search') ?? '';
  useEffect(() => {
    const q = urlSearchParam.trim();
    if (!q) return;
    setSearchInput(q);
    setSearch(q);
    setPage(1);
  }, [urlSearchParam]);

  const dashboardAgentTask = searchParams.get('agentTask') ?? '';
  useEffect(() => {
    if (!user || dashboardAgentTaskFiredRef.current === dashboardAgentTask) return;

    const taskDefs: Record<string, { prompt: string; threadPreview: string }> = {
      new_contacts: {
        prompt:
          'Filter the contacts table to the newest contacts from the latest import batch. Use filter_leads_table with filters.latestImportOnly=true, columns name/job_title/company/status/contact_fit/source, sort by status_best_first. Keep your reply short and friendly.',
        threadPreview: 'Show newest contacts from my latest import',
      },
      best_leads: {
        prompt:
          'Filter the contacts table to the best leads to work now. Use filter_leads_table with filters.actions=["reach_out","monitor"], columns name/job_title/company/status/contact_fit/source, sort by status_best_first. Keep your reply short and friendly.',
        threadPreview: 'Show my best leads to work now',
      },
      arcova_contacts_today: {
        prompt:
          'Filter the contacts table to Arcova-sourced contacts imported today. Use filter_leads_table with filters.sources=["arcova"] and filters.importedToday=true, columns name/job_title/company/status/contact_fit/source, sort by status_best_first. Keep your reply short and friendly, and mention these are the new Arcova contacts from today.',
        threadPreview: 'Show Arcova contacts from today',
      },
    };

    const companyId = searchParams.get('companyId') ?? '';
    let entry = taskDefs[dashboardAgentTask];
    if (dashboardAgentTask === 'arcova_contacts_at_company' && companyId) {
      entry = {
        prompt: `Filter the contacts table to Arcova-sourced contacts at company id ${companyId}. Use filter_leads_table with filters.companyIds=["${companyId}"] and filters.sources=["arcova"], columns name/job_title/company/status/contact_fit/source, sort by status_best_first. Keep your reply short and friendly, and mention these are the new Arcova contacts for this company.`,
        threadPreview: 'Show Arcova contacts for this company',
      };
    }

    if (!entry) return;

    dashboardAgentTaskFiredRef.current = dashboardAgentTask;
    setAgentTrigger((prev) => ({
      text: entry.prompt,
      nonce: (prev?.nonce ?? 0) + 1,
      threadPreview: entry.threadPreview,
    }));
  }, [dashboardAgentTask, user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setIsWorkHistoryExpanded(false);
  }, [selectedLeadId, selectedPreview]);

  const startEditingLead = (lead: Lead) => {
    setEditingLeadId(lead.id);
    setLeadEditError(null);
    setEditingFields({
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      email: lead.email || '',
      job_title: lead.job_title || '',
      headline: lead.headline || '',
      linkedin_url: lead.linkedin_url || '',
      company_name: lead.company_name || '',
      company_domain: lead.company_domain || '',
      company_linkedin_url: lead.company_linkedin_url || '',
      location: lead.location || '',
      city: lead.city || '',
      country: lead.country || '',
      user_secondary_emails: [...userSecondaryEmailsFromLead(lead)],
      user_phones: [...userPhonesFromLead(lead)],
      email_deliverability_by_email: emailDeliverabilityFromLead(lead),
    });
  };

  const cancelEditingLead = () => {
    setEditingLeadId(null);
    setEditingFields(null);
    setLeadEditError(null);
  };

  useEffect(() => {
    if (selectedPreview !== 'contact' && editingLeadId) {
      setEditingLeadId(null);
      setEditingFields(null);
      setLeadEditError(null);
    }
  }, [selectedPreview, editingLeadId]);

  const handleLeadsFilter = (_filter: AgentLeadsFilter, leads: QueryLead[]) => {
    setAgentFilterIds(new Set(leads.map((l) => l.id)));
    setSelectedLeadId(null);
    setTableSortCol(null);
  };

  const handleQueryClear = () => {
    setAgentFilterIds(null);
    setSelectedLeadId(null);
    setTableSortCol(null);
  };

  const handleSortCol = (col: string) => {
    if (tableSortCol === col) {
      setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortCol(col);
      setTableSortDir('asc');
    }
  };

  const updateEditingField = (
    field: keyof Omit<EditableLeadFields, 'user_secondary_emails' | 'user_phones'>,
    value: string,
  ) => {
    setLeadEditError(null);
    setEditingFields((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateUserSecondaryEmailAt = (index: number, value: string) => {
    setLeadEditError(null);
    setEditingFields((prev) => {
      if (!prev) return prev;
      const next = [...prev.user_secondary_emails];
      next[index] = value;
      return { ...prev, user_secondary_emails: next };
    });
  };

  const addUserSecondaryEmail = () => {
    setLeadEditError(null);
    setEditingFields((prev) =>
      prev ? { ...prev, user_secondary_emails: [...prev.user_secondary_emails, ''] } : prev,
    );
  };

  const removeUserSecondaryEmailAt = (index: number) => {
    setLeadEditError(null);
    setEditingFields((prev) => {
      if (!prev) return prev;
      const next = prev.user_secondary_emails.filter((_, i) => i !== index);
      return { ...prev, user_secondary_emails: next };
    });
  };

  const updateUserPhoneAt = (index: number, value: string) => {
    setLeadEditError(null);
    setEditingFields((prev) => {
      if (!prev) return prev;
      const next = [...prev.user_phones];
      next[index] = value;
      return { ...prev, user_phones: next };
    });
  };

  const addUserPhone = () => {
    setLeadEditError(null);
    setEditingFields((prev) =>
      prev ? { ...prev, user_phones: [...prev.user_phones, ''] } : prev,
    );
  };

  const removeUserPhoneAt = (index: number) => {
    setLeadEditError(null);
    setEditingFields((prev) => {
      if (!prev) return prev;
      const next = prev.user_phones.filter((_, i) => i !== index);
      return { ...prev, user_phones: next };
    });
  };

  const updateEmailDeliverabilityForAddress = (email: string, value: string | null) => {
    const key = emailDeliverabilityEditKey(email);
    if (!key) return;
    setLeadEditError(null);
    setEditingFields((prev) =>
      prev
        ? {
            ...prev,
            email_deliverability_by_email: {
              ...prev.email_deliverability_by_email,
              [key]: value,
            },
          }
        : prev,
    );
  };

  const saveLead = async (leadId: string) => {
    if (!editingFields) return;

    const primaryTrim = editingFields.email.trim();
    if (primaryTrim && !looksLikeEmail(primaryTrim)) {
      setLeadEditError('Enter a valid email address (for example name@company.com).');
      return;
    }

    const secondaryTrimmed = editingFields.user_secondary_emails.map((s) => s.trim()).filter(Boolean);
    for (const s of secondaryTrimmed) {
      if (!looksLikeEmail(s)) {
        setLeadEditError('Each additional email must look like a valid address.');
        return;
      }
    }

    const phonesTrimmed = editingFields.user_phones.map((p) => p.trim()).filter(Boolean);
    for (const p of phonesTrimmed) {
      if (!looksLikePhone(p)) {
        setLeadEditError('Each phone must look like a valid number.');
        return;
      }
    }

    setLeadEditError(null);
    setSavingLeadId(leadId);
    const leadBeingEdited = leads.find((lead) => lead.id === leadId);
    try {
      const response = await fetch(`/api/contacts/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: `${editingFields.first_name} ${editingFields.last_name}`.trim(),
          first_name: editingFields.first_name,
          last_name: editingFields.last_name,
          email: editingFields.email,
          job_title: editingFields.job_title,
          headline: editingFields.headline,
          linkedin_url: editingFields.linkedin_url,
          company_name: editingFields.company_name,
          company_domain: editingFields.company_domain,
          company_linkedin_url: editingFields.company_linkedin_url,
          location: editingFields.location,
          city: editingFields.city,
          country: editingFields.country,
          user_secondary_emails: secondaryTrimmed.filter(
            (s) => s.toLowerCase() !== primaryTrim.toLowerCase(),
          ),
          user_phones: phonesTrimmed,
          email_deliverability_overrides: leadBeingEdited
            ? collectEmailDeliverabilityOverrides(leadBeingEdited, editingFields)
            : [],
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        setLeadEditError(
          typeof result.error === 'string' && result.error ? result.error : 'Failed to update lead.',
        );
        return;
      }

      const d = result.data as Lead & {
        contact_emails?: ContactEmailRow[];
        contact_phones?: ContactPhoneRow[];
      };

      setLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                full_name: d.full_name ?? lead.full_name,
                first_name: d.first_name ?? lead.first_name,
                last_name: d.last_name ?? lead.last_name,
                email: d.email ?? lead.email,
                email_deliverability:
                  (d as Lead).email_deliverability ??
                  (() => {
                    const primary = (d.email ?? lead.email)?.trim();
                    if (!primary) return lead.email_deliverability;
                    const match = (d.contact_emails ?? lead.contact_emails ?? []).find(
                      (row) => row.email.trim().toLowerCase() === primary.toLowerCase(),
                    );
                    return match?.email_deliverability ?? lead.email_deliverability;
                  })(),
                job_title: d.job_title ?? lead.job_title,
                headline: d.headline ?? lead.headline,
                linkedin_url: d.linkedin_url ?? lead.linkedin_url,
                company_name: d.company_name ?? lead.company_name,
                company_domain: d.company_domain ?? lead.company_domain,
                company_linkedin_url: d.company_linkedin_url ?? lead.company_linkedin_url,
                location: d.location ?? lead.location,
                city: d.city ?? lead.city,
                country: d.country ?? lead.country,
                contact_emails: Array.isArray(d.contact_emails)
                  ? d.contact_emails
                  : lead.contact_emails,
                contact_phones: Array.isArray(d.contact_phones)
                  ? d.contact_phones
                  : lead.contact_phones,
                updated_at: d.updated_at ?? lead.updated_at,
              }
            : lead
        )
      );
      // Also patch the per-lead DETAIL cache. selectedLead is the merge of the
      // lean list AND selectedLeadDetailById with DETAIL winning — so without
      // this, the freshly-saved fields stay hidden behind the stale detail copy
      // until the user re-selects. Mirror stopLeadEnrichment (patch both), and
      // invalidate the detail fetch cache so the next server read is fresh.
      setSelectedLeadDetailById((prev) =>
        leadId in prev
          ? {
              ...prev,
              [leadId]: {
                ...prev[leadId],
                full_name: d.full_name ?? prev[leadId].full_name,
                first_name: d.first_name ?? prev[leadId].first_name,
                last_name: d.last_name ?? prev[leadId].last_name,
                email: d.email ?? prev[leadId].email,
                email_deliverability:
                  (d as Lead).email_deliverability ??
                  (() => {
                    const primary = (d.email ?? prev[leadId].email)?.trim();
                    if (!primary) return prev[leadId].email_deliverability;
                    const match = (d.contact_emails ?? prev[leadId].contact_emails ?? []).find(
                      (row) => row.email.trim().toLowerCase() === primary.toLowerCase(),
                    );
                    return match?.email_deliverability ?? prev[leadId].email_deliverability;
                  })(),
                job_title: d.job_title ?? prev[leadId].job_title,
                headline: d.headline ?? prev[leadId].headline,
                linkedin_url: d.linkedin_url ?? prev[leadId].linkedin_url,
                company_name: d.company_name ?? prev[leadId].company_name,
                company_domain: d.company_domain ?? prev[leadId].company_domain,
                company_linkedin_url: d.company_linkedin_url ?? prev[leadId].company_linkedin_url,
                location: d.location ?? prev[leadId].location,
                city: d.city ?? prev[leadId].city,
                country: d.country ?? prev[leadId].country,
                contact_emails: Array.isArray(d.contact_emails) ? d.contact_emails : prev[leadId].contact_emails,
                contact_phones: Array.isArray(d.contact_phones) ? d.contact_phones : prev[leadId].contact_phones,
                updated_at: d.updated_at ?? prev[leadId].updated_at,
              },
            }
          : prev,
      );
      invalidateCache(`/api/contacts/${encodeURIComponent(leadId)}`);
      cancelEditingLead();
    } catch (error) {
      console.error('Error updating lead:', error);
      setLeadEditError(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setSavingLeadId(null);
    }
  };

  const deleteLead = async (leadId: string) => {
    const lead = leads.find((item) => item.id === leadId) ?? null;
    const label = lead?.full_name || lead?.email || 'this contact';
    const confirmed = window.confirm(
      `Are you sure you want to archive ${label}? It will be hidden from active views and will not be re-imported or re-enriched automatically.`,
    );
    if (!confirmed) return;

    setDeletingLeadId(leadId);
    try {
      const response = await fetch(`/api/contacts/${leadId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to archive lead.');
      }

      setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
      setTotal((prev) => Math.max(prev - 1, 0));

      cancelEditingLead();
      if (selectedLeadId === leadId) {
        setSelectedLeadId(null);
      }
    } catch (error) {
      console.error('Error archiving lead:', error);
    } finally {
      setDeletingLeadId(null);
    }
  };

  const rerunEnrichment = async (leadId: string) => {
    const companyId = leads.find((lead) => lead.id === leadId)?.company_id ?? null;
    const startedAt = new Date().toISOString();
    setContactFitByContactId((prev) => {
      if (!prev[leadId]) return prev;
      const next = { ...prev };
      delete next[leadId];
      return next;
    });
    setRefreshingLeadId(leadId);
    setLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              linkedin_resolution_status: 'processing',
              profile_enrichment_status: 'pending',
              linkedin_resolution_last_error: null,
              profile_enrichment_last_error: null,
              enrichment_refresh_status: 'running',
              enrichment_refresh_last_error: null,
              enrichment_refresh_started_at: startedAt,
              enrichment_refresh_finished_at: null,
            }
          : lead
      )
    );
    if (companyId) {
      setCompanyFitByCompanyId((prev) => {
        if (!prev[companyId]) return prev;
        const next = { ...prev };
        delete next[companyId];
        return next;
      });
    }

    try {
      if (!window.confirm('Refresh this contact for 4 credits?')) {
        await fetchLeads(true);
        return;
      }
      const response = await fetch(`/api/enrich/${leadId}`, {
        method: 'POST',
        headers: { 'x-operation-id': crypto.randomUUID() },
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to refresh enrichment.');
      }

      if (result.alreadyRunning) {
        await fetchLeads(true);
        return;
      }

      await fetchLeads(true);
    } catch (error) {
      console.error('Error refreshing enrichment:', error);
      await fetchLeads(true);
      window.alert('Could not refresh enrichment for this lead. Please try again.');
    } finally {
      setRefreshingLeadId(null);
    }
  };

  const stopLeadEnrichment = async (leadId: string) => {
    setStoppingLeadId(leadId);
    setStopEnrichmentError(null);
    // Optimistically clear enrichment state so the UI stops showing
    // "Enrichment running…" immediately, before the fetch round-trip.
    //
    // CRITICAL: we have to patch BOTH the lean list (`leads`) AND the per-lead
    // detail cache (`selectedLeadDetailById`). selectedLead is the merge of
    // those two with detail winning (see line 2028) — if we only patch the
    // lean list, the detail cache's stale "running" overrides our flip on
    // every render and the "Enrichment running…" pill never disappears. That
    // was the bug.
    const optimisticPatch = (lead: Pick<Lead, 'linkedin_resolution_status' | 'profile_enrichment_status'>) => ({
      enrichment_refresh_status: 'cancelled' as const,
      linkedin_resolution_status:
        lead.linkedin_resolution_status === 'pending' ||
        lead.linkedin_resolution_status === 'processing'
          ? ('failed' as const)
          : lead.linkedin_resolution_status,
      profile_enrichment_status:
        lead.profile_enrichment_status === 'pending' ||
        lead.profile_enrichment_status === 'processing'
          ? ('blocked' as const)
          : lead.profile_enrichment_status,
    });
    setLeads((prev) =>
      prev.map((lead) => (lead.id === leadId ? { ...lead, ...optimisticPatch(lead) } : lead)),
    );
    setSelectedLeadDetailById((prev) => {
      const existing = prev[leadId];
      if (!existing) return prev;
      return { ...prev, [leadId]: { ...existing, ...optimisticPatch(existing as Lead) } };
    });
    try {
      const response = await fetch(`/api/enrich/${leadId}`, { method: 'DELETE' });
      // 409 means enrichment already finished — not an error worth surfacing
      if (!response.ok && response.status !== 409) {
        const result = await response.json().catch(() => ({}));
        setStopEnrichmentError(
          typeof result.error === 'string' ? result.error : 'Could not stop enrichment.',
        );
      }
      // Invalidate the per-lead detail cache entry so the next read of the
      // selected lead pulls the server's confirmed post-stop state rather
      // than the in-memory optimistic patch.
      invalidateCache(`/api/contacts/${encodeURIComponent(leadId)}`);
      await fetchLeads(true);
    } catch (error) {
      console.error('Error stopping enrichment:', error);
      setStopEnrichmentError('Could not stop enrichment. Please try again.');
      await fetchLeads(true);
    } finally {
      setStoppingLeadId(null);
    }
  };

  const isEnriching = (lead: Lead) =>
    ['pending', 'processing'].includes(lead.linkedin_resolution_status || '') ||
    ['pending', 'processing'].includes(lead.profile_enrichment_status || '');

  const anyEnriching = leads.some(isEnriching);
  const isLeadRefreshRunning = (lead: Lead) =>
    normalizeLeadRefreshStatus(lead.enrichment_refresh_status) === 'running' ||
    isEnriching(lead);
  const anyLeadRefreshRunning = leads.some(isLeadRefreshRunning);

  const getLeadRefreshStatus = (lead: Lead): LeadRefreshStatus => {
    const normalizedStatus = normalizeLeadRefreshStatus(lead.enrichment_refresh_status);
    if (normalizedStatus !== 'idle') {
      return normalizedStatus;
    }

    if (isEnriching(lead)) {
      return 'running';
    }

    if (getEnrichmentErrorMessage(lead)) {
      return 'failed';
    }

    return 'idle';
  };

  useEffect(() => {
    const now = Date.now();
    setEnrichmentVisuals((previous) => {
      const next: Record<string, EnrichmentVisualState> = {};

      for (const lead of leads) {
        if (!isEnriching(lead)) continue;

        const stage = getEnrichmentStage(lead);
        const prior = previous[lead.id];

        if (prior && prior.stageKey === stage.key) {
          next[lead.id] = prior;
          continue;
        }

        const priorPercent = prior
          ? getInterpolatedEnrichmentPercent(
              prior.startPercent,
              getEnrichmentStage({ ...lead, linkedin_resolution_status: '', profile_enrichment_status: '' } as Lead),
              0
            )
          : stage.floor;

        const carriedPercent = prior
          ? getInterpolatedEnrichmentPercent(
              prior.startPercent,
              {
                ...getEnrichmentStage(lead),
                key: prior.stageKey,
                label: stage.label,
                floor: prior.startPercent,
                ceiling: Math.max(prior.startPercent, stage.floor),
                paceMs: 1,
              },
              now - prior.startedAt
            )
          : stage.floor;

        next[lead.id] = {
          stageKey: stage.key,
          startedAt: now,
          startPercent: Math.max(stage.floor, prior ? Math.max(priorPercent, carriedPercent) : stage.floor),
        };
      }

      return next;
    });
  }, [leads]);

  useEffect(() => {
    if (!anyEnriching) return;
    setProgressNow(Date.now());
    const interval = setInterval(() => {
      setProgressNow(Date.now());
    }, 900);
    return () => clearInterval(interval);
  }, [anyEnriching]);

  const getEnrichmentProgress = (lead: Lead): { percent: number; label: string } => {
    const stage = getEnrichmentStage(lead);
    const visual = enrichmentVisuals[lead.id];

    if (!visual || visual.stageKey !== stage.key) {
      const percent = Math.round(stage.floor);
      return { percent, label: getEnrichmentLabel(stage, percent) };
    }

    const percent = getInterpolatedEnrichmentPercent(
      visual.startPercent,
      stage,
      progressNow - visual.startedAt
    );

    const roundedPercent = Math.round(percent);
    return { percent: roundedPercent, label: getEnrichmentLabel(stage, roundedPercent) };
  };

  // Auto-poll every 5s while any contact is still being enriched
  useEffect(() => {
    if (!anyLeadRefreshRunning) return;
    const interval = setInterval(() => { fetchLeads(true); }, 5000);
    return () => clearInterval(interval);
  }, [anyLeadRefreshRunning, fetchLeads]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const sortedLeads = applySortCol(
    agentFilterIds ? leads.filter((l) => agentFilterIds.has(l.id)) : leads,
    tableSortCol,
    tableSortDir,
  );
  // Lean list row from the table fetch.
  const selectedLeadLean = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  // Merge in the detail fetch (full companies(...) nested + extra lead fields).
  // Detail wins where it has a value; lean fills the rest (readiness,
  // attribution, hubspot lead state, etc. live only on the lean list row).
  const selectedLead: Lead | null = selectedLeadLean
    ? ({
        ...selectedLeadLean,
        ...(selectedLeadId ? selectedLeadDetailById[selectedLeadId] ?? {} : {}),
      } as Lead)
    : null;

  // Only fade the bottom of the list while there's more content below the viewport;
  // when scrolled to the end the last rows render in full without the mask clipping
  // them. Re-measures whenever the row count changes (agent filter / fetch / etc.).
  const { hasMore: hasMoreBelow } = useScrollMask(leadsScrollRef, [sortedLeads.length]);

  const openContactAcquisitionFromLead = useCallback(() => {
    if (!selectedLead?.company_id) return;
    const companyName =
      selectedLead.companies?.company_name ||
      selectedLead.company_name ||
      selectedLead.companies?.domain ||
      selectedLead.company_domain ||
      'Selected company';
    const params = new URLSearchParams({
      mode: 'contacts_at_company',
      companyId: selectedLead.company_id,
      companyName,
      source: 'contacts',
    });
    const icpId = selectedLead.companies?.matched_icp_id ?? null;
    if (icpId) params.set('icpId', icpId);
    router.push(withQuery(ROUTES.data, params));
  }, [router, selectedLead]);

  const selectedContactFitState = selectedLeadId ? contactFitByContactId[selectedLeadId] ?? null : null;
  const selectedContactFit = selectedContactFitState?.data ?? null;
  const selectedHubSpotCrmState = selectedLeadId ? hubspotCrmByContactId[selectedLeadId] ?? null : null;
  const selectedHubSpotCrm = selectedHubSpotCrmState?.data ?? null;
  const selectedPanelSummariesState = selectedLeadId ? panelSummariesByContactId[selectedLeadId] ?? null : null;
  const selectedPanelSummaries = selectedPanelSummariesState?.data ?? null;
  const selectedCompanyId = selectedLead?.company_id ?? null;
  const selectedCompanyFitState = selectedCompanyId ? companyFitByCompanyId[selectedCompanyId] ?? null : null;
  const selectedCompanyFit = selectedCompanyFitState?.data ?? null;
  const isEditingSelected = selectedLead ? editingLeadId === selectedLead.id : false;
  const isSavingSelected = selectedLead ? savingLeadId === selectedLead.id : false;
  const isDeletingSelected = selectedLead ? deletingLeadId === selectedLead.id : false;
  const isRefreshingSelected = selectedLead ? refreshingLeadId === selectedLead.id : false;
  const isStoppingSelected = selectedLead ? stoppingLeadId === selectedLead.id : false;
  const isSelectedLeadRefreshRunning = selectedLead ? isLeadRefreshRunning(selectedLead) : false;
  const selectedLeadRefreshStatus = selectedLead ? getLeadRefreshStatus(selectedLead) : 'idle';
  const selectedLeadRefreshStatusMeta = getLeadRefreshStatusMeta(selectedLeadRefreshStatus);
  const selectedLeadEnrichmentProgress = selectedLead ? getEnrichmentProgress(selectedLead) : null;
  // Effective status: roll the rolled-up `enrichment_refresh_status` together
  // with the per-stage statuses (linkedin_resolution_status,
  // profile_enrichment_status). If ANY per-stage queue entry is still pending
  // or processing, the contact IS effectively still enriching even if the
  // top-level refresh job has been marked `cancelled` / `succeeded` / `failed`
  // by a stuck or partial state. The Stop button + pill should track this
  // effective status so the UI never lies (showing "Enrichment running…" on
  // the bottom button while also showing "Enrichment stopped" in the pill).
  // `isSelectedLeadRefreshRunning` is defined above.
  const effectiveRefreshStatus: LeadRefreshStatus =
    isSelectedLeadRefreshRunning ? 'running' : selectedLeadRefreshStatus;
  const effectiveRefreshStatusMeta = getLeadRefreshStatusMeta(effectiveRefreshStatus);

  const selectedLeadDataSourceTypeLabel =
    !selectedLead
      ? '—'
      : (selectedLead.data_provenance_type ?? '').toLowerCase() === 'arcova'
        ? 'Arcova enrich'
        : (selectedLead.data_provenance_type ?? '').toLowerCase() === 'csv'
          ? 'CSV upload'
          : selectedLead.data_provenance_type ?? '—';

  const enrichmentFinishedDisplayIso: string | null =
    !selectedLead
      ? null
      : selectedLeadRefreshStatus === 'succeeded'
        ? selectedLead.enrichment_refresh_finished_at ?? selectedLead.profile_enrichment_completed_at ?? null
        : selectedLeadRefreshStatus === 'idle' &&
            ['completed', 'ambiguous'].includes(selectedLead.profile_enrichment_status || '')
          ? selectedLead.profile_enrichment_completed_at ?? null
          : null;

  const showEnrichmentDoneCopy =
    !!selectedLead &&
    !!enrichmentFinishedDisplayIso &&
    // Don't claim "done" while any per-stage queue entry is still running — the
    // contact is effectively still enriching even if the rolled-up status reads
    // succeeded/idle. Mirrors `effectiveRefreshStatus` so the panel never lies.
    !isSelectedLeadRefreshRunning &&
    selectedLeadRefreshStatus !== 'running' &&
    selectedLeadRefreshStatus !== 'failed' &&
    selectedLeadRefreshStatus !== 'cancelled' &&
      (selectedLeadRefreshStatus === 'succeeded' ||
      (selectedLeadRefreshStatus === 'idle' &&
        ['completed', 'ambiguous'].includes(selectedLead.profile_enrichment_status || '')));

  const selectedLeadArcovaSourced = selectedLead ? isArcovaSourcedLead(selectedLead) : false;
  const selectedLeadArcovaEnriched = selectedLead ? isArcovaEnrichedLead(selectedLead) : false;
  const selectedLeadWonAfterArcovaTouch = selectedLead ? isWonAfterArcovaTouch(selectedLead) : false;
  const selectedLeadLatestArcovaTouchIso = selectedLead ? getLatestArcovaTouchIso(selectedLead) : null;

  useEffect(() => {
    if ((selectedPreview !== 'scoring' && selectedPreview !== 'action') || !selectedCompanyId) return;

    const cached = companyFitCacheRef.current[selectedCompanyId];
    const shouldRefreshForScoreMismatch =
      cached?.data &&
      typeof cached.data.company_fit_score === 'number' &&
      typeof selectedLead?.fit_score === 'number' &&
      Math.abs(cached.data.company_fit_score - selectedLead.fit_score) > 0.0001;

    if ((cached && !shouldRefreshForScoreMismatch) || cached?.loading) {
      return;
    }

    let cancelled = false;

    setCompanyFitByCompanyId((prev) => ({
      ...prev,
      [selectedCompanyId]: {
        loading: true,
        data: shouldRefreshForScoreMismatch ? null : prev[selectedCompanyId]?.data ?? null,
        error: null,
        message: null,
      },
    }));

    (async () => {
      try {
        const response = await fetch(`/api/companies/${selectedCompanyId}/fit`);
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load company fit details.');
        }

        if (cancelled) return;

        setCompanyFitByCompanyId((prev) => ({
          ...prev,
          [selectedCompanyId]: {
            loading: false,
            data: result.data ?? null,
            error: null,
            message: typeof result.message === 'string' ? result.message : null,
          },
        }));
      } catch (error) {
        if (cancelled) return;

        setCompanyFitByCompanyId((prev) => ({
          ...prev,
          [selectedCompanyId]: {
            loading: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load company fit details.',
            message: null,
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, selectedLead?.fit_score, selectedPreview]);

  useEffect(() => {
    if (!selectedLeadId) return;

    const cached = contactFitCacheRef.current[selectedLeadId];
    if (cached) {
      return;
    }

    let cancelled = false;

    setContactFitByContactId((prev) => ({
      ...prev,
      [selectedLeadId]: {
        loading: true,
        data: null,
        error: null,
        message: null,
      },
    }));

    (async () => {
      try {
        const response = await fetch(`/api/contacts/${selectedLeadId}/fit`);
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.error || 'Failed to load contact fit details.');
        }

        if (cancelled) return;

        setContactFitByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: result.data ?? null,
            error: null,
            message: typeof result.message === 'string' ? result.message : null,
          },
        }));
      } catch (error) {
        if (cancelled) return;

        setContactFitByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load contact fit details.',
            message: null,
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, selectedPreview]);

  useEffect(() => {
    if (!selectedLeadId || selectedPreview !== 'hubspot') return;

    const cached = hubspotCrmCacheRef.current[selectedLeadId];
    if (cached) return;

    let cancelled = false;
    setHubspotCrmByContactId((prev) => ({
      ...prev,
      [selectedLeadId]: {
        loading: true,
        data: null,
        error: null,
      },
    }));

    (async () => {
      try {
        const response = await fetch(`/api/contacts/${selectedLeadId}/hubspot-crm`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load HubSpot CRM context.');
        }
        if (cancelled) return;
        setHubspotCrmByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: result.data ?? null,
            error: null,
          },
        }));
      } catch (error) {
        if (cancelled) return;
        setHubspotCrmByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load HubSpot CRM context.',
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, selectedPreview]);

  useEffect(() => {
    if (!selectedLeadId) return;
    if (selectedPreview !== 'contact' && selectedPreview !== 'scoring') return;

    let cancelled = false;
    setPanelSummariesByContactId((prev) => ({
      ...prev,
      [selectedLeadId]: {
        loading: true,
        data: prev[selectedLeadId]?.data ?? null,
        error: null,
      },
    }));

    (async () => {
      try {
        const response = await fetch(`/api/contacts/${selectedLeadId}/panel-summaries`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || 'Failed to load panel summaries.');
        }
        if (cancelled) return;

        setPanelSummariesByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: {
              contactSummary:
                typeof result.contactSummary === 'string' ? result.contactSummary.trim() : '',
              fitSummary: typeof result.fitSummary === 'string' ? result.fitSummary.trim() : '',
            },
            error: null,
          },
        }));
      } catch (error) {
        if (cancelled) return;
        setPanelSummariesByContactId((prev) => ({
          ...prev,
          [selectedLeadId]: {
            loading: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to load panel summaries.',
          },
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, selectedPreview]);

  const renderCompanyIcpFitScoresCard = () => {
    const companyFitHeaderPct = selectedLead ? resolveCompanyFitForLeadAction(selectedLead) : null;
    return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setScoringPanelOpen((s) => ({ ...s, icpFit: !s.icpFit }))}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100/60 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-700">Company Fit</span>
        <div className="flex items-center gap-2">
          {companyFitHeaderPct !== null && (
            <span className="text-sm font-semibold tabular-nums text-gray-900">
              {formatPercentValue(companyFitHeaderPct)}
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform duration-200 ${scoringPanelOpen.icpFit ? '' : '-rotate-90'}`} />
        </div>
      </button>
      {scoringPanelOpen.icpFit && (
        <div className="px-4 pb-4 space-y-3">
          {selectedCompanyFitState?.loading ? (
            <p className="text-xs text-gray-400">Loading ICP scores…</p>
          ) : selectedCompanyFit?.icp_scores?.length ? (
            (() => {
              const bestScore =
                selectedCompanyFit.icp_scores.find((s) => s.icp_id === selectedCompanyFit.matched_icp_id) ??
                selectedCompanyFit.icp_scores[0];
              const otherScores = selectedCompanyFit.icp_scores.filter((s) => s.icp_id !== bestScore?.icp_id);
              const renderScoreInner = (score: typeof bestScore) => {
                const isBest = score.icp_id === selectedCompanyFit.matched_icp_id;
                const breakdown = score.breakdown;
                return (
                  <div
                    key={score.icp_id}
                    className={
                      isBest
                        ? ''
                        : 'rounded-lg border border-slate-200 bg-white/80 px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
                    }
                  >
                    <div>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {isBest ? 'Best fit' : 'Also scored'}
                        {score.icp_index != null ? `: ICP ${score.icp_index}` : ''}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-gray-900">{score.icp_name || 'Unnamed ICP'}</p>
                      {formatPercentValue(score.final_score) && (
                        <div className="mt-2">
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                            {formatPercentValue(score.final_score)}
                          </span>
                        </div>
                      )}
                    </div>

                    {isBest && breakdown && (
                      <div className="mt-5 space-y-2.5">
                        <p className="text-[11px] text-gray-400">Click a row to unfold detail</p>
                        {COMPANY_FIT_COMPONENT_ORDER.map((key) => {
                          const component = breakdown.components[key];
                          if (!component?.active) return null;
                          const componentPercent = formatPercentValue(component.score01);
                          const exactPillLabels = getExactCompanyFitPillLabels(key, component.detail);
                          const barKey = `icp:${score.icp_id}:${key}`;
                          const isOpen = expandedBars.has(barKey);
                          return (
                            <div key={key}>
                              <button
                                type="button"
                                onClick={() => toggleBar(barKey)}
                                className="w-full rounded-md px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-gray-100/80"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-medium text-gray-700">{component.label}</p>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {componentPercent && (
                                      <span className="text-[11px] text-slate-500">{componentPercent}</span>
                                    )}
                                    <ChevronDown
                                      className={`h-3 w-3 shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                                      aria-hidden
                                    />
                                  </div>
                                </div>
                                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className={`h-full rounded-full ${component.available ? 'bg-arcova-teal' : 'bg-slate-300'}`}
                                    style={{
                                      width: `${Math.max(0, Math.min(100, Math.round(component.score01 * 100)))}%`,
                                    }}
                                  />
                                </div>
                              </button>
                              {isOpen && (
                                <div className="mt-1.5 space-y-1">
                                  {component.matchedValues && component.matchedValues.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {component.matchedValues.map((v) => (
                                        <span
                                          key={v}
                                          className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal"
                                        >
                                          {v}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {!(component.matchedValues && component.matchedValues.length > 0) &&
                                    exactPillLabels.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {exactPillLabels.map((label) => (
                                          <span
                                            key={label}
                                            className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal"
                                          >
                                            {label}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  {component.unmatchedValues && component.unmatchedValues.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {component.unmatchedValues.map((v) => (
                                        <span
                                          key={v}
                                          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                                        >
                                          {v}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <div className="space-y-3">
                  {bestScore && renderScoreInner(bestScore)}
                  {otherScores.length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setScoringPanelOpen((s) => ({ ...s, otherIcps: !s.otherIcps }))}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <ChevronDown
                          className={`w-3 h-3 transition-transform duration-200 ${scoringPanelOpen.otherIcps ? '' : '-rotate-90'}`}
                        />
                        {scoringPanelOpen.otherIcps
                          ? 'Hide'
                          : `${otherScores.length} other ICP${otherScores.length > 1 ? 's' : ''}`}
                      </button>
                      {scoringPanelOpen.otherIcps && (
                        <div className="mt-3 space-y-3">
                          {otherScores.map((s) => renderScoreInner(s))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          ) : selectedLead?.fit_score != null ? (
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900">{formatPercentValue(selectedLead.fit_score)}</p>
              {selectedLead.matched_icp_name && (
                <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">
                  {selectedLead.matched_icp_name}
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No ICP fit yet.</p>
          )}
        </div>
      )}
    </div>
    );
  };

  const renderContactFitScoresCard = () => {
    const contactFitHeaderPct = selectedLead ? resolveContactFitForLeadAction(selectedLead) : null;
    const fitScore = selectedContactFit?.contact_fit_score ?? contactFitHeaderPct;
    const n = percentDisplayNumber(fitScore);
    return (
      <div className="contacts-fit-card">
        {/* Hero ring — reads consistently with the Priority & Signals gauges (design Fit hero) */}
        <div className="flex flex-col items-center pb-3 pt-1">
          <AnimatedCircularProgressBar
            value={n ?? 0}
            gaugePrimaryColor={fitScoreArcColor(n)}
            gaugeSecondaryColor="rgba(13,53,71,0.09)"
            animateOnMount
            deferAnimationMs={160}
            label={
              <span className="block text-xl font-semibold leading-snug tabular-nums text-[#0d3547]">
                {selectedContactFitState?.loading ? '…' : n != null ? n : '—'}
              </span>
            }
            className="size-24 [--transition-length:0.95s]"
          />
          <p className="mt-3 font-manrope text-[15px] font-bold tracking-[-0.01em] text-[#0d3547]">
            Contact fit
          </p>
        </div>
        <div className="contacts-fit-criteria">
          {selectedContactFitState?.loading ? (
            <p className="text-xs text-[#7d909a]">Loading…</p>
          ) : selectedContactFit?.winning_breakdown && selectedLead ? (
            CONTACT_FIT_COMPONENT_ORDER.map((key) => {
              const component = selectedContactFit.winning_breakdown!.components[key];
              if (!component?.active) return null;
              const barKey = `contact:${key}`;
              const isOpen = expandedBars.has(barKey);
              const ok = score01ToFitOk(component.score01, component.matchStatus ?? null);
              const showPill = Boolean(component.matchedValue) && component.matchStatus !== 'mismatch';
              const detailText: string | null = (() => {
                if (component.matchStatus === 'exact') return 'Exact match';
                if (key === 'seniority') {
                  const contactSeniority = selectedLead.seniority_level ?? null;
                  if (contactSeniority) {
                    return `Contact is ${contactSeniority}. This is not the target buying group for this ICP`;
                  }
                }
                return component.detail || null;
              })();
              const hasDetail = showPill || Boolean(detailText);
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => hasDetail && toggleBar(barKey)}
                    className={cn('contacts-fit-criterion w-full text-left', hasDetail && 'hover:opacity-80')}
                    style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                  >
                    <span
                      className={cn(
                        'contacts-fit-criterion-icon',
                        ok === 'pass' && 'contacts-fit-criterion-pass',
                        ok === 'warn' && 'contacts-fit-criterion-warn',
                        ok === 'miss' && 'contacts-fit-criterion-miss',
                      )}
                    >
                      {ok === 'pass' ? '✓' : ok === 'warn' ? '~' : '✗'}
                    </span>
                    <span className="contacts-fit-criterion-text">{component.label}</span>
                    <span className="contacts-fit-criterion-val">
                      {formatPercentValue(component.score01) ?? '—'}
                    </span>
                  </button>
                  {isOpen && hasDetail && (
                    <div className="mt-1 ml-[22px] space-y-1">
                      {showPill && (
                        <span className="inline-flex items-center rounded-full bg-arcova-teal/10 px-2 py-0.5 text-[11px] font-medium text-arcova-teal">
                          {component.matchedValue}
                        </span>
                      )}
                      {detailText && (
                        <p className="text-[11px] leading-relaxed text-[#7d909a]">{detailText}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-xs text-[#7d909a]">No contact fit yet.</p>
          )}
        </div>
      </div>
    );
  };

  const renderActionFitDesignCard = (
    title: string,
    pct01: number | null | undefined,
    criteria: ActionFitCriterion[],
    opts?: { emptyHint?: string; loading?: boolean },
  ) => {
    const n = percentDisplayNumber(pct01 ?? null);
    return (
      <div className="contacts-fit-card">
        <div className="contacts-fit-head">
          <span className="contacts-fit-head-title">{title}</span>
          <span className="contacts-fit-head-num">
            {opts?.loading ? (
              <span className="text-xs font-medium text-[#7d909a]">…</span>
            ) : n != null ? (
              <>
                {n}
                <span>%</span>
              </>
            ) : (
              <span className="text-sm font-semibold text-[#7d909a]">—</span>
            )}
          </span>
        </div>
        <div className="contacts-fit-bar" aria-hidden>
          {!opts?.loading && n != null ? (
            <span className="contacts-fit-bar-fill" style={{ width: `${Math.min(100, n)}%` }} />
          ) : null}
        </div>
        <div className="contacts-fit-criteria">
          {opts?.loading ? (
            <p className="text-xs text-[#7d909a]">Loading…</p>
          ) : criteria.length ? (
            criteria.map((row, i) => (
              <div key={`${row.text}-${i}`} className="contacts-fit-criterion">
                <span
                  className={cn(
                    'contacts-fit-criterion-icon',
                    row.ok === 'pass' && 'contacts-fit-criterion-pass',
                    row.ok === 'warn' && 'contacts-fit-criterion-warn',
                    row.ok === 'miss' && 'contacts-fit-criterion-miss',
                  )}
                >
                  {row.ok === 'pass' ? '✓' : row.ok === 'warn' ? '~' : '✗'}
                </span>
                <span className="contacts-fit-criterion-text">{row.text}</span>
                <span className="contacts-fit-criterion-val">{row.val}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-[#7d909a]">{opts?.emptyHint ?? 'No breakdown yet.'}</p>
          )}
        </div>
      </div>
    );
  };

  const renderOverallFitActionCard = () => {
    const overall =
      selectedLead &&
      typeof selectedLead.overall_fit_score === 'number' &&
      Number.isFinite(selectedLead.overall_fit_score)
        ? selectedLead.overall_fit_score
        : null;
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50/70 overflow-hidden">
        <div className="flex w-full items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold text-gray-700">Overall Fit</span>
          {overall !== null ? (
            <span className="text-sm font-semibold tabular-nums text-gray-900">{formatPercentValue(overall)}</span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const contactsPageTitleBlock = (
    <div className="mb-6 shrink-0 flex flex-col gap-4 max-[767px]:pl-14">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
          <Users className="h-3.5 w-3.5" />
          Leads
        </div>
        <h1 className="font-manrope mt-2 text-3xl font-semibold leading-tight tracking-[-0.028em] text-slate-950 sm:text-[2.25rem]">
          Contacts
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          {total > 0
            ? `${total.toLocaleString()} contact${total !== 1 ? 's' : ''} ready to review. Click a row for details, or the company name to open the account.`
            : 'Your imported contacts will appear here once they are ready to review.'}
        </p>

        {total > 0 && (
          // Sits directly under the intro sentence.
          <div className="mt-4 flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-2 px-3 py-2 bg-arcova-teal text-white rounded-lg text-sm font-medium hover:bg-arcova-teal/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm focus-visible:outline-none"
                title="Actions"
              >
                {pullingHubspotCrm || pushingToHubspot || runningEmailVerification ? (
                  <RotateCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
                Actions
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="min-w-[14rem]">
              <DropdownMenuItem onSelect={() => router.push('/import')}>
                <Upload className="w-3.5 h-3.5" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDownloadCsv}>
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={handleRunEmailVerification}
                disabled={runningEmailVerification}
              >
                {runningEmailVerification ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MailCheck className="w-3.5 h-3.5" />
                )}
                {runningEmailVerification ? 'Refreshing…' : 'Refresh emails'}
              </DropdownMenuItem>
              {hubspotConnected && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={handlePullHubspotCrm}
                    disabled={pullingHubspotCrm}
                  >
                    {pullingHubspotCrm ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    {pullingHubspotCrm ? 'Pulling…' : 'Pull HubSpot CRM'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={handlePushToHubspot}
                    disabled={pushingToHubspot}
                  >
                    {pushingToHubspot ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    {pushingToHubspot ? 'Syncing…' : 'Push to HubSpot'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );

  const hubspotSyncBanner = hubspotSyncResult ? (
    <div className={`mb-4 shrink-0 rounded-xl border bg-white px-4 py-3 flex items-start justify-between gap-4 ${hubspotSyncResult.error ? 'border-rose-200' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3 min-w-0">
        <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#ff7a59]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z"/>
        </svg>
        <div className="min-w-0">
          {hubspotSyncResult.error ? (
            <div>
              <span className="text-sm font-semibold text-rose-700">HubSpot sync failed</span>
              <p className="mt-0.5 text-xs text-rose-600 break-words">{hubspotSyncResult.error}</p>
            </div>
          ) : (
            <>
              <span className="text-sm font-semibold text-gray-900">
                {hubspotSyncResult.contacts.upserted} contact{hubspotSyncResult.contacts.upserted !== 1 ? 's' : ''} synced to HubSpot
              </span>
              {(hubspotSyncResult.contacts.errors > 0 || hubspotSyncResult.skipped > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {hubspotSyncResult.contacts.errors > 0 && (
                    <span className="inline-flex items-baseline gap-1 rounded-md border border-rose-200/70 bg-rose-50 px-2 py-0.5 text-xs text-rose-600">
                      <span className="font-semibold tabular-nums">{hubspotSyncResult.contacts.errors}</span>
                      error{hubspotSyncResult.contacts.errors !== 1 ? 's' : ''}
                    </span>
                  )}
                  {hubspotSyncResult.skipped > 0 && (
                    <button
                      onClick={() => setSyncResultExpanded((v) => !v)}
                      className="inline-flex items-baseline gap-1 rounded-md border border-gray-200/70 bg-gray-50 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                    >
                      <svg className={`w-2.5 h-2.5 self-center transition-transform ${syncResultExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      <span className="font-semibold tabular-nums text-gray-900">{hubspotSyncResult.skipped}</span>
                      skipped
                    </button>
                  )}
                </div>
              )}
              {syncResultExpanded && hubspotSyncResult.skippedContacts.length > 0 && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs font-medium text-gray-900">Not synced yet</p>
                  <ul className="mt-1.5 space-y-1.5">
                  {hubspotSyncResult.skippedContacts.map((c, i) => (
                    <li key={i} className="text-xs text-gray-600">
                      <span className="font-medium text-gray-800">{c.name}</span>
                      {c.company && <span className="text-gray-400"> · {c.company}</span>}
                      <span className="ml-1.5 text-gray-600">: {c.reason.toLowerCase()}</span>
                    </li>
                  ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <button
        onClick={() => setHubspotSyncResult(null)}
        className="shrink-0 text-gray-400 hover:text-gray-600 mt-0.5"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  ) : null;

  const emailVerificationBanner = emailVerificationResult ? (() => {
    const r = emailVerificationResult;
    const notVerifiedCount = r.catchAll + r.unknown;
    const items = r.items ?? [];
    const pills: Array<{
      key: string;
      count: number;
      label: string;
      className: string;
    }> = [];
    if (r.verified > 0) {
      pills.push({
        key: 'verified',
        count: r.verified,
        label: 'Verified',
        className: 'border-emerald-200/70 bg-emerald-50 text-emerald-700',
      });
    }
    if (r.invalid > 0) {
      pills.push({
        key: 'not_deliverable',
        count: r.invalid,
        label: 'Not deliverable',
        className: 'border-rose-200/70 bg-rose-50 text-rose-600',
      });
    }
    if (notVerifiedCount > 0) {
      pills.push({
        key: 'not_verified',
        count: notVerifiedCount,
        label: 'Not verified',
        className: 'border-amber-200/70 bg-amber-50 text-amber-700',
      });
    }
    if (r.failed > 0) {
      pills.push({
        key: 'failed',
        count: r.failed,
        label: 'Could not check',
        className: 'border-rose-200/70 bg-rose-50 text-rose-600',
      });
    }
    const openItems =
      emailVerificationDetailOpen != null
        ? items.filter((item) => item.category === emailVerificationDetailOpen)
        : null;
    const toggleVerificationDetail = (key: string) => {
      setEmailVerificationDetailOpen((cur) => (cur === key ? null : key));
    };

    return (
    <div className={`mb-4 shrink-0 rounded-xl border bg-white px-4 py-3 flex items-start justify-between gap-4 ${r.error ? 'border-rose-200' : 'border-gray-200'}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <MailCheck className={`mt-0.5 h-4 w-4 shrink-0 ${r.error ? 'text-rose-500' : 'text-arcova-teal'}`} />
        <div className="min-w-0 flex-1">
          {r.error ? (
            <>
              <span className="text-sm font-semibold text-rose-700">Email refresh failed</span>
              <p className="mt-0.5 break-words text-xs text-rose-600">{r.error}</p>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold text-gray-900">
                {r.eligible} email address{r.eligible !== 1 ? 'es' : ''} refreshed
              </span>
              {(r.finderFound ?? 0) > 0 && (
                <p className="mt-1 text-xs text-gray-600">
                  Found {r.finderFound} new email address{(r.finderFound ?? 0) !== 1 ? 'es' : ''} via lookup.
                </p>
              )}
              {pills.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {pills.map((pill) => {
                    const pillItems = items.filter((item) => item.category === pill.key);
                    const clickable = pillItems.length > 0;
                    const open = clickable && emailVerificationDetailOpen === pill.key;
                    const inner = (
                      <>
                        <span className="font-semibold tabular-nums">{pill.count}</span> {pill.label}
                        {clickable && (
                          <ChevronDown className={`h-3 w-3 self-center opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
                        )}
                      </>
                    );
                    return clickable ? (
                      <button
                        key={pill.key}
                        type="button"
                        onClick={() => toggleVerificationDetail(pill.key)}
                        className={`inline-flex items-baseline gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:brightness-95 ${pill.className}`}
                      >
                        {inner}
                      </button>
                    ) : (
                      <span
                        key={pill.key}
                        className={`inline-flex items-baseline gap-1 rounded-md border px-2 py-0.5 text-xs ${pill.className}`}
                      >
                        {inner}
                      </span>
                    );
                  })}
                </div>
              )}
              {openItems && openItems.length > 0 && (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <ul className="space-y-1">
                    {openItems.map((item, i) => (
                      <li key={`${item.contactId}-${item.email}-${i}`} className="text-xs text-gray-600">
                        <span className="font-medium text-gray-800">{item.contactName || 'Unknown contact'}</span>
                        {item.companyName && <span className="text-gray-400"> · {item.companyName}</span>}
                        {item.email && <span className="text-gray-500"> · {item.email}</span>}
                        {item.error && <span className="text-rose-600"> · {item.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Refreshed emails on active contacts above {Math.round(r.priorityMin * 100)}% priority.
              </p>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          setEmailVerificationResult(null);
          setEmailVerificationDetailOpen(null);
        }}
        className="mt-0.5 shrink-0 text-gray-400 transition-colors hover:text-gray-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
    );
  })() : null;

  const hubspotPullBanner = hubspotPullResult ? (() => {
    const r = hubspotPullResult;
    const noun = (n: number, s: string) => `${s}${n === 1 ? '' : 's'}`;
    const accountsUpdated = r.contactRecomputedCompanies + r.recomputedCompanies;
    const unresolved = r.contactSkippedUnresolvedCompanies + r.skippedUnresolvedCompanies;
    const contactItems = r.contactItems ?? [];
    const dealItems = r.dealItems ?? [];
    // Contacts fetched is the headline; everything else is a chip shown only when
    // non-zero (zeros are noise). Chips with `detailKey` expand to list the items
    // (same affordance as the push banner's "skipped"). Deals fetched + mirrored
    // are the same set, so both reveal `dealItems`.
    const stats: { value: number; label: string; detailKey?: string; items?: { name: string | null; company: string | null }[] }[] = [];
    if (r.fetchedDeals > 0) stats.push({ value: r.fetchedDeals, label: `${noun(r.fetchedDeals, 'deal')} fetched`, detailKey: 'deals', items: dealItems });
    if (r.contactEventsEmitted > 0) stats.push({ value: r.contactEventsEmitted, label: noun(r.contactEventsEmitted, 'contact signal') });
    if (r.mirroredDeals > 0) stats.push({ value: r.mirroredDeals, label: `${noun(r.mirroredDeals, 'deal')} mirrored`, detailKey: 'deals', items: dealItems });
    if (r.emittedEvents > 0) stats.push({ value: r.emittedEvents, label: noun(r.emittedEvents, 'deal signal') });
    if (accountsUpdated > 0) stats.push({ value: accountsUpdated, label: `${noun(accountsUpdated, 'account')} updated` });

    const openItems = pullDetailOpen === 'contacts' ? contactItems : pullDetailOpen === 'deals' ? dealItems : null;
    const contactsClickable = contactItems.length > 0;
    const toggle = (key: string) => setPullDetailOpen((cur) => (cur === key ? null : key));

    return (
      <div className={`mb-4 shrink-0 rounded-xl border bg-white px-4 py-3 flex items-start justify-between gap-4 ${r.error ? 'border-rose-200' : 'border-gray-200'}`}>
        <div className="flex items-start gap-3 min-w-0">
          <svg className="w-4 h-4 shrink-0 mt-0.5 text-[#ff7a59]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z"/>
          </svg>
          <div className="min-w-0 flex-1">
            {r.error ? (
              <div>
                <span className="text-sm font-semibold text-rose-700">HubSpot CRM pull failed</span>
                <p className="mt-0.5 text-xs text-rose-600 break-words">{r.error}</p>
              </div>
            ) : (
              <>
                {contactsClickable ? (
                  <button
                    type="button"
                    onClick={() => toggle('contacts')}
                    className="group inline-flex items-center gap-1 text-left"
                  >
                    <span className="text-sm font-semibold text-gray-900">
                      {r.fetchedContacts} contact{r.fetchedContacts !== 1 ? 's' : ''} fetched from HubSpot
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${pullDetailOpen === 'contacts' ? 'rotate-180' : ''}`} />
                  </button>
                ) : (
                  <span className="text-sm font-semibold text-gray-900">
                    {r.fetchedContacts} contact{r.fetchedContacts !== 1 ? 's' : ''} fetched from HubSpot
                  </span>
                )}
                {(stats.length > 0 || unresolved > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {stats.map((s, i) => {
                      const clickable = Boolean(s.detailKey && s.items && s.items.length > 0);
                      const open = clickable && pullDetailOpen === s.detailKey;
                      const inner = (
                        <>
                          <span className="font-semibold tabular-nums text-gray-900">{s.value}</span>
                          {s.label}
                          {clickable && (
                            <ChevronDown className={`w-3 h-3 self-center text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                          )}
                        </>
                      );
                      return clickable ? (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggle(s.detailKey!)}
                          className="inline-flex items-baseline gap-1 rounded-md border border-gray-200/70 bg-gray-50 px-2 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-100"
                        >
                          {inner}
                        </button>
                      ) : (
                        <span
                          key={i}
                          className="inline-flex items-baseline gap-1 rounded-md border border-gray-200/70 bg-gray-50 px-2 py-0.5 text-xs text-gray-500"
                        >
                          {inner}
                        </span>
                      );
                    })}
                    {unresolved > 0 && (
                      <span className="inline-flex items-baseline gap-1 rounded-md border border-amber-200/70 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        <span className="font-semibold tabular-nums">{unresolved}</span>
                        unresolved
                      </span>
                    )}
                  </div>
                )}
                {openItems && openItems.length > 0 && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <ul className="space-y-1">
                      {openItems.map((it, i) => (
                        <li key={i} className="text-xs text-gray-600">
                          <span className="font-medium text-gray-800">{it.name || 'Unknown'}</span>
                          {it.company && <span className="text-gray-400"> · {it.company}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => setHubspotPullResult(null)}
          className="shrink-0 text-gray-400 hover:text-gray-600 mt-0.5"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  })() : null;

  return (
    <div className="flex min-h-0 h-screen bg-transparent">
      <AppSidebar />

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden p-3.5 md:flex-row md:gap-2">
        <div className="contacts-leads-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] bg-transparent px-3 py-3 sm:px-5 sm:py-4 min-[1280px]:pr-2">
          <div className="flex min-h-0 w-full max-w-none flex-1 flex-col">
            {loadingLeads ? (
              <>
                {contactsPageTitleBlock}
                {emailVerificationBanner}
                {hubspotPullBanner}
                {hubspotSyncBanner}
                <div className="flex items-center justify-center py-24">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-arcova-teal" />
                </div>
              </>
            ) : leads.length === 0 && !search && !agentFilterIds ? (
              <>
                {contactsPageTitleBlock}
                {emailVerificationBanner}
                {hubspotPullBanner}
                {hubspotSyncBanner}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-16 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No leads yet</h3>
                <p className="text-gray-500 mb-6 max-w-sm mx-auto">
                  Import a CSV of contacts to start reviewing enriched leads.
                </p>
                <button
                  onClick={() => router.push('/import')}
                  className="px-6 py-3 bg-arcova-teal text-white rounded-lg hover:bg-arcova-teal/90 transition-colors"
                >
                  Import contacts
                </button>
              </div>
              </>
            ) : leads.length === 0 && search && !agentFilterIds ? (
              <>
                {contactsPageTitleBlock}
                {emailVerificationBanner}
                {hubspotPullBanner}
                {hubspotSyncBanner}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                <p className="text-gray-500">
                  No leads matching &ldquo;{search}&rdquo;
                </p>
              </div>
              </>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
              <div
                className={cn(
                  'flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden',
                )}
              >
                {contactsPageTitleBlock}
                {emailVerificationBanner}
                {hubspotPullBanner}
                {hubspotSyncBanner}
                {/* ── Leads table ── */}
                <div className="flex min-h-0 flex-1 flex-col gap-2">

                {/* Active-leads pipeline cap banner */}
                {activeLeadsCap && activeLeadsCap.used >= activeLeadsCap.cap && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
                    <p className="text-xs font-medium text-amber-800">
                      Your monitoring allowance is full — {activeLeadsCap.used.toLocaleString()} / {activeLeadsCap.cap.toLocaleString()} active leads. Additional eligible leads will wait for a monitoring slot.
                    </p>
                    <a
                      href="/settings"
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 transition-colors"
                    >
                      Upgrade
                    </a>
                  </div>
                )}

                {/* Agent filter banner */}
                {agentFilterIds && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-arcova-teal/20 bg-arcova-teal/5 px-4 py-2.5">
                    <p className="text-xs font-medium text-arcova-teal">
                      Filtered by agent · {sortedLeads.length} contact{sortedLeads.length !== 1 ? 's' : ''}
                    </p>
                    <button
                      onClick={handleQueryClear}
                      className="text-xs text-arcova-teal/70 hover:text-arcova-teal underline shrink-0 transition-colors"
                    >
                      Clear filter
                    </button>
                  </div>
                )}

                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-[rgba(13,53,71,0.1)] bg-[rgba(255,255,255,0.52)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.16),0_2px_6px_-2px_rgba(13,53,71,0.06)] backdrop-blur-2xl backdrop-saturate-150">
                  {/* Table header */}
                  <div
                    onWheel={(e) => {
                      if (leadsScrollRef.current) {
                        leadsScrollRef.current.scrollTop += e.deltaY;
                      }
                    }}
                    className={`${LEADS_TABLE_GRID} shrink-0 items-start pl-9 pr-4 py-3 border-b border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.4)] text-[13px] font-semibold uppercase tracking-wide text-[#7d909a]`}
                    style={{ gridTemplateColumns: leadsGridCols }}
                  >
                    {(['name', 'job_title', 'company'] as const).map((col) => (
                      <button
                        key={col}
                        onClick={() => handleSortCol(col)}
                        className={cn(
                          col === 'company'
                            ? 'flex flex-col items-start gap-0.5'
                            : 'flex items-start gap-1',
                          // Job title drops out below lg. Company stays visible at
                          // all sizes — once the agent is hidden (<768px) the table
                          // has plenty of room to keep it.
                          col === 'job_title' && 'hidden lg:flex [.arcova-agent-collapsed_&]:md:flex',
                          'hover:text-gray-800 transition-colors text-left',
                        )}
                      >
                        <span className="flex items-center gap-1">
                          {col === 'name' ? 'Name' : col === 'job_title' ? 'Job title' : 'Company name'}
                          <SortArrow col={col} activeCol={tableSortCol} dir={tableSortDir} />
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => handleSortCol('priority')}
                      className="flex w-full items-start justify-center gap-1 hover:text-gray-800 transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        Priority
                        <SortArrow col="priority" activeCol={tableSortCol} dir={tableSortDir} />
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSortCol('crm')}
                      className="hidden w-full items-center justify-center gap-1 hover:text-gray-800 transition-colors min-[1280px]:flex [.arcova-agent-collapsed_&]:lg:flex"
                    >
                      <span className="normal-case tracking-normal">CRM</span>
                      <SortArrow col="crm" activeCol={tableSortCol} dir={tableSortDir} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSortCol('status')}
                      className="hidden w-full items-start justify-center gap-1 hover:text-gray-800 transition-colors min-[1280px]:flex [.arcova-agent-collapsed_&]:lg:flex"
                    >
                      Action
                      <SortArrow col="status" activeCol={tableSortCol} dir={tableSortDir} />
                    </button>
                  </div>

                  <div
                    ref={leadsScrollRef}
                    className="min-h-0 flex-1 divide-y divide-[rgba(13,53,71,0.06)] overflow-y-auto"
                    style={
                      hasMoreBelow
                        ? {
                            maskImage: 'linear-gradient(to bottom, black calc(100% - 9rem), transparent)',
                            WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 9rem), transparent)',
                          }
                        : undefined
                    }
                  >
                    {/* Single render path — agent filter narrows sortedLeads in-place */}
                    {sortedLeads.map((lead, index) => {
                      const isSelected = selectedLeadId === lead.id;
                      const enriching = isEnriching(lead);
                      const enrichmentProgress = getEnrichmentProgress(lead);
                      const rowNumber = (page - 1) * PAGE_SIZE + index + 1;

                      if (enriching) {
                        return (
                          <div
                            key={lead.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSelectedLeadId(lead.id);
                              setSelectedPreview('contact');
                              cancelEditingLead();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('contact');
                                cancelEditingLead();
                              }
                            }}
                            className={`${LEADS_TABLE_GRID} relative pl-9 pr-4 py-3 items-center cursor-pointer transition-all duration-150 border-b border-gray-50 last:border-0 before:pointer-events-none before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-sm before:content-[''] before:transition-colors ${
                              isSelected
                                ? 'bg-arcova-teal/10 before:bg-arcova-teal'
                                : 'before:bg-transparent hover:bg-arcova-teal/5 hover:before:bg-arcova-teal/35'
                            }`}
                            style={{ gridTemplateColumns: leadsGridCols }}
                          >
                            <span aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-gray-400 select-none">
                              {rowNumber}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-400 truncate">
                                {lead.full_name ||
                                  [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                                  '—'}
                              </p>
                            </div>

                            <div className="hidden min-w-0 lg:block [.arcova-agent-collapsed_&]:md:block">
                              <p className="text-xs text-gray-400 truncate leading-snug">
                                {enrichmentProgress.label}...
                              </p>
                            </div>

                            <div className="min-w-0 pr-3">
                              <div className="flex items-center gap-3">
                                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                                    style={{ width: `${enrichmentProgress.percent}%` }}
                                  >
                                    <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-14 rounded-full" />
                                  </div>
                                </div>
                                <span className="text-[11px] font-medium tabular-nums text-gray-400">
                                  {enrichmentProgress.percent}%
                                </span>
                              </div>
                            </div>

                            <div className="min-w-0 flex items-center justify-center">
                              <span className="text-[11px] text-gray-300 tabular-nums">—</span>
                            </div>

                            <div className="hidden min-w-0 items-center justify-center min-[1280px]:flex [.arcova-agent-collapsed_&]:lg:flex">
                              <span className="text-[11px] text-gray-300 tabular-nums">—</span>
                            </div>

                            <div className="hidden min-w-0 items-center justify-center min-[1280px]:flex [.arcova-agent-collapsed_&]:lg:flex">
                              <span className="text-[11px] text-gray-300 tabular-nums">—</span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={lead.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setSelectedLeadId(lead.id);
                            setSelectedPreview('contact');
                            cancelEditingLead();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedLeadId(lead.id);
                              setSelectedPreview('contact');
                              cancelEditingLead();
                            }
                          }}
                          className={`${LEADS_TABLE_GRID} relative pl-9 pr-4 py-3 items-center cursor-pointer transition-all duration-150 opacity-100 before:pointer-events-none before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-sm before:content-[''] before:transition-colors ${
                            isSelected
                              ? 'bg-arcova-teal/10 before:bg-arcova-teal'
                              : 'before:bg-transparent hover:bg-arcova-teal/5 hover:before:bg-arcova-teal/35'
                          }`}
                          style={{ gridTemplateColumns: leadsGridCols }}
                        >
                          <span aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-gray-400 select-none">
                            {rowNumber}
                          </span>
                          {/* Full name */}
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-[12px] font-medium text-gray-900">
                                {lead.full_name ||
                                  [lead.first_name, lead.last_name].filter(Boolean).join(' ') ||
                                  '—'}
                              </p>
                            </div>
                          </div>

                          {/* Job title — hidden below lg (table is too cramped) */}
                          <div className="hidden min-w-0 lg:block [.arcova-agent-collapsed_&]:md:block">
                            <p className="text-[11px] leading-snug text-gray-600 break-words line-clamp-2">
                              {lead.resolved_current_job_title || lead.job_title || '—'}
                            </p>
                          </div>

                          {/* Company name — always visible (agent panel is hidden
                              below 768px so the table has plenty of room for it). */}
                          <div className="min-w-0">
                            {(() => {
                              const companyFirmographics = getDisplayedCompanyFirmographics(lead);
                              const name =
                                companyFirmographics?.name ||
                                lead.resolved_current_company_name ||
                                lead.company_name ||
                                '—';
                              const truncated = name.length > 30 ? name.slice(0, 30) + '…' : name;
                              const domain = companyFirmographics?.domain || lead.company_domain;
                              const href = companyFirmographics?.website || (domain ? `https://${domain}` : null);
                              if (lead.company_id) {
                                return (
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(withQuery(ROUTES.accounts, `companyId=${encodeURIComponent(lead.company_id!)}`));
                                      }}
                                      className="max-w-full truncate text-left text-[12px] font-medium text-arcova-teal hover:underline"
                                    >
                                      {truncated}
                                    </button>
                                  </div>
                                );
                              }
                              return href ? (
                                <div className="min-w-0">
                                  <a href={href} target="_blank" rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-block max-w-full truncate text-[12px] font-medium text-arcova-teal hover:underline">
                                    {truncated}
                                  </a>
                                </div>
                              ) : (
                                <div className="min-w-0">
                                  <p className="truncate text-[12px] font-medium text-gray-700">{truncated}</p>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Priority — company_fit × contact_fit × (0.5 + 0.5 × readiness). Click opens the Priority side panel. */}
                          <div className="min-w-0 flex items-center justify-center">
                            <TableFitGaugeButton
                              score={displayContactPriority(lead)}
                              title="View priority (company fit × contact fit × readiness)"
                              arcColorFn={priorityScoreArcColor}
                              onOpen={(e) => {
                                e.stopPropagation();
                                setSelectedLeadId(lead.id);
                                setSelectedPreview('priority');
                                cancelEditingLead();
                              }}
                            />
                          </div>

                          {/* HubSpot — hidden below 1280px (narrow viewport) */}
                          <div className="hidden min-w-0 items-center justify-center min-[1280px]:flex [.arcova-agent-collapsed_&]:lg:flex">
                            {(() => {
                              const hubspotState = hubspotCrmByContactId[lead.id];
                              const badge = hubspotState?.loading
                                ? {
                                    label: 'Loading…',
                                    className:
                                      'border-[rgba(13,53,71,0.08)] bg-[rgba(13,53,71,0.03)] text-[#7d909a]',
                                  }
                                : getHubSpotTableBadge(lead);
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLeadId(lead.id);
                                    setSelectedPreview('hubspot');
                                    cancelEditingLead();
                                  }}
                                  className={cn(
                                    'inline-flex max-w-[7.15rem] items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors hover:brightness-[0.98]',
                                    badge.className,
                                  )}
                                  title={badge.label}
                                >
                                  <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-left">
                                    {badge.label}
                                  </span>
                                </button>
                              );
                            })()}
                          </div>

                          {/* Action — hidden below 1280px (narrow viewport) */}
                          <div className="hidden min-w-0 items-center justify-center min-[1280px]:flex [.arcova-agent-collapsed_&]:lg:flex">
                            {(() => {
                              const action = getContactAction(lead);
                              const config = LEAD_ACTION_PILL_CLASS[action];
                              return (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditingLead();
                                    // Action-driven routing:
                                    //   send_outreach → /outreach editor (review & dispatch the staged draft)
                                    //   reach_out      → side-panel Outreach tab (generate a fresh sequence)
                                    //   anything else  → side-panel Action drawer (explanation)
                                    if (action === 'send_outreach') {
                                      router.push(ROUTES.outreach);
                                      return;
                                    }
                                    setSelectedLeadId(lead.id);
                                    setSelectedPreview(action === 'reach_out' ? 'outreach' : 'action');
                                  }}
                                  className={cn(
                                    'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium cursor-pointer select-none',
                                    'transition-colors duration-150 ease-out hover:shadow-sm active:scale-[0.97]',
                                    isSelected && selectedPreview === 'action'
                                      ? config.rowSelectedClassName
                                      : cn(config.className, config.interactiveClassName, 'shadow-sm'),
                                  )}
                                >
                                  {config.label}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer — pagination when not filtered */}
                  {!agentFilterIds && totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.35)] px-4 py-3">
                      <p className="text-xs text-gray-500">
                        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of{' '}
                        {total.toLocaleString()}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs text-gray-600">
                          {page} / {totalPages}
                        </span>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                          className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                </div>

              </div>

                {/* ── Detail panel (overlays main column; sits left of agent on wide screens) ── */}
                {selectedLeadId && (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-40 transition-opacity min-[1280px]:hidden"
                      aria-label="Close panel"
                      onClick={() => {
                        setSelectedLeadId(null);
                        cancelEditingLead();
                      }}
                      // The backdrop covers the whole viewport so we can catch
                      // click-outside, but that also swallows wheel events over the
                      // contact table behind it. Forward wheel deltas to the leads
                      // scroll container so the list stays scrollable while a
                      // contact card is open at narrow widths.
                      onWheel={(e) => {
                        if (leadsScrollRef.current) {
                          leadsScrollRef.current.scrollTop += e.deltaY;
                        }
                      }}
                    />
                    {/* Floating agent chat bar — sits at the TOP of the AgentPanel column
                        (above the contact card) while the user reviews a contact. The agent
                        column itself is `invisible` in this state, so this bar is the agent's
                        only visible surface. Uses the shared `AgentChatBar` so it matches the
                        side-panel agent's input exactly. Submit dismisses the contact card and
                        forwards the text to the agent, which expands back into view. The expand
                        button docks the full agent into the top half (50/50 with the panel). */}
                    {agentRect && !agentDocked && (
                      <div
                        className={cn(
                          // Glass card wrapper — same surface treatment as the contact
                          // card below it (rounded, white-translucent, soft border,
                          // backdrop blur) so the two read as one stacked column.
                          'fixed z-[51] flex items-center rounded-[1.3125rem] border border-arcova-teal/60 bg-[rgba(255,255,255,0.55)] px-3 py-2.5 shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] ring-1 ring-arcova-teal/10 backdrop-blur-2xl backdrop-saturate-150',
                        )}
                        style={{
                          top: agentRect.top,
                          // Width-aligned to the contact card (which uses agentRect.width).
                          left: agentRect.left,
                          width: agentRect.width,
                        }}
                      >
                        <AgentChatBar
                          value={agentChatBarValue}
                          onChange={setAgentChatBarValue}
                          onSubmit={() => {
                            const text = agentChatBarValue.trim();
                            if (!text) return;
                            fireAgent(text);
                            setAgentChatBarValue('');
                            setSelectedLeadId(null);
                            cancelEditingLead();
                          }}
                          placeholder="Ask anything about your contacts…"
                          className="w-full"
                        />
                        <button
                          type="button"
                          onClick={() => setAgentDocked(true)}
                          className="ml-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-arcova-teal/30 bg-white/70 text-arcova-teal transition-colors hover:bg-arcova-teal/5"
                          aria-label="Expand agent"
                          title="Open the agent above the panel"
                        >
                          <Maximize2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <aside
                      className={cn(
                        // Position + size mirror the AgentPanel column's actual bounding rect
                        // (see agentRect state above), so the drawer fully covers the agent
                        // regardless of viewport width or padding. Glass surface (translucent
                        // white + backdrop-blur) matches the rest of the page; the Contact /
                        // Agent bookmark tabs let users switch between the two cards.
                        'contacts-leads-drawer flex min-h-0 flex-col overflow-hidden rounded-[1.3125rem] border border-[rgba(255,255,255,0.88)] bg-[rgba(255,255,255,0.55)] shadow-[0_24px_60px_-32px_rgba(13,53,71,0.2)] backdrop-blur-2xl backdrop-saturate-150',
                        'fixed z-50',
                        // Fallback for the first paint, before the rect is measured.
                        !agentRect && 'max-md:bottom-3.5 max-md:top-3.5 max-md:right-3.5 max-md:w-[min(calc(100vw-1.75rem),22.5rem)] md:top-[14px] md:bottom-[14px] md:right-[1.625rem] md:w-[22.5rem]',
                      )}
                      style={
                        agentRect
                          ? agentDocked
                            ? {
                                // Docked: drawer takes the bottom half; the agent fills the
                                // top half (50/50 split, viewport-relative like the design).
                                top: 'calc(50vh + 6px)',
                                left: agentRect.left,
                                width: agentRect.width,
                                height: 'calc(50vh - 20px)',
                              }
                            : {
                                // Pushed down 64px to leave room at the TOP for the floating
                                // agent chat bar, which now sits above the contact card.
                                top: agentRect.top + 64,
                                left: agentRect.left,
                                width: agentRect.width,
                                height: Math.max(0, agentRect.height - 64),
                              }
                          : undefined
                      }
                    >
                  {selectedLead ? (
                    <div
                      className={cn(
                        // Soft teal header glow now reads on every tab (was contact-only) so
                        // the redesigned header sits on a consistent gradient throughout.
                        'relative z-[1] flex min-h-0 h-full flex-col',
                        'before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-0 before:h-28 before:bg-gradient-to-b before:from-[rgba(227,243,241,0.75)] before:via-[rgba(255,255,255,0.35)] before:to-transparent',
                      )}
                    >
                      {/* Panel header — avatar leads, then eyebrow + name, close trails (design .dh) */}
                      <div className="relative z-[1] flex items-center gap-3 border-b border-[rgba(13,53,71,0.08)] px-4 pb-3.5 pt-[18px]">
                        {(selectedLead.profile_photo_cached || selectedLead.profile_photo_url) && !failedProfilePhotoByContactId[selectedLead.id] ? (
                          <img
                            src={selectedLead.profile_photo_cached || selectedLead.profile_photo_url!}
                            alt=""
                            className="h-[3.375rem] w-[3.375rem] shrink-0 rounded-[13px] object-cover shadow-sm ring-1 ring-black/5"
                            onError={() =>
                              setFailedProfilePhotoByContactId((prev) => ({
                                ...prev,
                                [selectedLead.id]: true,
                              }))
                            }
                          />
                        ) : (
                          <div className="flex h-[3.375rem] w-[3.375rem] shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#1f6173] to-[#0d6680] text-lg font-semibold text-[#cfeef0] shadow-sm ring-1 ring-black/5">
                            {(
                              selectedLead.first_name?.[0] ||
                              selectedLead.full_name?.[0] ||
                              '?'
                            ).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                            {selectedPreview === 'contact'
                              ? 'Contact'
                              : selectedPreview === 'hubspot'
                                ? 'CRM'
                              : selectedPreview === 'scoring'
                                ? 'Fit'
                                : selectedPreview === 'signals'
                                  ? 'Signals'
                                  : selectedPreview === 'priority'
                                    ? 'Priority'
                                    : selectedPreview === 'outreach'
                                      ? 'Outreach'
                                      : 'Action'}
                          </p>
                          <h2 className="font-manrope mt-1 break-words text-xl font-bold leading-tight tracking-[-0.024em] text-[rgb(13,53,71)] sm:text-[1.4375rem]">
                            {[selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ') ||
                              selectedLead.full_name ||
                              'Selected contact'}
                          </h2>
                        </div>
                        {agentRect && (
                          <button
                            type="button"
                            onClick={() => setAgentDocked((d) => !d)}
                            className="contacts-drawer-close shrink-0"
                            aria-label={agentDocked ? 'Expand panel to full height' : 'Share space with the agent'}
                            title={agentDocked ? 'Expand to full height' : 'Shrink — open the agent above'}
                          >
                            {agentDocked ? (
                              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                            ) : (
                              <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLeadId(null);
                            cancelEditingLead();
                          }}
                          className="contacts-drawer-close shrink-0"
                          aria-label="Close details"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </div>

                      {/* Peer tab strip — all panel views as siblings. Existing
                          row-button entries still work as deep-links into a tab. */}
                      <div className="relative z-[1] flex items-center gap-0.5 border-b border-[rgba(13,53,71,0.06)] bg-white/60 px-2.5 py-2">
                        {([
                          { key: 'contact', label: 'Contact' },
                          { key: 'scoring', label: 'Fit' },
                          { key: 'priority', label: 'Priority' },
                          { key: 'hubspot', label: 'CRM' },
                          { key: 'signals', label: 'Signals' },
                          { key: 'action', label: 'Action' },
                          { key: 'outreach', label: 'Outreach' },
                        ] as const).map(({ key, label }) => {
                          const isActive = selectedPreview === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setSelectedPreview(key)}
                              className={cn(
                                // Equal-width tabs so all 7 fit without horizontal scroll (design .tabs)
                                'min-w-0 flex-1 whitespace-nowrap rounded-[9px] px-1 py-1.5 text-center text-[11.5px] font-semibold transition-colors',
                                isActive
                                  ? 'bg-arcova-teal/10 text-arcova-teal'
                                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Panel body */}
                      <div
                        className={cn(
                          'min-h-0 flex-1 overflow-auto',
                          selectedPreview === 'contact' ? 'space-y-4 px-4 py-4' : 'space-y-5 px-5 py-4',
                        )}
                      >
                        {selectedPreview === 'contact' ? (
                          isEditingSelected ? (
                            /* ── Edit mode ── */
                            <div className="space-y-3">
                              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                  Import and enrichment emails
                                </p>
                                <p className="mt-1 text-[11px] text-gray-500">
                                  Addresses are read-only here. You can override deliverability status.
                                </p>
                                <div className="mt-2 space-y-2 text-xs text-gray-700">
                                  {(() => {
                                    const dirRows = buildContactEmailDisplayRows(
                                      selectedLead.email,
                                      selectedLead.contact_emails,
                                      'enrichmentOnly',
                                    );
                                    if (dirRows.length === 0) {
                                      return <p className="text-gray-500">None on file yet.</p>;
                                    }
                                    return dirRows.map((r, i) => (
                                      <div
                                        key={`${r.label}-${r.email}-${i}`}
                                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 leading-snug"
                                      >
                                        <p className="min-w-0 break-all">
                                          <span className="font-medium text-gray-600">{r.label}: </span>
                                          {r.email}
                                        </p>
                                        <EmailDeliverabilitySelect
                                          value={
                                            editingFields?.email_deliverability_by_email[
                                              emailDeliverabilityEditKey(r.email)
                                            ] ?? r.email_deliverability
                                          }
                                          onChange={(next) => updateEmailDeliverabilityForAddress(r.email, next)}
                                        />
                                      </div>
                                    ));
                                  })()}
                                </div>
                              </div>

                              {/* Stacked phone numbers — same pattern as emails.
                                  Read-only here; values flow in via import,
                                  HubSpot sync, or Apollo enrichment.
                                  User-added phones are edited separately below. */}
                              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-2">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                  Import and enrichment phones (read-only)
                                </p>
                                <div className="mt-2 space-y-2 text-xs text-gray-700">
                                  {(() => {
                                    const phones = (selectedLead.contact_phones ?? []).filter(
                                      (p) => p.category !== 'user',
                                    );
                                    if (phones.length === 0) {
                                      return <p className="text-gray-500">None on file yet.</p>;
                                    }
                                    const labelFor = (cat: string) => {
                                      if (cat === 'import') return 'Import';
                                      if (cat === 'enriched_work') return 'Work';
                                      if (cat === 'enriched_mobile') return 'Mobile';
                                      if (cat === 'enriched_personal') return 'Personal';
                                      return 'Enriched';
                                    };
                                    return phones.map((p) => (
                                      <p key={p.id} className="break-all leading-snug">
                                        <span className="font-medium text-gray-600">{labelFor(p.category)}: </span>
                                        {p.phone}
                                      </p>
                                    ));
                                  })()}
                                </div>
                                <button
                                  type="button"
                                  disabled={revealingPhoneLeadId === selectedLead.id}
                                  onClick={() => void handleRevealPhone(selectedLead.id)}
                                  className="mt-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-arcova-navy disabled:opacity-50"
                                >
                                  {revealingPhoneLeadId === selectedLead.id ? 'Starting reveal…' : 'Reveal phone · 20 credits'}
                                </button>
                              </div>

                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">First name</label>
                                <input
                                  value={editingFields?.first_name || ''}
                                  onChange={(e) => updateEditingField('first_name', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Last name</label>
                                <input
                                  value={editingFields?.last_name || ''}
                                  onChange={(e) => updateEditingField('last_name', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">
                                  Primary email (Leads / sync)
                                </label>
                                <input
                                  type="email"
                                  autoComplete="off"
                                  value={editingFields?.email || ''}
                                  onChange={(e) => updateEditingField('email', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                                {editingFields?.email.trim() ? (
                                  <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <span className="text-xs text-gray-500">Deliverability</span>
                                    <EmailDeliverabilitySelect
                                      value={
                                        editingFields.email_deliverability_by_email[
                                          emailDeliverabilityEditKey(editingFields.email)
                                        ] ?? selectedLead.email_deliverability
                                      }
                                      onChange={(next) =>
                                        updateEmailDeliverabilityForAddress(editingFields.email, next)
                                      }
                                    />
                                  </div>
                                ) : null}
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="text-xs text-gray-400">Additional emails (you added)</label>
                                  <button
                                    type="button"
                                    onClick={addUserSecondaryEmail}
                                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-white"
                                  >
                                    <Plus className="h-3 w-3" />
                                    Add
                                  </button>
                                </div>
                                <div className="space-y-2">
                                  {(editingFields?.user_secondary_emails ?? []).length === 0 ? (
                                    <p className="text-xs text-gray-500">
                                      Optional extras saved under &quot;You added&quot;.
                                    </p>
                                  ) : (
                                    (editingFields?.user_secondary_emails ?? []).map((addr, idx) => (
                                      <div key={idx} className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="email"
                                            autoComplete="off"
                                            value={addr}
                                            onChange={(e) => updateUserSecondaryEmailAt(idx, e.target.value)}
                                            onKeyDown={blurInputOnEnter}
                                            className={LEAD_EDIT_INPUT_CLASS}
                                            placeholder="name@company.com"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => removeUserSecondaryEmailAt(idx)}
                                            className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                            aria-label="Remove email"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                        </div>
                                        {addr.trim() ? (
                                          <div className="flex flex-wrap items-center gap-2 pl-0.5">
                                            <span className="text-xs text-gray-500">Deliverability</span>
                                            <EmailDeliverabilitySelect
                                              value={
                                                editingFields?.email_deliverability_by_email[
                                                  emailDeliverabilityEditKey(addr)
                                                ] ?? null
                                              }
                                              onChange={(next) => updateEmailDeliverabilityForAddress(addr, next)}
                                            />
                                          </div>
                                        ) : null}
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <label className="text-xs text-gray-400">Phones (you added)</label>
                                  <button
                                    type="button"
                                    onClick={addUserPhone}
                                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-white"
                                  >
                                    <Plus className="h-3 w-3" />
                                    Add
                                  </button>
                                </div>
                                <div className="space-y-2">
                                  {(editingFields?.user_phones ?? []).length === 0 ? (
                                    <p className="text-xs text-gray-500">
                                      Optional phones saved under &quot;You added&quot;.
                                    </p>
                                  ) : (
                                    (editingFields?.user_phones ?? []).map((phone, idx) => (
                                      <div key={idx} className="flex items-center gap-2">
                                        <input
                                          type="tel"
                                          autoComplete="off"
                                          value={phone}
                                          onChange={(e) => updateUserPhoneAt(idx, e.target.value)}
                                          onKeyDown={blurInputOnEnter}
                                          className={LEAD_EDIT_INPUT_CLASS}
                                          placeholder="+1 415 555 0123"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => removeUserPhoneAt(idx)}
                                          className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                          aria-label="Remove phone"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Job title</label>
                                <input
                                  value={editingFields?.job_title || ''}
                                  onChange={(e) => updateEditingField('job_title', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Headline</label>
                                <input
                                  value={editingFields?.headline || ''}
                                  onChange={(e) => updateEditingField('headline', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">LinkedIn URL</label>
                                <input
                                  value={editingFields?.linkedin_url || ''}
                                  onChange={(e) => updateEditingField('linkedin_url', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Company name</label>
                                <input
                                  value={editingFields?.company_name || ''}
                                  onChange={(e) => updateEditingField('company_name', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Company domain</label>
                                <input
                                  value={editingFields?.company_domain || ''}
                                  onChange={(e) => updateEditingField('company_domain', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Company LinkedIn URL</label>
                                <input
                                  value={editingFields?.company_linkedin_url || ''}
                                  onChange={(e) => updateEditingField('company_linkedin_url', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-400">Location</label>
                                <input
                                  value={editingFields?.location || ''}
                                  onChange={(e) => updateEditingField('location', e.target.value)}
                                  onKeyDown={blurInputOnEnter}
                                  className={LEAD_EDIT_INPUT_CLASS}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                  <label className="text-xs text-gray-400">City</label>
                                  <input
                                    value={editingFields?.city || ''}
                                    onChange={(e) => updateEditingField('city', e.target.value)}
                                    onKeyDown={blurInputOnEnter}
                                    className={LEAD_EDIT_INPUT_CLASS}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-xs text-gray-400">Country</label>
                                  <input
                                    value={editingFields?.country || ''}
                                    onChange={(e) => updateEditingField('country', e.target.value)}
                                    onKeyDown={blurInputOnEnter}
                                    className={LEAD_EDIT_INPUT_CLASS}
                                  />
                                </div>
                              </div>
                              {leadEditError ? (
                                <p className="text-xs text-red-600" role="alert">
                                  {leadEditError}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            /* ── View mode ── */
                            <div className="space-y-4">
                              {isSelectedLeadRefreshRunning && selectedLeadEnrichmentProgress && (
                                <div className="rounded-xl border border-arcova-teal/25 bg-arcova-teal/5 px-3.5 py-3 flex gap-2.5">
                                  <RotateCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-arcova-teal" aria-hidden />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[12.5px] font-semibold text-arcova-teal">Enriching this contact…</p>
                                    <p className="mt-0.5 text-[12px] leading-relaxed text-[#1f475a]">
                                      {selectedLeadEnrichmentProgress.label}…
                                    </p>
                                    <div className="mt-2.5 flex items-center gap-3">
                                      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-arcova-teal/12">
                                        <div
                                          className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                                          style={{ width: `${selectedLeadEnrichmentProgress.percent}%` }}
                                        >
                                          <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-14 rounded-full" />
                                        </div>
                                      </div>
                                      <span className="text-[11px] font-medium tabular-nums text-arcova-teal">
                                        {selectedLeadEnrichmentProgress.percent}%
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {selectedLead.contact_bio && selectedLead.contact_bio.length > 0 && (
                                <div className="overflow-hidden rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                  <button
                                    type="button"
                                    onClick={() => setContactPanelOpen((s) => ({ ...s, about: !s.about }))}
                                    className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.95)]"
                                  >
                                    <span className="font-manrope text-xs font-semibold text-[#0d3547]">
                                      About
                                    </span>
                                    <ChevronDown
                                      className={`h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200 ${
                                        contactPanelOpen.about ? '' : '-rotate-90'
                                      }`}
                                    />
                                  </button>
                                  {contactPanelOpen.about && (
                                    <div className="border-t border-[rgba(13,53,71,0.06)] px-3 pb-3 pt-3">
                                      {selectedLead.contact_bio.length === 1 ? (
                                        <p className="text-sm leading-[1.55] text-[#4a6470]">
                                          {selectedLead.contact_bio[0]}
                                        </p>
                                      ) : (
                                        <ul className="space-y-3">
                                          {selectedLead.contact_bio.map((bullet, i) => (
                                            <li key={i} className="flex gap-3 text-sm leading-snug text-[#4a6470]">
                                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-arcova-teal" />
                                              {bullet}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="overflow-hidden rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                <button
                                  type="button"
                                  onClick={() => setContactPanelOpen((s) => ({ ...s, details: !s.details }))}
                                  className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.95)]"
                                >
                                  <span className="font-manrope text-xs font-semibold text-[#0d3547]">
                                    Role &amp; contact
                                  </span>
                                  <ChevronDown
                                    className={`h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200 ${
                                      contactPanelOpen.details ? '' : '-rotate-90'
                                    }`}
                                  />
                                </button>
                                {contactPanelOpen.details && (
                                  <div className="border-t border-[rgba(13,53,71,0.06)] px-3 pb-3 pt-3">
                                    <div className="min-w-0 space-y-5">
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Job title
                                        </p>
                                        <p className="mt-2 break-words text-sm leading-snug text-[#0d3547]">
                                          {selectedLead.resolved_current_job_title ||
                                            selectedLead.job_title ||
                                            '—'}
                                        </p>
                                      </div>
                                      {(() => {
                                        // Location split into City / State / Country sub-fields.
                                        // The `location` string is the reliable source (LinkedIn
                                        // "City, State, Country"); the separate city/country columns
                                        // are unreliable. See lib/contact-profile-display.
                                        const parts = parseContactLocation(
                                          selectedLead.location,
                                          selectedLead.city,
                                          selectedLead.country,
                                        );
                                        const cells: Array<{ label: string; value: string }> = [];
                                        if (parts.city) cells.push({ label: 'City', value: parts.city });
                                        if (parts.state) cells.push({ label: 'State', value: parts.state });
                                        if (parts.country) cells.push({ label: 'Country', value: parts.country });
                                        if (cells.length === 0) cells.push({ label: 'Location', value: '—' });
                                        return cells.map((c) => (
                                          <div key={c.label} className="min-w-0">
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                              {c.label}
                                            </p>
                                            <p className="mt-2 break-words text-sm leading-snug text-[#0d3547]">
                                              {c.value}
                                            </p>
                                          </div>
                                        ));
                                      })()}
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Emails
                                        </p>
                                        <div className="mt-2 space-y-2">
                                          {(() => {
                                            const emailRows = buildContactEmailDisplayRows(
                                              selectedLead.email,
                                              selectedLead.contact_emails,
                                              'full',
                                            );
                                            if (emailRows.length === 0) {
                                              return (
                                                <p className="break-words text-sm leading-snug text-[#0d3547]">—</p>
                                              );
                                            }
                                            return emailRows.map((r, i) => {
                                              const meta = getEmailDeliverabilityMeta(r.email_deliverability, {
                                                email: r.email,
                                                companyDomain:
                                                  selectedLead.resolved_current_company_domain ??
                                                  selectedLead.company_domain,
                                              });
                                              const VerificationIcon = meta.icon === 'check' ? Check : AlertTriangle;
                                              return (
                                                <div
                                                  key={`${r.label}-${r.email}-${i}`}
                                                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm leading-snug text-[#0d3547]"
                                                >
                                                  <p className="min-w-0 break-all">
                                                    <span className="font-medium text-[#7d909a]">{r.label}: </span>
                                                    {r.email}
                                                  </p>
                                                  <span className={`inline-flex shrink-0 items-center gap-1 ${meta.className}`}>
                                                    <VerificationIcon className="h-3.5 w-3.5" aria-hidden />
                                                    <span className="text-xs font-medium">{meta.label}</span>
                                                  </span>
                                                </div>
                                              );
                                            });
                                          })()}
                                        </div>
                                        {isAvanzadoTestContact(selectedLead) && (
                                          <div className="mt-3 space-y-1.5">
                                            <div className="flex flex-wrap gap-2">
                                              <button
                                                type="button"
                                                onClick={() => void handleFindNewEmail(selectedLead.id)}
                                                disabled={findingEmailLeadId === selectedLead.id}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                              >
                                                {findingEmailLeadId === selectedLead.id ? (
                                                  <RotateCw className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                  <MailCheck className="h-3.5 w-3.5" />
                                                )}
                                                {findingEmailLeadId === selectedLead.id
                                                  ? 'Testing…'
                                                  : 'Test: get new email'}
                                              </button>
                                            </div>
                                            {findEmailErrorByLeadId[selectedLead.id] && (
                                              <p className="text-xs leading-snug text-rose-600">
                                                {findEmailErrorByLeadId[selectedLead.id]}
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          LinkedIn
                                        </p>
                                        {selectedLead.linkedin_url ? (
                                          <a
                                            href={selectedLead.linkedin_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-2 inline-flex min-w-0 items-start gap-1.5 break-all text-sm font-medium leading-snug text-arcova-teal hover:underline"
                                          >
                                            <span className="min-w-0">
                                              {selectedLead.linkedin_url.replace(/^https?:\/\/(www\.)?/, '')}
                                            </span>
                                            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-arcova-teal" />
                                          </a>
                                        ) : (
                                          <p className="mt-2 text-sm leading-snug text-[#0d3547]">—</p>
                                        )}
                                      </div>
                                    </div>
                                    {selectedLead.email && contactEmailMayBeOutdated(selectedLead.email_status) && (
                                        <p className="mt-4 flex items-start gap-1.5 text-xs leading-snug text-amber-700">
                                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                                          <span>
                                            {selectedLead.email_status === 'stale_suspected'
                                              ? 'This email is from a prior employer and is likely to bounce. Find a new work email before outreach.'
                                              : 'One or more emails may be outdated. Verify or find a current work email before outreach.'}
                                          </span>
                                        </p>
                                      )}
                                  </div>
                                )}
                              </div>

                              {selectedLead.resolved_employment_history &&
                                selectedLead.resolved_employment_history.length > 0 && (
                                  <div className="overflow-hidden rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setContactPanelOpen((s) => ({ ...s, workHistory: !s.workHistory }))
                                      }
                                      className="flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.95)]"
                                    >
                                      <span className="font-manrope text-xs font-semibold text-[#0d3547]">
                                        Work history
                                      </span>
                                      <ChevronDown
                                        className={`h-4 w-4 shrink-0 text-[#7d909a] transition-transform duration-200 ${
                                          contactPanelOpen.workHistory ? '' : '-rotate-90'
                                        }`}
                                      />
                                    </button>
                                    {contactPanelOpen.workHistory && (
                                      <div className="space-y-4 border-t border-[rgba(13,53,71,0.06)] px-3 pb-3 pt-4">
                                        <div className="space-y-5">
                                          {(isWorkHistoryExpanded
                                            ? selectedLead.resolved_employment_history
                                            : selectedLead.resolved_employment_history.slice(
                                                0,
                                                MAX_VISIBLE_WORK_HISTORY,
                                              )
                                          ).map((job, i, arr) => (
                                            <div key={i} className="flex items-stretch gap-4">
                                              <div className="flex w-4 shrink-0 flex-col items-center pt-1">
                                                <div
                                                  className={`z-[1] h-2.5 w-2.5 rounded-full ${
                                                    job.current ? 'bg-arcova-teal' : 'bg-[rgba(13,53,71,0.2)]'
                                                  }`}
                                                />
                                                {i < arr.length - 1 ? (
                                                  <div className="mx-auto mt-1 w-px flex-1 bg-[rgba(13,53,71,0.1)]" />
                                                ) : null}
                                              </div>
                                              <div className="min-w-0 pb-1">
                                                <p className="text-sm font-semibold leading-snug text-[#0d3547]">
                                                  {job.title || '—'}
                                                </p>
                                                <p className="mt-1 text-sm leading-snug text-[#4a6470]">
                                                  {job.company_name || '—'}
                                                </p>
                                                <p className="mt-1.5 text-xs tabular-nums text-[#7d909a]">
                                                  {[job.start_date, job.end_date].filter(Boolean).join(' → ')}
                                                </p>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        {selectedLead.resolved_employment_history.length >
                                          MAX_VISIBLE_WORK_HISTORY && (
                                          <button
                                            type="button"
                                            onClick={() => setIsWorkHistoryExpanded((prev) => !prev)}
                                            className="inline-flex items-center gap-1.5 pt-1 text-sm font-semibold text-arcova-teal transition-colors hover:text-arcova-teal/85"
                                          >
                                            <ChevronDown
                                              className={`h-4 w-4 transition-transform ${
                                                isWorkHistoryExpanded ? 'rotate-180' : ''
                                              }`}
                                            />
                                            {isWorkHistoryExpanded
                                              ? 'Show fewer roles'
                                              : `Show ${
                                                  selectedLead.resolved_employment_history.length -
                                                  MAX_VISIBLE_WORK_HISTORY
                                                } more roles`}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                              <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-3 py-3 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                <p className="mb-3 font-manrope text-xs font-semibold text-[#0d3547]">Data source</p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                      Type
                                    </p>
                                    <p className="mt-2 text-sm leading-snug text-[#0d3547]">
                                      {selectedLeadDataSourceTypeLabel}
                                    </p>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                      Imported
                                    </p>
                                    <p className="mt-2 text-sm leading-snug text-[#0d3547]">
                                      {formatProvenanceImportedAt(selectedLead.data_provenance_imported_at)}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-4 space-y-3 border-t border-[rgba(13,53,71,0.06)] pt-4">
                                  <p className="text-xs leading-snug text-[#4a6470]">
                                    Last updated {formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}
                                  </p>

                                  {effectiveRefreshStatus === 'running' && (
                                    <div
                                      className={`rounded-lg border px-3 py-2 text-xs ${effectiveRefreshStatusMeta.className}`}
                                    >
                                      <p className="font-medium">{effectiveRefreshStatusMeta.label}</p>
                                      <div className="mt-2 flex flex-col gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => stopLeadEnrichment(selectedLead.id)}
                                          disabled={isStoppingSelected}
                                          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <Ban className="h-3.5 w-3.5" aria-hidden />
                                          {isStoppingSelected ? 'Stopping…' : 'Stop enrichment'}
                                        </button>
                                        {stopEnrichmentError && (
                                          <p className="text-xs text-red-500">{stopEnrichmentError}</p>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {showEnrichmentDoneCopy && enrichmentFinishedDisplayIso ? (
                                    <div className="rounded-xl bg-[#E6F4F1] px-4 py-3">
                                      <div className="flex gap-2.5">
                                        <Check
                                          className="mt-0.5 h-4 w-4 shrink-0 text-[#2D8A8A]"
                                          strokeWidth={2.25}
                                          aria-hidden
                                        />
                                        <div className="min-w-0 space-y-1">
                                          <p className="text-xs font-semibold text-[#2D8A8A]">Enrichment done</p>
                                          <p className="text-xs leading-snug text-[#6B7280]">
                                            Finished {formatLastUpdated(enrichmentFinishedDisplayIso)}.
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}

                                  {selectedLeadRefreshStatus === 'cancelled' &&
                                    selectedLead.enrichment_refresh_finished_at && (
                                      <p className="text-xs leading-snug text-[#6B7280]">
                                        Stopped {formatLastUpdated(selectedLead.enrichment_refresh_finished_at)}.
                                      </p>
                                    )}

                                  {selectedLeadRefreshStatus === 'failed' && (
                                    <>
                                      <p className="text-xs font-semibold text-[rgb(13,53,71)]">
                                        {selectedLeadRefreshStatusMeta.label}
                                      </p>
                                      <p className="text-xs leading-snug text-[#7d909a]">Showing last known data.</p>
                                    </>
                                  )}

                                  {selectedLeadRefreshStatus !== 'running' && (
                                    <p className="text-xs leading-relaxed text-[#6B7280]">
                                      You can refresh this enrichment again whenever you need updated data.
                                    </p>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => rerunEnrichment(selectedLead.id)}
                                    disabled={
                                      selectedLead.hubspot_lead_state === 'customer' ||
                                      isRefreshingSelected ||
                                      isStoppingSelected ||
                                      isEditingSelected ||
                                      isSelectedLeadRefreshRunning
                                    }
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <RotateCw
                                      className={`h-4 w-4 text-[#1F2937] ${isRefreshingSelected || isSelectedLeadRefreshRunning ? 'animate-spin' : ''}`}
                                    />
                                    {isRefreshingSelected
                                      ? 'Starting enrichment…'
                                      : isSelectedLeadRefreshRunning
                                        ? 'Enrichment running…'
                                        : selectedLead.hubspot_lead_state === 'customer'
                                          ? 'Customer in HubSpot'
                                          : 'Refresh enrichment'}
                                  </button>
                                  {selectedLead.hubspot_lead_state === 'customer' ? (
                                    <p className="text-xs leading-snug text-[#7d909a]">
                                      Closed-won contacts should move through customer workflows instead of paid lead enrichment.
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )
                        ) : selectedPreview === 'hubspot' ? (
                          <div className="space-y-4">
                            <div className="flex items-center gap-2">
                              <span className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">
                                HubSpot CRM
                              </span>
                              <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[#7d909a]">
                                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#2d8a8a]" />
                                Connected
                              </span>
                            </div>

                            {selectedHubSpotCrmState?.loading ? (
                              <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-white/80 px-4 py-4">
                                <p className="text-sm leading-snug text-[#4a6470]">Loading HubSpot CRM…</p>
                              </div>
                            ) : selectedHubSpotCrmState?.error ? (
                              <div className="rounded-xl border border-[#ffd8c7] bg-[#fff7f3] px-4 py-4">
                                <p className="text-sm leading-snug text-[#b45309]">{selectedHubSpotCrmState.error}</p>
                              </div>
                            ) : selectedHubSpotCrm?.deals?.length ? (
                              <div className="space-y-3">
                                {selectedHubSpotCrm.deals.map((deal) => {
                                  const arcovaCompanyName =
                                    selectedHubSpotCrm.arcova_company_name ??
                                    selectedLead.companies?.company_name ??
                                    selectedLead.resolved_current_company_name ??
                                    null;
                                  const arcovaCompanyDomain =
                                    selectedHubSpotCrm.arcova_company_domain ??
                                    selectedLead.companies?.domain ??
                                    selectedLead.resolved_current_company_domain ??
                                    null;
                                  const hasMismatch =
                                    Boolean(deal.hubspot_company_domain) &&
                                    Boolean(arcovaCompanyDomain) &&
                                    deal.hubspot_company_domain !== arcovaCompanyDomain;

                                  return (
                                    <div
                                      key={deal.hubspot_deal_id}
                                      className="rounded-2xl border border-[rgba(13,53,71,0.08)] bg-white/90 px-4 py-4 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <p className="text-base font-semibold text-[#0d3547]">
                                            {deal.deal_name || 'HubSpot deal'}
                                          </p>
                                          <p className="mt-1 text-xs text-[#7d909a]">
                                            HubSpot account:{' '}
                                            <span className="font-medium text-[#4a6470]">
                                              {deal.hubspot_company_name || deal.hubspot_company_domain || '—'}
                                            </span>
                                          </p>
                                        </div>
                                        {deal.deal_stage ? (
                                          <span className="inline-flex items-center rounded-full bg-[#fff1ec] px-2.5 py-1 text-[11px] font-medium text-[#cc5b3f]">
                                            {deal.deal_stage}
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                            Company
                                          </p>
                                          <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                            {arcovaCompanyName || '—'}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                            Domain
                                          </p>
                                          <p className="mt-1 break-all text-sm leading-snug text-[#0d3547]">
                                            {arcovaCompanyDomain || '—'}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                            Amount
                                          </p>
                                          <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                            {formatUsdValue(deal.amount) || '—'}
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                            Last synced
                                          </p>
                                          <p className="mt-1 text-sm leading-snug text-[#0d3547]">
                                            {formatLastUpdated(deal.synced_at)}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="mt-4 space-y-2">
                                        {deal.close_date ? (
                                          <p className="text-xs leading-snug text-[#4a6470]">
                                            Close date:{' '}
                                            <span className="font-medium text-[#0d3547]">
                                              {formatLastUpdated(deal.close_date)}
                                            </span>
                                          </p>
                                        ) : null}
                                        {hasMismatch ? (
                                          <div className="rounded-lg border border-[#ffd8c7] bg-[#fff7f3] px-3 py-2">
                                            <p className="text-xs font-medium text-[#b45309]">
                                              This deal points at a different company
                                            </p>
                                            <p className="mt-1 text-xs leading-snug text-[#7c5a4b]">
                                              The matched account is {arcovaCompanyName || arcovaCompanyDomain || 'this contact’s company'},
                                              but HubSpot still has this deal attached to{' '}
                                              {deal.hubspot_company_name || deal.hubspot_company_domain || 'another CRM account'}.
                                            </p>
                                          </div>
                                        ) : null}
                                        {deal.resolution_suppressed && !hasMismatch ? (
                                          <div className="rounded-lg border border-[rgba(13,53,71,0.08)] bg-[rgba(246,250,252,0.9)] px-3 py-2">
                                            <p className="text-xs font-medium text-[#0d3547]">
                                              Stored as HubSpot CRM context only
                                            </p>
                                            <p className="mt-1 text-xs leading-snug text-[#4a6470]">
                                              We kept this deal for CRM visibility, but did not use it to move an Arcova account yet.
                                            </p>
                                          </div>
                                        ) : null}
                                        {deal.resolution_status ? (
                                          <p className="text-xs leading-snug text-[#4a6470]">
                                            Resolution:{' '}
                                            <span className="font-medium text-[#0d3547]">
                                              {formatHubSpotResolutionLabel(deal.resolution_status)}
                                            </span>
                                          </p>
                                        ) : null}
                                        {deal.mismatch_reason ? (
                                          <p className="text-xs leading-snug text-[#7d909a]">
                                            {deal.mismatch_reason}
                                          </p>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-white/80 px-4 py-4">
                                <p className="text-sm leading-snug text-[#4a6470]">
                                  No mirrored HubSpot deal activity on this contact yet.
                                </p>
                              </div>
                            )}
                          </div>
                        ) : selectedPreview === 'action' ? (
                          /* ── Action view ── */
                          (() => {
                            if (selectedLead.hubspot_lead_state === 'customer') {
                              return (
                                <div className="space-y-3">
                                  <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                    This contact is already part of a closed-won customer account in HubSpot, so it
                                    should not be worked as an active lead here.
                                  </p>
                                  <div className="rounded-xl border border-[rgba(45,138,138,0.22)] bg-[rgba(45,138,138,0.07)] p-4">
                                    <p className="text-sm font-semibold text-[#2d8a8a]">Customer state</p>
                                    <p className="mt-1 text-sm leading-snug text-[#4a6470]">
                                      Keep the CRM history for attribution and future customer workflows, but avoid
                                      spending more lead-enrichment budget on it from this queue.
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] px-4 py-4 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.08)]">
                                    <p className="text-sm font-semibold text-[#0d3547]">Arcova attribution</p>
                                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                      <div className="rounded-lg border border-[rgba(13,53,71,0.08)] bg-white/80 px-3 py-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Sourced
                                        </p>
                                        <p className="mt-2 text-sm font-medium text-[#0d3547]">
                                          {selectedLeadArcovaSourced ? 'By Arcova' : 'Not by Arcova'}
                                        </p>
                                        <p className="mt-1 text-xs leading-snug text-[#6b7f8a]">
                                          {selectedLeadDataSourceTypeLabel}
                                        </p>
                                      </div>
                                      <div className="rounded-lg border border-[rgba(13,53,71,0.08)] bg-white/80 px-3 py-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Enriched
                                        </p>
                                        <p className="mt-2 text-sm font-medium text-[#0d3547]">
                                          {selectedLeadArcovaEnriched ? 'By Arcova' : 'Not yet'}
                                        </p>
                                        <p className="mt-1 text-xs leading-snug text-[#6b7f8a]">
                                          {selectedLeadLatestArcovaTouchIso
                                            ? `Last touch ${actionDrawerRelativeTime(selectedLeadLatestArcovaTouchIso)}`
                                            : 'No Arcova touch recorded'}
                                        </p>
                                      </div>
                                      <div className="rounded-lg border border-[rgba(13,53,71,0.08)] bg-white/80 px-3 py-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#7d909a]">
                                          Outcome
                                        </p>
                                        <p className="mt-2 text-sm font-medium text-[#0d3547]">
                                          {selectedLeadWonAfterArcovaTouch ? 'Won after Arcova touch' : 'Won in CRM'}
                                        </p>
                                        <p className="mt-1 text-xs leading-snug text-[#6b7f8a]">
                                          {selectedLead.hubspot_latest_deal_updated_at
                                            ? `Closed won ${actionDrawerRelativeTime(selectedLead.hubspot_latest_deal_updated_at)}`
                                            : 'Closed-won timing not yet available'}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            if (selectedLead.hubspot_lead_state === 'dormant') {
                              return (
                                <div className="space-y-3">
                                  <p className="text-[13.5px] leading-[1.55] text-[#0d3547]">
                                    This contact is tied to a closed-lost CRM motion, so it should stay dormant until a
                                    new signal changes the picture.
                                  </p>
                                  <div className="rounded-xl border border-[rgba(125,144,154,0.2)] bg-[rgba(125,144,154,0.08)] p-4">
                                    <p className="text-sm font-semibold text-[#5f7480]">Dormant for now</p>
                                    <p className="mt-1 text-sm leading-snug text-[#4a6470]">
                                      Let fresh budget, a new decision-maker, or a strategic shift reactivate this
                                      lead later.
                                    </p>
                                  </div>
                                </div>
                              );
                            }

                            const action = getContactAction(selectedLead);
                            const contactName =
                              [selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ') ||
                              selectedLead.full_name;

                            const actionConfig = LEAD_ACTION_PILL_CLASS[action];
                            const updatedIso =
                              selectedContactFit?.contact_fit_scored_at ??
                              selectedLead.updated_at ??
                              selectedLead.created_at ??
                              null;
                            const updatedRel = actionDrawerRelativeTime(updatedIso);

                            // Per-action content mapped into the design's two-card layout
                            // (Recommended action + Why this action). All states, conditions,
                            // CTAs and handlers are preserved — only the presentation changed.
                            const navyCta =
                              'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#11526a] to-[#0d3547] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(13,53,71,0.6)] transition hover:brightness-110';
                            const detail: { lede: ReactNode; cta?: ReactNode; why?: ReactNode } = (() => {
                              if (action === 'monitor') {
                                if (isLeadReadyAwaitingContactSignal(selectedLead)) {
                                  return {
                                    lede: (
                                      <>
                                        {contactName ? `${contactName} is` : 'This lead is'} a strong match on both the
                                        company and the persona. Keep the account on your radar and wait for a buying
                                        signal before reaching out.
                                      </>
                                    ),
                                  };
                                }
                                return {
                                  lede: (
                                    <>
                                      {contactName ? `${contactName} sits` : 'This lead sits'} in the watch band: company
                                      fit is promising but not yet high enough for sourcing the ideal persona. Keep the
                                      account visible and revisit when enrichment or the company moves.
                                    </>
                                  ),
                                  cta: (
                                    <button
                                      type="button"
                                      onClick={() => router.push(ROUTES.contacts)}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-arcova-teal/30 bg-white px-4 py-2.5 text-sm font-semibold text-arcova-teal transition-colors hover:bg-arcova-teal/5"
                                    >
                                      View Signals
                                      <ChevronRight className="h-4 w-4" aria-hidden />
                                    </button>
                                  ),
                                };
                              }
                              if (action === 'reach_out') {
                                return {
                                  lede: (
                                    <>
                                      This contact has a strong fit and at least one tracked buying signal. It is a good
                                      moment for personalised outreach.
                                    </>
                                  ),
                                  why: (
                                    <>
                                      Lead with relevance to their role and therapeutic focus, and tie your message to
                                      signals or milestones when you can.
                                    </>
                                  ),
                                  cta: (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedPreview('outreach')}
                                      className={navyCta}
                                    >
                                      Generate outreach sequence
                                      <ChevronRight className="h-4 w-4" aria-hidden />
                                    </button>
                                  ),
                                };
                              }
                              if (action === 'source_contact') {
                                return {
                                  lede: (
                                    <>
                                      {selectedLead.companies?.company_name ? (
                                        <>
                                          <strong>{selectedLead.companies.company_name}</strong> is a strong ICP fit
                                        </>
                                      ) : (
                                        'The company is a strong ICP fit'
                                      )}
                                      , but {contactName || 'this contact'} isn&apos;t the right persona to approach this
                                      account. Source a better-matched contact before you reach out.
                                    </>
                                  ),
                                  why: (
                                    <>
                                      Open the Data page to request more contacts for this account. This company and ICP
                                      context are passed through so the agent can help you queue the right acquisition
                                      job.
                                    </>
                                  ),
                                  cta: selectedLead.company_id ? (
                                    <button
                                      type="button"
                                      onClick={openContactAcquisitionFromLead}
                                      className={navyCta}
                                    >
                                      <Users className="h-4 w-4 shrink-0" aria-hidden />
                                      Find buyer-persona contacts
                                    </button>
                                  ) : (
                                    <p className="text-[13px] leading-snug text-amber-800">
                                      This contact is not linked to a company record yet, so we cannot start a data
                                      request. Link or enrich the company first, then return here.
                                    </p>
                                  ),
                                };
                              }
                              if (action === 'send_outreach') {
                                return {
                                  lede: (
                                    <>
                                      An outreach sequence is staged for {contactName || 'this contact'} but hasn&apos;t
                                      been sent yet. Review the draft and send it when you&apos;re ready.
                                    </>
                                  ),
                                  cta: (
                                    <button
                                      type="button"
                                      onClick={() => router.push(ROUTES.outreach)}
                                      className={navyCta}
                                    >
                                      Open outreach
                                      <ChevronRight className="h-4 w-4" aria-hidden />
                                    </button>
                                  ),
                                };
                              }
                              if (action === 'await_reply') {
                                return {
                                  lede: (
                                    <>
                                      Outreach has been sent to {contactName || 'this contact'}. Waiting on a reply — no
                                      action needed right now.
                                    </>
                                  ),
                                  why: (
                                    <>
                                      If they reply we&apos;ll surface it; if the deal closes or is lost in your CRM, this
                                      action will flip to Deprioritise automatically.
                                    </>
                                  ),
                                };
                              }
                              if (action === 'deprioritize') {
                                return {
                                  lede: (
                                    <>Company or contact fit sits below your thresholds. Leave this one aside for now.</>
                                  ),
                                  why: (
                                    <>
                                      This doesn&apos;t mean they are permanently out. If their company situation changes
                                      or you revisit your ICP criteria, they may score higher in a future run.
                                    </>
                                  ),
                                };
                              }
                              if (action === 'fix') {
                                const reason = contactSyncIssueReason(selectedLead);
                                return {
                                  lede: (
                                    <>
                                      {contactName || 'This contact'} can&apos;t be synced to HubSpot yet because{' '}
                                      {reason === 'no_email'
                                        ? 'they have no email address on file'
                                        : 'their email address looks invalid'}
                                      . Add a valid work email (e.g. name@company.com) to unblock CRM sync and outreach.
                                    </>
                                  ),
                                  cta: (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedPreview('contact');
                                        startEditingLead(selectedLead);
                                      }}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#e8a07e] bg-white px-4 py-2.5 text-sm font-semibold text-[#b34a26] transition-colors hover:bg-[#fff3ee]"
                                    >
                                      Edit contact email
                                      <ChevronRight className="h-4 w-4" aria-hidden />
                                    </button>
                                  ),
                                };
                              }
                              return { lede: null };
                            })();

                            return (
                              <div className="space-y-3">
                                {/* Recommended action — pill + lede + CTA in one card (design TabAction) */}
                                <div className="rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] p-3.5 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
                                  <p className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">
                                    Recommended action
                                  </p>
                                  <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                                    <span
                                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${actionConfig.className}`}
                                    >
                                      {actionConfig.label}
                                    </span>
                                    {updatedRel ? (
                                      <span className="text-[11px] text-[#7d909a]">Updated {updatedRel}</span>
                                    ) : null}
                                  </div>
                                  {detail.lede ? (
                                    <p className="mt-3 text-[13.5px] leading-[1.55] text-[#0d3547]">{detail.lede}</p>
                                  ) : null}
                                  {detail.cta ? <div className="mt-3.5">{detail.cta}</div> : null}
                                </div>

                                {/* Why this action — secondary rationale in its own card */}
                                {detail.why ? (
                                  <div className="rounded-[14px] border border-[rgba(13,53,71,0.08)] bg-[rgba(255,255,255,0.82)] p-3.5 shadow-[0_1px_4px_-2px_rgba(13,53,71,0.1)]">
                                    <p className="font-manrope text-[13px] font-bold tracking-[-0.01em] text-[#0d3547]">
                                      Why this action
                                    </p>
                                    <p className="mt-2.5 text-[13.5px] leading-[1.55] text-[#4a6470]">{detail.why}</p>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })()
                        ) : selectedPreview === 'signals' ? (
                          /* ── Signals view ── */
                          <EntitySignalsList
                            contactId={selectedLead.id}
                            companyId={selectedLead.company_id ?? undefined}
                            primaryScope="contact"
                            effectiveReadinessScore={selectedLead.contact_readiness_score ?? null}
                            crmCappedReason={(() => {
                              const contactLabel = selectedLead.full_name || 'This contact';
                              if (selectedLead.hubspot_lead_state === 'customer') {
                                return `${contactLabel} is a closed-won contact. Readiness is low as you have already sold to this company.`;
                              }
                              if (selectedLead.hubspot_lead_state === 'dormant') {
                                return `${contactLabel} is a closed-lost contact. Readiness is low because the last deal was lost.`;
                              }
                              return null;
                            })()}
                          />
                        ) : selectedPreview === 'priority' ? (
                          /* ── Priority view — numbers only; details live in Fit + Signals tabs. ── */
                          (() => {
                            const fitPct = percentDisplayNumber(selectedLead.contact_fit_score);
                            const companyFitPct = percentDisplayNumber(
                              selectedLead.company_fit_score ?? selectedLead.companies?.company_fit_score ?? null,
                            );
                            // Effective readiness (account OR personal signal), with the CRM
                            // suppression cooldown folded in — this is what feeds priority, so
                            // the row must show the same value or the panel re-creates the
                            // "readiness 0 but priority high" mismatch. displayContactPriority
                            // is the SAME helper the table + sort use, so they can't diverge.
                            const effReadiness = displayEffectiveReadiness(selectedLead);
                            const readinessPct = percentDisplayNumber(effReadiness);
                            const priorityNorm = displayContactPriority(selectedLead);
                            const priorityPct = percentDisplayNumber(priorityNorm);
                            return (
                              <div className="space-y-3">
                                {/* Priority — large gauge, number only */}
                                <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-6">
                                  <AnimatedCircularProgressBar
                                    value={priorityPct ?? 0}
                                    gaugePrimaryColor={priorityScoreArcColor(priorityPct)}
                                    gaugeSecondaryColor="rgba(13,53,71,0.09)"
                                    animateOnMount
                                    deferAnimationMs={160}
                                    label={
                                      <span className="block text-xl font-semibold text-[#0d3547] leading-snug tabular-nums">
                                        {priorityPct != null ? priorityPct : '—'}
                                      </span>
                                    }
                                    className="size-24 [--transition-length:0.95s]"
                                  />
                                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7d909a]">
                                    Priority score
                                  </p>
                                  {(() => {
                                    const blurb = getPriorityExplanation({
                                      firstName: selectedLead.first_name,
                                      companyName:
                                        selectedLead.companies?.company_name ||
                                        selectedLead.resolved_current_company_name ||
                                        selectedLead.company_name,
                                      companyFit:
                                        selectedLead.company_fit_score ??
                                        selectedLead.companies?.company_fit_score ??
                                        null,
                                      contactFit: selectedLead.contact_fit_score,
                                      companyReadiness: selectedLead.company_readiness_score ?? null,
                                      contactReadiness: selectedLead.contact_readiness_score ?? null,
                                      crmState: selectedLead.hubspot_lead_state ?? null,
                                      dealClosedAt: selectedLead.hubspot_latest_deal_updated_at ?? null,
                                    });
                                    if (!blurb) return null;
                                    return (
                                      <p className="mt-3 text-[12.5px] leading-[1.55] text-[#1f475a]">
                                        {blurb}
                                      </p>
                                    );
                                  })()}
                                </div>

                                <ScoreRow
                                  label="Company fit"
                                  pct={companyFitPct}
                                  arcColor={fitScoreArcColor(companyFitPct)}
                                  onOpen={() => setSelectedPreview('scoring')}
                                />
                                <ScoreRow
                                  label="Contact fit"
                                  pct={fitPct}
                                  arcColor={fitScoreArcColor(fitPct)}
                                  onOpen={() => setSelectedPreview('scoring')}
                                />
                                <ScoreRow
                                  label="Readiness score"
                                  pct={readinessPct}
                                  arcColor={fitScoreArcColor(readinessPct)}
                                  onOpen={() => setSelectedPreview('signals')}
                                />
                              </div>
                            );
                          })()
                        ) : selectedPreview === 'outreach' ? (
                          /* ── Outreach view — picker + sequence editor + export ── */
                          <OutreachPanel
                            contactId={selectedLead.id}
                            contactName={
                              [selectedLead.first_name, selectedLead.last_name].filter(Boolean).join(' ') ||
                              selectedLead.full_name ||
                              'Contact'
                            }
                          />
                        ) : (
                          /* ── Scoring view ── */
                          <div className="space-y-3">
                            {(() => {
                              const fitSummaryText =
                                selectedPanelSummaries?.fitSummary?.trim() ||
                                selectedLead.contact_fit_summary?.trim() ||
                                '';
                              if (!selectedPanelSummariesState?.loading && !fitSummaryText) return null;
                              return (
                              <div className="rounded-xl border border-[rgba(13,53,71,0.1)] bg-[rgba(13,53,71,0.03)] px-3.5 py-3">
                                <p className="text-[12.5px] leading-[1.55] text-[#1f475a]">
                                  {selectedPanelSummariesState?.loading
                                    ? 'Summarising fit...'
                                    : fitSummaryText}
                                </p>
                              </div>
                              );
                            })()}

                            {renderContactFitScoresCard()}
                          </div>
                        )}
                      </div>

                      {/* Panel footer */}
                      <div
                        className={cn(
                          'border-t border-[rgba(13,53,71,0.08)] space-y-4 py-4',
                          selectedPreview === 'contact' ? 'px-4' : 'px-5',
                        )}
                      >
                        {selectedPreview !== 'contact' && (
                          <div className="space-y-4">
                            <p className="text-xs leading-snug text-[#4a6470]">
                              Last updated {formatLastUpdated(selectedLead.updated_at || selectedLead.created_at)}
                            </p>

                            {effectiveRefreshStatus === 'running' && (
                              <div
                                className={`rounded-lg border px-3 py-2 text-xs ${effectiveRefreshStatusMeta.className}`}
                              >
                                <p className="font-medium">{effectiveRefreshStatusMeta.label}</p>
                                <div className="mt-2 flex flex-col gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => stopLeadEnrichment(selectedLead.id)}
                                    disabled={isStoppingSelected}
                                    className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Ban className="h-3.5 w-3.5" aria-hidden />
                                    {isStoppingSelected ? 'Stopping…' : 'Stop enrichment'}
                                  </button>
                                  {stopEnrichmentError && (
                                    <p className="text-xs text-red-500">{stopEnrichmentError}</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {showEnrichmentDoneCopy && enrichmentFinishedDisplayIso ? (
                              <div className="rounded-xl bg-[#E6F4F1] px-4 py-3">
                                <div className="flex gap-2.5">
                                  <Check
                                    className="mt-0.5 h-4 w-4 shrink-0 text-[#2D8A8A]"
                                    strokeWidth={2.25}
                                    aria-hidden
                                  />
                                  <div className="min-w-0 space-y-1">
                                    <p className="text-xs font-semibold text-[#2D8A8A]">Enrichment done</p>
                                    <p className="text-xs leading-snug text-[#6B7280]">
                                      Finished {formatLastUpdated(enrichmentFinishedDisplayIso)}.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {selectedLeadRefreshStatus === 'cancelled' &&
                              selectedLead.enrichment_refresh_finished_at && (
                                <p className="text-xs leading-snug text-[#6B7280]">
                                  Stopped {formatLastUpdated(selectedLead.enrichment_refresh_finished_at)}.
                                </p>
                              )}

                            {selectedLeadRefreshStatus === 'failed' && (
                              <>
                                <p className="text-xs font-semibold text-[rgb(13,53,71)]">
                                  {selectedLeadRefreshStatusMeta.label}
                                </p>
                                <p className="text-xs leading-snug text-[#7d909a]">Showing last known data.</p>
                              </>
                            )}

                            {selectedLeadRefreshStatus !== 'running' && (
                              <p className="text-xs leading-relaxed text-[#6B7280]">
                                You can refresh this enrichment again whenever you need updated data.
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => rerunEnrichment(selectedLead.id)}
                              disabled={
                                selectedLead.hubspot_lead_state === 'customer' ||
                                isRefreshingSelected ||
                                isStoppingSelected ||
                                isEditingSelected ||
                                isSelectedLeadRefreshRunning
                              }
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <RotateCw
                                className={`h-4 w-4 text-[#1F2937] ${isRefreshingSelected || isSelectedLeadRefreshRunning ? 'animate-spin' : ''}`}
                              />
                              {isRefreshingSelected
                                ? 'Starting enrichment…'
                                : isSelectedLeadRefreshRunning
                                  ? 'Enrichment running…'
                                  : selectedLead.hubspot_lead_state === 'customer'
                                    ? 'Customer in HubSpot'
                                    : 'Refresh enrichment'}
                            </button>
                            {selectedLead.hubspot_lead_state === 'customer' ? (
                              <p className="text-xs leading-snug text-[#7d909a]">
                                Closed-won contacts should move through customer workflows instead of paid lead enrichment.
                              </p>
                            ) : null}
                          </div>
                        )}

                        {selectedPreview === 'contact' && (
                          isEditingSelected ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => saveLead(selectedLead.id)}
                                disabled={isSavingSelected}
                                className="flex-1 rounded-lg border border-arcova-teal bg-arcova-teal text-white px-4 py-2 text-sm font-medium hover:bg-arcova-teal/90 disabled:opacity-50 transition-colors"
                              >
                                {isSavingSelected ? 'Saving…' : 'Save changes'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEditingLead}
                                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEditingLead(selectedLead)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Edit contact
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteLead(selectedLead.id)}
                                disabled={isDeletingSelected}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {isDeletingSelected ? 'Archiving…' : 'Archive contact'}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ) : null}
                    </aside>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <AgentPanel
          className={cn(
            'contacts-leads-agent-col min-[1280px]:pl-1.5',
            // While reviewing a contact the agent is hidden by default (the floating
            // chat bar + full-height drawer take over). `invisible` keeps the column
            // in layout so agentRect keeps tracking its footprint.
            selectedLeadId && !agentDocked && 'invisible',
            // Docked: the agent shrinks to the TOP HALF and the drawer drops to the
            // bottom half (50/50 split). self-start stops the grid stretching it.
            selectedLeadId && agentDocked && 'z-[41] self-start max-h-[calc(50vh-1.25rem)] overflow-hidden',
          )}
          // Reserve the full expanded column width while a contact is selected even
          // though the leads page opens with the agent collapsed. Without this the
          // collapsed column is 0-wide, agentRect nulls out, and the drawer falls
          // back to a skinny fixed overlay in front of the table. Forcing the
          // expanded layout makes the table reflow (push) and the drawer mirror the
          // real, wider column — matching the "open agent, then click a row" path.
          forceExpandedLayout={!!selectedLeadId}
          page="leads"
          pageContext={{
            leadsView: 'contacts',
            ...(selectedLead ? {
              selectedLead: {
                id: selectedLead.id,
                first_name: selectedLead.first_name,
                last_name: selectedLead.last_name,
                job_title: selectedLead.job_title,
                seniority_level: selectedLead.seniority_level,
                business_area: selectedLead.business_area,
                fit_score: selectedLead.fit_score ?? selectedLead.overall_fit_score,
                company_name: selectedLead.company_name ?? selectedLead.companies?.company_name,
                company_domain: selectedLead.company_domain ?? selectedLead.companies?.domain,
                company_id: selectedLead.company_id,
                matched_icp_id: selectedLead.companies?.matched_icp_id,
              },
            } : {}),
          }}
          pendingMessage={agentTrigger}
          onLeadsFilter={handleLeadsFilter}
          onTableClear={handleQueryClear}
        />
      </div>
    </div>
  );
}

export default function ContactsPage() {
  return <ContactsWorkspace />;
}
