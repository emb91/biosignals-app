'use client';

/**
 * SetupFlow: a single conversational journey that covers all three setup steps:
 *   1. Greeting + company analysis       (Claude API)
 *   2. Target company ICP definition     (scripted narration + inline widgets)
 *   3. Target persona definition         (scripted narration + inline widgets)
 *
 * Claude API calls fire only at section boundaries (greeting, post-analysis,
 * company→persona transition, and wrap-up). Everything in between is
 * instant scripted narration + chip-select widgets.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { parseSSEStream } from '@/lib/sse';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import { AppAmbientBackground } from '@/components/AppAmbientBackground';
import SetupProfilePanel, {
  AddTagSelect,
  type PanelCompanyData,
  type PanelPersonaData,
} from '@/components/SetupProfilePanel';
import { useEnrichmentGuard } from '@/context/EnrichmentGuardContext';
import {
  BUSINESS_AREA_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  MODALITY_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  INDUSTRY_OPTIONS,
  employeeCountToSizeBucket,
  followerCountToFollowerBucket,
  canonicalizeFundingStage,
  normalizeIndustrySelectValue,
  selectOptionsWithCurrentValue,
} from '@/lib/arcova-taxonomy';
import type { TargetCompanyEnrichmentResult } from '@/lib/target-company-enrichment';
import type { IcpSuggestion } from '@/app/api/suggest-icp-companies/route';
import { normalizeOrderedSignalIds } from '@/lib/signals/normalize-client';
import { resolveCustomerSegments } from '@/lib/split-customer-segments';
import { fetchLatestUserCompanyRow } from '@/lib/fetch-latest-user-company';
import { ArcovaWelcomeOrb } from '@/components/ArcovaWelcomeOrb';
import { ROUTES } from '@/lib/routes';
import { PLATFORM_CATEGORY_OPTIONS } from '@/lib/platform-category';
import { Send, Sparkles, ChevronDown, ExternalLink, Check, Building2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Quick picks on step 2: model accounts from /api/suggest-icp-companies (domains, one-click analyse). */

/** Funding, headcount + customer-segment context for buying-team inference */
function icContextForBuyingTeam(
  icp: PanelCompanyData,
  exampleEnrichment: TargetCompanyEnrichmentResult | null | undefined,
): {
  icp_funding_stages: string[];
  icp_example_employee_count: number | null;
  icp_example_employee_range: string | null;
  icp_example_total_funding_usd: number | null;
  icp_target_customers: string[];
  icp_buyer_types: string[];
  icp_customer_therapeutic_areas: string[];
  icp_customer_modalities: string[];
  icp_customer_development_stages: string[];
} {
  const fallback = (own: string[], key: keyof TargetCompanyEnrichmentResult): string[] => {
    if (own.length > 0) return own;
    const v = exampleEnrichment?.[key];
    return Array.isArray(v) ? (v as string[]) : [];
  };
  return {
    icp_funding_stages: icp.fundingStages ?? [],
    icp_example_employee_count:
      typeof exampleEnrichment?.employee_count === 'number' ? exampleEnrichment.employee_count : null,
    icp_example_employee_range:
      typeof exampleEnrichment?.employee_range === 'string' ? exampleEnrichment.employee_range : null,
    icp_example_total_funding_usd:
      typeof exampleEnrichment?.total_funding_usd === 'number' ? exampleEnrichment.total_funding_usd : null,
    icp_target_customers: icp.targetCustomers ?? [],
    icp_buyer_types: icp.buyerTypes ?? [],
    icp_customer_therapeutic_areas: fallback(icp.customerTherapeuticAreas ?? [], 'customer_therapeutic_areas'),
    icp_customer_modalities: fallback(icp.customerModalities ?? [], 'customer_modalities'),
    icp_customer_development_stages: fallback(icp.customerDevelopmentStages ?? [], 'customer_development_stages'),
  };
}

// ── Option lists ───────────────────────────────────────────────────────────

const DEV_STAGE_OPTIONS = ['Preclinical', 'Phase I', 'Phase II', 'Phase III', 'Commercial'];
const COMPANY_TYPE_SELECTION_OPTIONS = COMPANY_TYPE_OPTIONS.map((option) => ({ ...option }));
const TA_OPTIONS = [...THERAPEUTIC_AREA_OPTIONS] as string[];
const MODALITY_SELECTION_OPTIONS = [...MODALITY_OPTIONS] as string[];
const SIZE_OPTIONS = [...COMPANY_SIZE_OPTIONS] as string[];
const FUNDING_OPTIONS = [...FUNDING_STAGE_OPTIONS] as string[];
const FUNCTION_OPTIONS = [...BUSINESS_AREA_OPTIONS] as string[];
const SENIORITY_OPTIONS = [...SENIORITY_LEVEL_OPTIONS] as string[];

// ── ICP suggestion persistence ────────────────────────────────────────────

const SUGGESTIONS_STORAGE_KEY = 'arcova_icp_suggestions';
const ENROLLED_SUGGESTIONS_KEY = 'arcova_enrolled_suggestion_domains';

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'live.co.uk', 'hotmail.co.uk',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'mail.com', 'inbox.com', 'gmx.com', 'gmx.net',
  'yandex.com', 'yandex.ru',
  'tutanota.com', 'tuta.io',
]);

function normalizeDomain(url: string | null | undefined): string {
  if (!url) return '';
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '').toLowerCase().trim();
}

function loadStoredSuggestions(): IcpSuggestion[] {
  try { return JSON.parse(localStorage.getItem(SUGGESTIONS_STORAGE_KEY) ?? '[]') as IcpSuggestion[]; }
  catch { return []; }
}

function saveStoredSuggestions(suggestions: IcpSuggestion[]): void {
  try { localStorage.setItem(SUGGESTIONS_STORAGE_KEY, JSON.stringify(suggestions)); } catch {}
}

function loadEnrolledDomains(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ENROLLED_SUGGESTIONS_KEY) ?? '[]') as string[]); }
  catch { return new Set(); }
}

function markDomainEnrolled(domain: string): void {
  const enrolled = loadEnrolledDomains();
  enrolled.add(normalizeDomain(domain));
  try { localStorage.setItem(ENROLLED_SUGGESTIONS_KEY, JSON.stringify([...enrolled])); } catch {}
}

function unenrolledSuggestions(): IcpSuggestion[] {
  const stored = loadStoredSuggestions();
  const enrolled = loadEnrolledDomains();
  return stored
    .filter(
      (s): s is IcpSuggestion =>
        s != null
        && typeof s.name === 'string'
        && s.name.trim().length > 0
        && typeof s.domain === 'string'
        && normalizeDomain(s.domain).length > 0,
    )
    .filter((s) => !enrolled.has(normalizeDomain(s.domain)));
}

function clearStoredIcpSuggestionState(): void {
  try {
    localStorage.removeItem(SUGGESTIONS_STORAGE_KEY);
    localStorage.removeItem(ENROLLED_SUGGESTIONS_KEY);
  } catch {
    /* ignore */
  }
}

const START_AGAIN_CONFIRM =
  'This removes your saved company profile, target company profiles, and buying team for this account. Continue?';

// ── Phase type ─────────────────────────────────────────────────────────────

type Phase =
  | 'greeting'
  | 'analysis_loading'
  | 'analysis_results'
  | 'icp_suggestion'
  /** Same onboarding prompt as customer_url_input, but glass chat + composer instead of the URL splash form. */
  | 'customer_url_conversation'
  | 'customer_url_input'
  | 'customer_url_loading'
  | 'customer_url_review'
  | 'company_select'
  | 'company_type'
  | 'company_size'
  | 'company_ta'
  | 'company_modality'
  | 'company_stage'
  | 'company_funding'
  | 'company_saving'
  | 'buying_team_loading'
  | 'buying_team_review'
  | 'persona_functions'
  | 'persona_seniority'
  | 'persona_saving'
  | 'done';

/** UI-only phases that reuse another step's onboarding system prompt / tools. */
function mapPhaseForOnboardingApi(phase: Phase): string {
  if (phase === 'customer_url_conversation') return 'customer_url_input';
  if (phase === 'icp_suggestion') return 'customer_url_input';
  return phase;
}

// ── Scripted narration per field ───────────────────────────────────────────

const NARRATION: Partial<Record<Phase, string>> = {
  company_select: 'Pick the company profile you want next. Then we map the full buying group for it.',
  company_type: 'Define a target company profile. Which type best matches the accounts you sell to?',
  company_size: 'Typical company size. You can pick more than one.',
  company_ta: 'Therapeutic areas that fit this profile. Pick all that apply.',
  company_modality: 'Modalities. Pick all that apply.',
  company_stage: 'Where are these companies in development? Pick all that apply.',
  company_funding: 'How are they usually funded? Pick all that apply.',
  persona_functions: 'Define the full buying group for this profile: which teams are involved in the buying decision? Pick all that apply.',
  persona_seniority: 'Seniority levels across that buying group. Pick all that apply.',
};

/** Tolerant split if the model adds spaces or different casing around the delimiter. */
const ASSISTANT_BEAT_RE = /\s*<<<\s*msg\s*>>>\s*/gi;

function splitAssistantBeats(raw: string): string[] {
  return raw
    .split(ASSISTANT_BEAT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Display message types ──────────────────────────────────────────────────

type TextMsg = { id: string; kind: 'text'; role: 'assistant' | 'user'; text: string; typing?: boolean };
type ResultsMsg = { id: string; kind: 'results'; data: Record<string, unknown> };
type DisplayMsg = TextMsg | ResultsMsg;

// ── ApiMessage for Claude calls ────────────────────────────────────────────

type ApiMsg =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: Array<{ type: 'text'; text: string }> };

type OnboardingAction =
  | { type: 'capture_name'; first_name: string }
  | { type: 'begin_analysis'; website_url: string; analysis_type?: 'own_company' | 'target_customer' }
  | { type: 'confirm_transition'; target: 'proceed_to_customer_url' | 'confirm_own_company' | 'restart'; button_label: string };

type ApiOnboardingJson = {
  text?: string;
  actions?: OnboardingAction[];
  /** Server-authored bubbles (preferred over delimiter split). */
  segments?: string[];
};

type OnboardingResponse = {
  text: string;
  actions: OnboardingAction[];
  /** One UI bubble per string. */
  displayParts: string[];
};

type AskClaudeOptions = {
  extra?: ApiMsg;
  /** Matches /api/onboarding-chat: tools only in conversation mode. */
  mode?: 'conversation' | 'narration' | 'phase_help';
  phase?: Phase;
  selectedCompanyName?: string | null;
  availableCompanyCount?: number;
};

const FINDINGS_SECTION_CONFIG = [
  { key: 'description', label: 'Here is what I found about you' },
  { key: 'customers_we_serve', label: 'The customers you serve are' },
  { key: 'good_fit', label: 'You work best with' },
  { key: 'bad_fit', label: 'Companies that are not a good fit are' },
] as const;

type EntryPoint = 'full' | 'target-company' | 'company-only';

interface TargetCompanyProfile {
  id: string;
  name: string;
  company_type: string;
  platform_category?: string | null;
  therapeutic_areas?: string[];
  modalities?: string[];
  development_stages?: string[];
  company_sizes?: string[];
  funding_stages?: string[];
  target_customers?: string[] | null;
  buyer_types?: string[] | null;
  competitors?: { name: string; url?: string }[] | null;
  example_company_enrichment?: {
    company_name?: string | null;
  } | null;
}

// ── Typing speed ───────────────────────────────────────────────────────────

const TYPING_MS = 18;

/** Narration when entering the target-account step: clear purpose, low verbosity, point to suggestion picks. */
const SETUP_NARRATION_TARGET_ACCOUNTS_STEP =
  '[System: The user\'s own company profile is already saved. Write 3-5 short sentences total, plain language, no em dashes, no long product pitch. ' +
  '(1) Say clearly what we are doing next: we are defining ideal target accounts, meaning concrete companies they want as customers, so we can profile the right fit. ' +
  '(2) Ask who counts as a best customer or dream account for them, company name or URL. ' +
  '(3) If they are not sure, say we put suggestions below based on their company and they can pick one of those options or keep typing. ' +
  'One idea per sentence. Stay concise.]';

/** Shared enrichment UI: mid-pass (firm details landed, widening context before next SSE). */
const ENRICH_GENERIC_LOOKUP_LINES = [
  'Key signals in ✓ Widening search for a fuller company picture…',
  'Still gathering ✓ Matching names and domains to public firm data…',
  'Almost there ✓ This stretch is usually quick, sometimes needs a beat…',
  'Working the match ✓ Trade names and legal names often differ…',
  'Still collecting ✓ Layering another pass of context…',
  'Narrowing it down ✓ Sticking to broadly visible information…',
] as const;

/** Shared: slower deep-gather phase (generic, no vendor or channel detail). */
const ENRICH_GENERIC_DEEP_GATHER_LINES = [
  'Solid lead ✓ Pulling richer firm context (can take half a minute)…',
  'Still collecting ✓ Heavier lookups sometimes need patience…',
  'Almost there ✓ Sorting location, footprint, and positioning clues…',
  'Hang tight ✓ Bigger footprints usually mean more to reconcile…',
] as const;

/** Shared: condensed profile after sources land. */
const ENRICH_GENERIC_SYNTHESIS_LINES = [
  'Merging findings into one clear snapshot…',
  'Tightening lists so this profile stays easy to scan…',
  'Fitting details into your setup structure…',
] as const;

const TARGET_ICP_LINKEDIN_LOOKUP_LINES = ENRICH_GENERIC_LOOKUP_LINES;
const TARGET_ICP_LINKEDIN_SCRAPE_LINES = ENRICH_GENERIC_DEEP_GATHER_LINES;
const TARGET_ICP_SYNTHESIS_LINES = ENRICH_GENERIC_SYNTHESIS_LINES;

/** Full-area backdrop behind the chat column (setup flows only). Dark navy base, teal as accent. */
const SETUP_CHAT_SURROUND =
  'bg-gradient-to-b from-slate-950 to-arcova-darkblue';

/** Card panel floating over the dark surround. */
const SETUP_CHAT_CARD =
  'flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-[0_28px_70px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-[2px]';

/** Back control on glass / light shells, placed above the rounded chat card (early setup phases). */
const SETUP_GLASS_BACK_ABOVE_CARD_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border border-arcova-navy/10 bg-white/65 px-3 py-1.5 text-[12px] font-medium text-arcova-navy/65 backdrop-blur transition-all hover:-translate-x-0.5 hover:bg-white hover:text-arcova-navy disabled:opacity-50';

function isSaasCompanyType(value?: string | null): boolean {
  return (value ?? '').trim() === 'SaaS';
}

function visiblePlatformCategory(companyType?: string | null, platformCategory?: string | null): string {
  return isSaasCompanyType(companyType) ? (platformCategory ?? '').trim() : '';
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

// ── Persistent "Step X of 3" eyebrow shown across every setup phase ─────────
function StepEyebrow({ step }: { step: 0 | 1 | 2 }) {
  const labels = ['Your company', 'Target companies', 'Buying teams'] as const;
  return (
    <div className="inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/50">
      <span className="inline-flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-[3px] rounded-full transition-all ${
              i < step
                ? 'w-3.5 bg-arcova-teal/55'
                : i === step
                  ? 'w-5 bg-arcova-teal'
                  : 'w-3.5 bg-arcova-teal/15'
            }`}
          />
        ))}
      </span>
      <span>
        Step {step + 1} of 3
        <span className="ml-2 normal-case tracking-normal text-arcova-navy/45">· {labels[step]}</span>
      </span>
    </div>
  );
}

// ── Setup "My company" card (light glass, matches Setup.html design) ────────
function SetupSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border border-arcova-navy/8 bg-white/40 transition-colors hover:bg-white/55">
      <header
        className="flex cursor-pointer items-center justify-between px-3.5 py-2.5"
        onClick={() => setOpen((o) => !o)}
      >
        <h3 className="m-0 font-manrope text-[12.5px] font-semibold tracking-[-0.01em] text-arcova-navy">
          {label}
        </h3>
        <ChevronDown
          className={`h-3 w-3 text-arcova-navy/50 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </header>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-arcova-navy/8 px-3.5 pb-3 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}

function SetupTag({ children, link }: { children: ReactNode; link?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-arcova-teal/20 bg-arcova-teal/10 px-2.5 py-1 text-[11.5px] font-medium text-arcova-teal ${
        link ? 'cursor-pointer hover:bg-arcova-teal/18' : ''
      }`}
    >
      {children}
      {link && <ExternalLink className="h-2.5 w-2.5 opacity-70" />}
    </span>
  );
}

function SetupTagRow({ items, link }: { items: string[]; link?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t, i) => (
        <SetupTag key={`${t}-${i}`} link={link}>
          {t}
        </SetupTag>
      ))}
    </div>
  );
}

function SetupSubLabel({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/40">
      {children}
    </p>
  );
}

function SetupKV({ rows }: { rows: Array<[string, ReactNode]> }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-arcova-navy/40">
            {k}
          </div>
          <div className="text-[13px] font-medium text-arcova-navy">{v}</div>
        </div>
      ))}
    </div>
  );
}

function SetupBullets({ items }: { items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {items.map((t, i) => (
        <li
          key={i}
          className="relative pl-3.5 text-[12.5px] leading-[1.5] text-arcova-navy/75 before:absolute before:left-1 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-arcova-teal/70 before:content-['']"
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

const SETUP_SELECT =
  'w-full cursor-pointer rounded-lg border border-arcova-navy/15 bg-white/85 px-3 py-2 text-[12.5px] text-arcova-navy outline-none transition-colors focus:border-arcova-teal/45 focus:bg-white focus:ring-2 focus:ring-arcova-teal/15';

function multilineDraftToList(raw: string): string[] {
  const lines = raw.split('\n').map((line) => line.trim());
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.filter(Boolean);
}

function SetupTaxonomyTag({
  label,
  editMode,
  onRemove,
}: {
  label: string;
  editMode: boolean;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-arcova-teal/20 bg-arcova-teal/10 px-2.5 py-1 text-[11.5px] font-medium text-arcova-teal">
      {label}
      {editMode && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-arcova-teal/50 transition-colors hover:text-arcova-teal"
          aria-label={`Remove ${label}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function formatSetupFunding(stage?: string, total?: number): string | undefined {
  if (!stage && total == null) return undefined;
  const fmtUsd = (usd: number) => {
    if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
    if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
    if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
    return `$${usd}`;
  };
  if (stage && total != null) return `${stage} · ${fmtUsd(total)}`;
  if (stage) return stage;
  return total != null ? fmtUsd(total) : undefined;
}

function SetupEditableText({
  value,
  multiline,
  onChange,
  placeholder,
}: {
  value: string;
  multiline?: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const common =
    'w-full rounded-lg border border-arcova-navy/15 bg-white/85 px-3 py-2 text-[12.5px] text-arcova-navy outline-none transition-colors placeholder:text-arcova-navy/35 focus:border-arcova-teal/45 focus:bg-white focus:ring-2 focus:ring-arcova-teal/15';
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={`${common} resize-y leading-[1.5]`}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={common}
    />
  );
}

/** About text: paragraphs separated by a blank line. Preserves spaces and single newlines inside a paragraph. */
function paragraphsToAboutDraft(paragraphs: string[] | undefined): string {
  return (paragraphs ?? []).join('\n\n');
}

function aboutDraftToParagraphs(raw: string): string[] {
  return raw.split(/\n\s*\n/).filter((chunk) => chunk.length > 0);
}

function SetupAboutDescriptionEditor({
  paragraphs,
  onCommit,
}: {
  paragraphs: string[] | undefined;
  onCommit: (next: string[]) => void;
}) {
  const serialized = JSON.stringify(paragraphs ?? []);
  const [draft, setDraft] = useState(() => paragraphsToAboutDraft(paragraphs));
  const prevSerialized = useRef(serialized);

  useEffect(() => {
    if (serialized !== prevSerialized.current) {
      prevSerialized.current = serialized;
      setDraft(paragraphsToAboutDraft(paragraphs));
    }
  }, [serialized, paragraphs]);

  const cls =
    'w-full resize-y rounded-lg border border-arcova-navy/15 bg-white/85 px-3 py-2 text-[12.5px] leading-[1.5] text-arcova-navy outline-none transition-colors placeholder:text-arcova-navy/35 focus:border-arcova-teal/45 focus:bg-white focus:ring-2 focus:ring-arcova-teal/15';

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => onCommit(aboutDraftToParagraphs(e.currentTarget.value))}
      placeholder="Describe what the company does. Use a blank line between paragraphs."
      rows={6}
      spellCheck
      className={cls}
    />
  );
}

/** Lets users type digits and spaces freely; commits parsed integer on blur. */
function SetupPositiveIntDraftField({
  value,
  onCommit,
  placeholder,
}: {
  value?: number;
  onCommit: (next: number | undefined) => void;
  placeholder?: string;
}) {
  const common =
    'w-full rounded-lg border border-arcova-navy/15 bg-white/85 px-3 py-2 text-[12.5px] text-arcova-navy outline-none transition-colors placeholder:text-arcova-navy/35 focus:border-arcova-teal/45 focus:bg-white focus:ring-2 focus:ring-arcova-teal/15';
  const [draft, setDraft] = useState(() => (value != null ? String(value) : ''));
  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim();
        if (!t) {
          onCommit(undefined);
          return;
        }
        const digits = t.replace(/[^\d]/g, '');
        if (!digits) {
          onCommit(undefined);
          return;
        }
        const n = Number(digits);
        onCommit(Number.isFinite(n) && n > 0 ? n : undefined);
      }}
      placeholder={placeholder}
      className={common}
    />
  );
}

function SetupEditableList({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const serialized = JSON.stringify(items);
  const [draft, setDraft] = useState(() => items.join('\n'));
  const prevSerialized = useRef(serialized);

  useEffect(() => {
    if (serialized !== prevSerialized.current) {
      prevSerialized.current = serialized;
      setDraft(items.join('\n'));
    }
  }, [serialized, items]);

  return (
    <textarea
      value={draft}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        onChange(multilineDraftToList(raw));
      }}
      placeholder={placeholder ?? 'One per line'}
      rows={Math.max(3, Math.min(16, items.length + 2))}
      spellCheck={false}
      className="w-full resize-y rounded-lg border border-arcova-navy/15 bg-white/85 px-3 py-2 text-[12.5px] leading-[1.5] text-arcova-navy outline-none transition-colors placeholder:text-arcova-navy/35 focus:border-arcova-teal/45 focus:bg-white focus:ring-2 focus:ring-arcova-teal/15"
    />
  );
}

function SetupMyCompanyCard({
  data,
  editMode = false,
  onChange,
}: {
  data: import('@/components/SetupProfilePanel').PanelMyCompanyData;
  editMode?: boolean;
  onChange?: (
    field: keyof import('@/components/SetupProfilePanel').PanelMyCompanyData,
    value: import('@/components/SetupProfilePanel').MyCompanyChangeValue,
  ) => void;
}) {
  const set = <K extends keyof import('@/components/SetupProfilePanel').PanelMyCompanyData>(
    field: K,
    value: import('@/components/SetupProfilePanel').MyCompanyChangeValue,
  ) => onChange?.(field, value);
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');
  const domain = (data.website ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const fundingLine = formatSetupFunding(data.fundingStage, data.totalFundingUsd);
  const platformCategoryDisplay = visiblePlatformCategory(data.companyType, data.platformCategory);
  const rawIndustry = (data.industry ?? '').trim();
  const industrySelectValue = normalizeIndustrySelectValue(rawIndustry) || rawIndustry;
  const industryOptions = selectOptionsWithCurrentValue(INDUSTRY_OPTIONS, industrySelectValue);
  const platformOptions = selectOptionsWithCurrentValue(PLATFORM_CATEGORY_OPTIONS, data.platformCategory);
  const industryDisplay = normalizeIndustrySelectValue(data.industry ?? '') || data.industry;

  const commitNewCompetitor = () => {
    const raw = newCompetitorUrl.trim();
    if (!raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let name = raw;
    try {
      name = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      /* keep typed text as display name */
    }
    set('competitorsEnriched', [...(data.competitorsEnriched ?? []), { name, url }]);
    setNewCompetitorUrl('');
  };
  return (
    <article
      data-my-company-card
      className="overflow-hidden rounded-[20px] border border-arcova-navy/10 bg-white/65 shadow-[0_18px_40px_-28px_rgba(13,53,71,0.15)] backdrop-blur-xl"
    >
      {/* Card header */}
      <header className="grid grid-cols-[28px_1fr_22px_22px] items-center gap-2.5 border-b border-arcova-navy/8 px-4 py-3.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-arcova-teal/12 text-arcova-teal">
          <Building2 className="h-3.5 w-3.5" />
        </span>
        <span className="font-manrope text-[14.5px] font-semibold tracking-[-0.014em] text-arcova-navy">
          My company
        </span>
        <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-arcova-teal text-white">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <ChevronDown className="h-3.5 w-3.5 rotate-180 text-arcova-navy/65" />
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {/* Identity strip */}
        <div className="grid grid-cols-[40px_1fr] items-center gap-3 rounded-xl border border-arcova-navy/8 bg-white/55 px-3 py-2.5">
          <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-arcova-teal to-[#007e8b] font-bold text-white">
            {data.logoUrl ? (
              <Image
                src={data.logoUrl}
                alt={data.companyName ?? 'Company'}
                width={40}
                height={40}
                className="h-10 w-10 object-cover"
              />
            ) : (
              <span className="text-base">{(data.companyName?.[0] ?? 'A').toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-arcova-navy">{data.companyName ?? '—'}</div>
            {domain && (
              <a
                href={data.website && /^https?:\/\//i.test(data.website) ? data.website : `https://${domain}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11.5px] text-arcova-teal hover:underline"
              >
                {domain}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {data.tagline && (
              <div className="mt-0.5 text-[11.5px] italic text-arcova-navy/50">{data.tagline}</div>
            )}
          </div>
        </div>

        {/* About */}
        <SetupSection label="About" defaultOpen>
          {editMode ? (
            <SetupAboutDescriptionEditor
              paragraphs={data.description}
              onCommit={(next) => set('description', next)}
            />
          ) : (
            data.description && data.description.length > 0 && (
              <p className="m-0 text-[12.5px] leading-[1.5] text-arcova-navy">
                {(data.description ?? [])
                  .map((s) => s.trim().replace(/\s+/g, ' '))
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )
          )}
          <div>
            <SetupSubLabel>Company type</SetupSubLabel>
            <div className="mt-1.5">
              {editMode ? (
                <select
                  value={data.companyType ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    set('companyType', v);
                    set('companyTypeDisplay', undefined);
                    if (!isSaasCompanyType(v)) set('platformCategory', undefined);
                  }}
                  className={SETUP_SELECT}
                >
                  <option value="">Select type…</option>
                  {COMPANY_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </select>
              ) : (
                (data.companyTypeDisplay || data.companyType) && (
                  <SetupTagRow items={[String(data.companyTypeDisplay ?? data.companyType)]} />
                )
              )}
            </div>
          </div>
          {isSaasCompanyType(data.companyType) && (editMode || !!platformCategoryDisplay) && (
            <div>
              <SetupSubLabel>Platform category</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <select
                    value={data.platformCategory ?? ''}
                    onChange={(e) => set('platformCategory', e.target.value || undefined)}
                    className={SETUP_SELECT}
                  >
                    <option value="">Select platform…</option>
                    {platformOptions.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  platformCategoryDisplay && <SetupTagRow items={[platformCategoryDisplay]} />
                )}
              </div>
            </div>
          )}
          {((data.therapeuticAreas?.length ?? 0) > 0 || editMode) && (
            <div>
              <SetupSubLabel>Therapeutic areas</SetupSubLabel>
              {(data.therapeuticAreas?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(data.therapeuticAreas ?? []).map((t) => (
                    <SetupTaxonomyTag
                      key={t}
                      label={t}
                      editMode={editMode}
                      onRemove={
                        editMode
                          ? () =>
                              set(
                                'therapeuticAreas',
                                (data.therapeuticAreas ?? []).filter((x) => x !== t),
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
              {editMode && (
                <div className="mt-1.5">
                  <AddTagSelect
                    light
                    options={TA_OPTIONS}
                    selected={data.therapeuticAreas ?? []}
                    onAdd={(v) =>
                      set('therapeuticAreas', [...(data.therapeuticAreas ?? []), v])
                    }
                    placeholder="Add therapeutic area…"
                  />
                </div>
              )}
            </div>
          )}
          {((data.modalities?.length ?? 0) > 0 || editMode) && (
            <div>
              <SetupSubLabel>Modalities</SetupSubLabel>
              {(data.modalities?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(data.modalities ?? []).map((m) => (
                    <SetupTaxonomyTag
                      key={m}
                      label={m}
                      editMode={editMode}
                      onRemove={
                        editMode
                          ? () =>
                              set('modalities', (data.modalities ?? []).filter((x) => x !== m))
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
              {editMode && (
                <div className="mt-1.5">
                  <AddTagSelect
                    light
                    options={MODALITY_SELECTION_OPTIONS}
                    selected={data.modalities ?? []}
                    onAdd={(v) => set('modalities', [...(data.modalities ?? []), v])}
                    placeholder="Add modality…"
                  />
                </div>
              )}
            </div>
          )}
          {((data.developmentStages?.length ?? 0) > 0 || editMode) && (
            <div>
              <SetupSubLabel>Development stages</SetupSubLabel>
              {(data.developmentStages?.length ?? 0) > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(data.developmentStages ?? []).map((s) => (
                    <SetupTaxonomyTag
                      key={s}
                      label={s}
                      editMode={editMode}
                      onRemove={
                        editMode
                          ? () =>
                              set(
                                'developmentStages',
                                (data.developmentStages ?? []).filter((x) => x !== s),
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
              {editMode && (
                <div className="mt-1.5">
                  <AddTagSelect
                    light
                    options={[...DEVELOPMENT_STAGE_OPTIONS] as string[]}
                    selected={data.developmentStages ?? []}
                    onAdd={(v) =>
                      set('developmentStages', [...(data.developmentStages ?? []), v])
                    }
                    placeholder="Add development stage…"
                  />
                </div>
              )}
            </div>
          )}
        </SetupSection>

        {/* Firmographics */}
        <SetupSection label="Firmographics">
          {editMode ? (
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              <div>
                <SetupSubLabel>Industry</SetupSubLabel>
                <div className="mt-1.5">
                  <select
                    value={industrySelectValue}
                    onChange={(e) => set('industry', e.target.value || undefined)}
                    className={SETUP_SELECT}
                  >
                    <option value="">Select industry…</option>
                    {industryOptions.map((o) => (
                      <option key={`ind-opt-${o}`} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <SetupSubLabel>City</SetupSubLabel>
                <div className="mt-1.5">
                  <SetupEditableText value={data.hqCity ?? ''} onChange={(v) => set('hqCity', v)} />
                </div>
              </div>
              <div>
                <SetupSubLabel>Country</SetupSubLabel>
                <div className="mt-1.5">
                  <SetupEditableText value={data.hqCountry ?? ''} onChange={(v) => set('hqCountry', v)} />
                </div>
              </div>
              <div>
                <SetupSubLabel>Founded</SetupSubLabel>
                <div className="mt-1.5">
                  <SetupPositiveIntDraftField
                    value={data.foundedYear}
                    onCommit={(v) => set('foundedYear', v)}
                    placeholder="Year"
                  />
                </div>
              </div>
              <div>
                <SetupSubLabel>Headcount</SetupSubLabel>
                <div className="mt-1.5">
                  <SetupPositiveIntDraftField
                    value={data.employeeCount}
                    onCommit={(v) => set('employeeCount', v)}
                    placeholder="Approx. employees"
                  />
                </div>
              </div>
              <div>
                <SetupSubLabel>Funding stage</SetupSubLabel>
                <div className="mt-1.5">
                  <SetupEditableText value={data.fundingStage ?? ''} onChange={(v) => set('fundingStage', v)} />
                </div>
              </div>
            </div>
          ) : (
            <SetupKV
              rows={[
                industryDisplay ? (['Industry', industryDisplay] as [string, ReactNode]) : null,
                data.hqCity || data.hqCountry
                  ? ([
                      'Headquarters',
                      [data.hqCity, data.hqCountry].filter(Boolean).join(', '),
                    ] as [string, ReactNode])
                  : null,
                data.foundedYear != null
                  ? (['Founded', String(data.foundedYear)] as [string, ReactNode])
                  : null,
                data.employeeCount != null
                  ? (['Headcount', String(data.employeeCount)] as [string, ReactNode])
                  : data.employeeRange
                    ? (['Headcount', data.employeeRange] as [string, ReactNode])
                    : null,
                fundingLine ? (['Funding', fundingLine] as [string, ReactNode]) : null,
                data.companyStatus
                  ? (['Stage', data.companyStatus] as [string, ReactNode])
                  : null,
              ].filter(Boolean) as Array<[string, ReactNode]>}
            />
          )}
        </SetupSection>

        {/* Customers */}
        {(editMode ||
          (data.customersWeServe && data.customersWeServe.length > 0) ||
          (data.goodFit && data.goodFit.length > 0) ||
          (data.badFit && data.badFit.length > 0)) && (
          <SetupSection label="Customers">
            <div>
              <SetupSubLabel>Customer segments</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <SetupEditableList
                    items={data.customersWeServe ?? []}
                    onChange={(v) => set('customersWeServe', v)}
                  />
                ) : (
                  data.customersWeServe && data.customersWeServe.length > 0 && (
                    <SetupTagRow items={data.customersWeServe} />
                  )
                )}
              </div>
            </div>
            <div>
              <SetupSubLabel>Good fit</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <SetupEditableList items={data.goodFit ?? []} onChange={(v) => set('goodFit', v)} />
                ) : (
                  data.goodFit && data.goodFit.length > 0 && <SetupBullets items={data.goodFit} />
                )}
              </div>
            </div>
            <div>
              <SetupSubLabel>Not a fit</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <SetupEditableList items={data.badFit ?? []} onChange={(v) => set('badFit', v)} />
                ) : (
                  data.badFit && data.badFit.length > 0 && <SetupBullets items={data.badFit} />
                )}
              </div>
            </div>
          </SetupSection>
        )}

        {/* What you sell */}
        {(editMode ||
          (data.productsServices && data.productsServices.length > 0) ||
          (data.services && data.services.length > 0) ||
          (data.technologies && data.technologies.length > 0)) && (
          <SetupSection label="What you sell">
            <div>
              <SetupSubLabel>Products</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <SetupEditableList
                    items={data.productsServices ?? []}
                    onChange={(v) => set('productsServices', v)}
                  />
                ) : (
                  data.productsServices && data.productsServices.length > 0 && (
                    <SetupTagRow items={data.productsServices} />
                  )
                )}
              </div>
            </div>
            <div>
              <SetupSubLabel>Services</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <SetupEditableList items={data.services ?? []} onChange={(v) => set('services', v)} />
                ) : (
                  data.services && data.services.length > 0 && <SetupTagRow items={data.services} />
                )}
              </div>
            </div>
            <div>
              <SetupSubLabel>Technologies</SetupSubLabel>
              <div className="mt-1.5">
                {editMode ? (
                  <SetupEditableList items={data.technologies ?? []} onChange={(v) => set('technologies', v)} />
                ) : (
                  data.technologies && data.technologies.length > 0 && <SetupTagRow items={data.technologies} />
                )}
              </div>
            </div>
          </SetupSection>
        )}

        {/* Competitors */}
        {(editMode || (data.competitorsEnriched && data.competitorsEnriched.length > 0)) && (
          <SetupSection label="Competitors">
            <div className="space-y-2">
              {(data.competitorsEnriched ?? []).map((c, i) => (
                <div key={`${c.url ?? 'n'}-${c.name}-${i}`} className="flex items-center gap-2">
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-medium text-arcova-teal hover:underline"
                    >
                      <span className="truncate">{c.name}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <p className="flex-1 truncate text-[12.5px] font-medium text-arcova-navy/85">{c.name}</p>
                  )}
                  {editMode && (
                    <button
                      type="button"
                      onClick={() =>
                        set(
                          'competitorsEnriched',
                          (data.competitorsEnriched ?? []).filter((_, j) => j !== i),
                        )
                      }
                      className="shrink-0 rounded-md p-1 text-arcova-navy/45 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Remove ${c.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {editMode && (
                <div className={`space-y-1.5 ${(data.competitorsEnriched?.length ?? 0) > 0 ? 'border-t border-arcova-navy/10 pt-2.5' : ''}`}>
                  <SetupSubLabel>Add competitor (website)</SetupSubLabel>
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
                      placeholder="https://…"
                      className="min-w-[12rem] flex-1 rounded-lg border border-arcova-navy/15 bg-white/85 px-3 py-2 text-[12.5px] text-arcova-navy outline-none transition-colors placeholder:text-arcova-navy/35 focus:border-arcova-teal/45 focus:bg-white focus:ring-2 focus:ring-arcova-teal/15"
                    />
                    <button
                      type="button"
                      onClick={() => commitNewCompetitor()}
                      disabled={!newCompetitorUrl.trim()}
                      className="shrink-0 rounded-lg border border-arcova-navy/12 bg-white/90 px-3 py-2 text-[13px] font-medium text-arcova-navy shadow-sm transition-colors hover:border-arcova-teal/35 hover:bg-arcova-teal/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </SetupSection>
        )}

        {/* Value proposition */}
        {(editMode || (data.valuePropositions && data.valuePropositions.length > 0)) && (
          <SetupSection label="Value proposition">
            {editMode ? (
              <SetupEditableList
                items={data.valuePropositions ?? []}
                onChange={(v) => set('valuePropositions', v)}
              />
            ) : (
              data.valuePropositions && <SetupBullets items={data.valuePropositions} />
            )}
          </SetupSection>
        )}
      </div>
    </article>
  );
}

function AgentAvatar() {
  return (
    <Image src="/images/network-og.png" alt="Arcova" width={36} height={36} className="h-9 w-9 shrink-0 rounded-full ring-2 ring-white/15 object-cover" />
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-start gap-3">
      <ArcovaLoader size={36} />
      <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex gap-1 items-center h-4">
          {[0, 150, 300].map((d) => (
            <div key={d} className="w-1.5 h-1.5 bg-arcova-teal/70 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Assistant paragraphs for setup chat (matches Today / AgentPanel paragraph split on blank lines). */
function setupAssistantBubbles(text: string): string[] {
  const parts = text.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

/** Character ranges per paragraph (same split as `setupAssistantBubbles` when not typing). */
function paragraphRangesForAssistant(full: string): { start: number; end: number }[] {
  if (!full) return [];
  const ranges: { start: number; end: number }[] = [];
  const re = /\n\n+/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(full)) !== null) {
    if (m.index > lastIndex) {
      ranges.push({ start: lastIndex, end: m.index });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < full.length || ranges.length === 0) {
    ranges.push({ start: lastIndex, end: full.length });
  }
  const filtered = ranges.filter((r) => full.slice(r.start, r.end).trim().length > 0);
  return filtered.length > 0 ? filtered : [{ start: 0, end: full.length }];
}

/** Types full message while keeping the same paragraph breaks as the finished bubbles (no layout jump). */
function TypingAssistantParagraphs({
  target,
  speed = TYPING_MS,
  paragraphClassName,
  onTypingLayout,
}: {
  target: string;
  speed?: number;
  paragraphClassName?: string;
  /** Called after each typed character is laid out so the parent scroll region can follow. */
  onTypingLayout?: () => void;
}) {
  const ranges = useMemo(() => paragraphRangesForAssistant(target), [target]);
  const [shownLen, setShownLen] = useState(0);

  useEffect(() => {
    setShownLen(0);
    if (!target.length) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setShownLen(n);
      if (n >= target.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [target, speed]);

  useLayoutEffect(() => {
    onTypingLayout?.();
  }, [shownLen, onTypingLayout]);

  if (!target) return null;

  return (
    <>
      {ranges.map((r, bi) => {
        if (shownLen < r.start) return null;
        const slice = target.slice(r.start, Math.min(r.end, shownLen));
        const caret =
          shownLen < target.length &&
          ((shownLen < r.end) ||
            (bi < ranges.length - 1 &&
              shownLen >= r.end &&
              shownLen < ranges[bi + 1].start));
        return (
          <p key={`${r.start}-${r.end}`} className={cn(bi > 0 && 'mt-3', paragraphClassName)}>
            {slice}
            {caret ? (
              <span className="inline-block h-[14px] w-[2px] animate-pulse bg-arcova-teal ml-0.5 align-middle" />
            ) : null}
          </p>
        );
      })}
    </>
  );
}

function SetupAssistantMessageParagraphs({
  text,
  typing,
  paragraphClassName,
  onTypingLayout,
}: {
  text: string;
  typing?: boolean;
  paragraphClassName?: string;
  onTypingLayout?: () => void;
}) {
  const bubbles = setupAssistantBubbles(text);

  if (!typing) {
    return (
      <>
        {bubbles.map((bubble, bi) => (
          <p key={bi} className={cn(bi > 0 && 'mt-3', paragraphClassName)}>
            {bubble}
          </p>
        ))}
      </>
    );
  }

  return (
    <TypingAssistantParagraphs
      target={text}
      speed={TYPING_MS}
      paragraphClassName={paragraphClassName}
      onTypingLayout={onTypingLayout}
    />
  );
}

function normalizeForWelcomeDuplicate(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\u2026/g, '...')
    .replace(/\u2019|\u2018/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[`´]/g, "'");
}

/** Model often echoes the static welcome headline already shown on the card. */
function assistantRepeatsWelcomeHeadline(assistantText: string, welcomePart1: string, welcomePart2: string): boolean {
  const headline = normalizeForWelcomeDuplicate(`${welcomePart1}${welcomePart2}`);
  const body = normalizeForWelcomeDuplicate(assistantText);
  if (!headline || !body) return false;
  if (body === headline) return true;
  const compact = (t: string) => t.replace(/\s/g, '');
  if (compact(body) === compact(headline)) return true;
  if (body.startsWith(headline)) {
    const rest = body.slice(headline.length).trim();
    return rest.length === 0 || /^[.!…?]+$/.test(rest);
  }
  return false;
}

/** Drop the first assistant bubble after the user if it only repeats welcome copy. */
function filterFirstAssistantIfWelcomeHeadlineDuplicate(messages: TextMsg[], welcomePart1: string, welcomePart2: string): TextMsg[] {
  let seenUser = false;
  let handledFirstAssistantAfterUser = false;
  const out: TextMsg[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      seenUser = true;
      out.push(msg);
      continue;
    }
    if (msg.role === 'assistant' && seenUser && !handledFirstAssistantAfterUser) {
      handledFirstAssistantAfterUser = true;
      if (!msg.typing && assistantRepeatsWelcomeHeadline(msg.text, welcomePart1, welcomePart2)) {
        continue;
      }
    }
    out.push(msg);
  }
  return out;
}

function visibleGreetingStyleMessages(thread: DisplayMsg[], welcomePart1: string, welcomePart2: string): TextMsg[] {
  const visible = thread.filter((m): m is TextMsg => m.kind === 'text');
  const firstUserIdx = visible.findIndex((m) => m.role === 'user');
  const sliced = firstUserIdx >= 0 ? visible.slice(firstUserIdx) : visible;
  return filterFirstAssistantIfWelcomeHeadlineDuplicate(sliced, welcomePart1, welcomePart2);
}

function SetupGlassAgentMetaStrip({
  clock,
  statusKey,
}: {
  clock: Date;
  statusKey: 'waiting' | 'thinking' | 'ready';
}) {
  return (
    <div
      className="mb-[1cm] flex min-h-[3.5rem] shrink-0 items-center justify-between text-[11px] tracking-[0.04em] text-slate-500"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-arcova-teal"
          style={{
            animation: 'arcova-dot-pulse 2.6s ease-in-out infinite',
            boxShadow: '0 0 0 4px rgba(0, 164, 180, 0.18)',
          }}
          aria-hidden
        />
        <span className="font-medium text-slate-500">Arcova · {statusKey}</span>
      </span>
      <time className="tabular-nums text-[10px] text-slate-400" dateTime={clock.toISOString()}>
        {clock.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })}{' '}
        · local
      </time>
    </div>
  );
}

function SetupEmbedChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = 'Reply…',
  autoFocusInput,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocusInput?: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="shrink-0 border-t border-[rgba(13,53,71,0.07)] bg-transparent px-0 pb-1 pt-2"
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[rgba(13,53,71,0.12)] bg-white/90 px-3 py-2.5 shadow-[0_8px_32px_-20px_rgba(13,53,71,0.18)] backdrop-blur-md transition-all focus-within:border-arcova-teal/45 focus-within:shadow-[0_8px_28px_-18px_rgba(0,164,180,0.22)]">
          <Sparkles className="h-4 w-4 shrink-0 text-arcova-teal/45" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            autoFocus={autoFocusInput}
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent font-manrope text-[1.0625rem] text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-arcova-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Two-tone typewriter headline ─────────────────────────────────────────

function TypingHeadline({ part1, part2, speed = TYPING_MS }: { part1: string; part2: string; speed?: number }) {
  const full = part1 + part2;
  const [shown, setShown] = useState('');
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setShown('');
    const t = setInterval(() => {
      idx.current += 1;
      setShown(full.slice(0, idx.current));
      if (idx.current >= full.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [full, speed]);

  const p1 = shown.slice(0, part1.length);
  const p2 = shown.slice(part1.length);
  const done = shown.length >= full.length;

  return (
    <>
      {p1}
      {p2 && <span className="text-arcova-teal">{p2}</span>}
      {!done && <span className="inline-block w-[2px] h-[0.85em] bg-arcova-teal ml-0.5 align-middle animate-pulse" />}
    </>
  );
}

// ── Setup: breathing orb (default: compact; `welcome` = prototype shell with rings / core / optional busy layer) ──

function SetupOrb({
  size = 'lg',
  variant = 'default',
  welcomeEnergised = false,
}: {
  size?: 'lg' | 'md' | 'sm';
  variant?: 'default' | 'welcome';
  /** When true with `welcome`, show corona, petals, colour cycle, faster motion (enriching / loading). */
  welcomeEnergised?: boolean;
}) {
  if (variant === 'welcome') {
    return <ArcovaWelcomeOrb energised={welcomeEnergised} size="md" />;
  }

  const d = size === 'lg' ? 88 : size === 'md' ? 60 : 42;
  return (
    <div className="relative flex items-center justify-center" style={{ width: d, height: d }}>
      <div
        className="absolute rounded-full"
        style={{
          inset: '-32%',
          background: 'radial-gradient(circle, rgba(0,164,180,0.3) 0%, transparent 68%)',
          filter: 'blur(12px)',
          animation: 'arcova-halo-pulse 6s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full border border-arcova-teal/15"
        style={{ inset: '-22%', animation: 'arcova-orb-breathe 5.4s ease-in-out infinite' }}
      />
      <div
        className="absolute rounded-full border border-arcova-teal/8"
        style={{ inset: '-42%', animation: 'arcova-orb-breathe 5.4s ease-in-out infinite 0.8s' }}
      />
      <div
        className="relative overflow-hidden rounded-full"
        style={{
          width: d,
          height: d,
          background: 'radial-gradient(circle at 30% 28%, #ffffff 0%, #00A4B4 56%, #003344 130%)',
          boxShadow: 'inset 0 -4px 8px rgba(13,53,71,0.18), inset 0 2px 6px rgba(255,255,255,0.5)',
          animation: 'arcova-orb-breathe 5.4s ease-in-out infinite',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 60% 30% at 36% 26%, rgba(255,255,255,0.7), transparent 60%)',
          }}
        />
      </div>
    </div>
  );
}

// ── Welcome card ──────────────────────────────────────────────────────────

function SetupWelcomeCard({
  firstName,
  onSubmit,
  analysisError,
  isLoading,
  mode = 'own',
}: {
  firstName?: string;
  onSubmit: (url: string) => void;
  analysisError?: string;
  isLoading?: boolean;
  mode?: 'own' | 'target';
}) {
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading) {
      const t = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = url.trim();
    if (!v) return;
    onSubmit(v.replace(/^https?:\/\//i, ''));
  };

  return (
    <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px] rounded-3xl border border-white/55 bg-white/65 p-10 shadow-arcova backdrop-blur-xl">
        <div className="mb-8 flex justify-center">
          <SetupOrb variant="welcome" welcomeEnergised={!!isLoading} />
        </div>
        <div className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/45">
          {mode === 'target' ? 'Step 2 · Target ICP' : 'Welcome to Arcova'}
        </div>
        <h1 className="mb-3 text-center font-manrope text-3xl font-medium leading-tight tracking-tight text-arcova-navy">
          {mode === 'target' ? (
            <>
              Drop in a URL for a{' '}
              <span className="bg-gradient-to-br from-arcova-teal to-[#007e8b] bg-clip-text text-transparent">
                dream account.
              </span>
            </>
          ) : (
            <>
              Hi {firstName || 'there'} —{' '}
              <span className="bg-gradient-to-br from-arcova-teal to-[#007e8b] bg-clip-text text-transparent">
                what&apos;s your company&apos;s website?
              </span>
            </>
          )}
        </h1>
        <p className="mb-8 text-center text-sm leading-relaxed text-arcova-navy/55">
          {mode === 'target'
            ? "Think of your best-fit customer — or a company you'd love to land. I'll build a full profile of who buys there."
            : "I'll read it the same way a new hire would on day one, then we'll talk through what I learned together. Takes about 60 seconds."}
        </p>

        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <ArcovaLoader size={32} />
            <p className="text-sm text-arcova-navy/50">Getting things ready…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex overflow-hidden rounded-xl border border-arcova-navy/12 bg-white/75 shadow-sm transition-all focus-within:border-arcova-teal focus-within:ring-2 focus-within:ring-arcova-teal/15">
              <span className="flex items-center pl-4 text-sm font-medium text-arcova-navy/35">
                https://
              </span>
              <input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value.replace(/^https?:\/\//i, ''))}
                placeholder="yourcompany.com"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-3.5 pr-2 text-sm text-arcova-navy outline-none placeholder:text-arcova-navy/35"
              />
              <button
                type="submit"
                disabled={!url.trim()}
                className="m-1 rounded-lg bg-arcova-teal px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-arcova-navy disabled:opacity-30"
              >
                Continue
              </button>
            </div>
            {analysisError && (
              <p className="text-center text-xs text-red-600">{analysisError}</p>
            )}
          </form>
        )}

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-arcova-navy/40">
          <span className="flex -space-x-1.5">
            {['#a3e3df', '#f6d6c1', '#b5d6f0'].map((bg, i) => (
              <span
                key={i}
                className="h-5 w-5 rounded-full border border-white/60"
                style={{ background: bg }}
              />
            ))}
          </span>
          <span>
            Setting up as{' '}
            <strong className="font-semibold text-arcova-navy/70">{firstName || 'you'}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

type InlineEnrichmentSnapshot = {
  title: string;
  logoUrl: string | null;
  tagline: string | null;
  blurb: string | null;
  metaLine: string | null;
  locationLine: string | null;
};

type EnrichmentSnapshotStage = {
  tier: string;
  label: string;
  snapshot: InlineEnrichmentSnapshot;
};

function prettyCompanyUrlHint(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    const host = new URL(u).hostname.replace(/^www\./i, '').trim();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

function buildInlineSnapshotFromTarget(
  p: Partial<TargetCompanyEnrichmentResult> | null | undefined,
  urlHint: string | null,
): InlineEnrichmentSnapshot | null {
  const rawName =
    typeof p?.company_name === 'string' && p.company_name.trim() ? p.company_name.trim() : '';
  const descArr = Array.isArray(p?.description) ? p.description : [];
  const blurb =
    typeof descArr[0] === 'string' && descArr[0].trim()
      ? (descArr[0] as string).trim().slice(0, 380)
      : null;
  const logoUrl =
    typeof p?.logo_url === 'string' && p.logo_url.trim() ? p.logo_url.trim() : null;
  const tagline =
    typeof p?.tagline === 'string' && p.tagline.trim() ? p.tagline.trim().slice(0, 280) : null;
  const industry =
    typeof p?.industry === 'string' && p.industry.trim() ? p.industry.trim() : null;
  const empPart =
    typeof p?.employee_count === 'number' ? `${p.employee_count.toLocaleString()} employees` : null;
  const metaLine = [industry, empPart].filter(Boolean).join(' · ') || null;
  const city = typeof p?.hq_city === 'string' && p.hq_city.trim() ? p.hq_city.trim() : null;
  const country =
    typeof p?.hq_country === 'string' && p.hq_country.trim() ? p.hq_country.trim() : null;
  const locationLine = [city, country].filter(Boolean).join(', ') || null;

  const hasDetail =
    Boolean(rawName) ||
    Boolean(logoUrl) ||
    Boolean(tagline) ||
    Boolean(blurb) ||
    Boolean(metaLine) ||
    Boolean(locationLine);

  if (!hasDetail && urlHint) {
    return {
      title: urlHint,
      logoUrl: null,
      tagline: null,
      blurb: null,
      metaLine: null,
      locationLine: null,
    };
  }
  if (!hasDetail) return null;

  return {
    title: rawName || urlHint || 'Company',
    logoUrl,
    tagline,
    blurb,
    metaLine,
    locationLine,
  };
}

function buildInlineSnapshotFromOwn(
  p: Partial<Record<string, unknown>> | null,
  urlHint: string | null,
): InlineEnrichmentSnapshot | null {
  const rawName =
    typeof p?.company_name === 'string' && p.company_name.trim() ? p.company_name.trim() : '';
  const descArr = Array.isArray(p?.description) ? p.description : [];
  const blurb =
    typeof descArr[0] === 'string' && descArr[0].trim()
      ? (descArr[0] as string).trim().slice(0, 380)
      : null;
  const logoUrl =
    typeof p?.logo_url === 'string' && p.logo_url.trim() ? (p.logo_url as string).trim() : null;
  const tagline =
    typeof p?.tagline === 'string' && p.tagline.trim() ? (p.tagline as string).trim().slice(0, 280) : null;
  const industry =
    typeof p?.industry === 'string' && p.industry.trim() ? (p.industry as string).trim() : null;
  const empPart =
    typeof p?.employee_count === 'number'
      ? `${(p.employee_count as number).toLocaleString()} employees`
      : null;
  const metaLine = [industry, empPart].filter(Boolean).join(' · ') || null;
  const city =
    typeof p?.hq_city === 'string' && p.hq_city.trim() ? (p.hq_city as string).trim() : null;
  const country =
    typeof p?.hq_country === 'string' && p.hq_country.trim() ? (p.hq_country as string).trim() : null;
  const locationLine = [city, country].filter(Boolean).join(', ') || null;

  const hasDetail =
    Boolean(rawName) ||
    Boolean(logoUrl) ||
    Boolean(tagline) ||
    Boolean(blurb) ||
    Boolean(metaLine) ||
    Boolean(locationLine);

  if (!hasDetail && urlHint) {
    return {
      title: urlHint,
      logoUrl: null,
      tagline: null,
      blurb: null,
      metaLine: null,
      locationLine: null,
    };
  }
  if (!hasDetail) return null;

  return {
    title: rawName || urlHint || 'Company',
    logoUrl,
    tagline,
    blurb,
    metaLine,
    locationLine,
  };
}

/** Buying-team step; prefer full example enrichment snapshot, else saved ICP / URL labels. */
function buildBuyingTeamSnapshot(
  enrichment: TargetCompanyEnrichmentResult | null | undefined,
  fallbackName: string | null | undefined,
  urlHint: string | null,
): InlineEnrichmentSnapshot | null {
  const fromData = buildInlineSnapshotFromTarget(enrichment ?? null, urlHint);
  if (fromData) return fromData;
  const nm =
    typeof fallbackName === 'string' && fallbackName.trim()
      ? fallbackName.trim().slice(0, 200)
      : '';
  if (nm) {
    return {
      title: nm,
      logoUrl: null,
      tagline: null,
      blurb: null,
      metaLine: null,
      locationLine: null,
    };
  }
  if (urlHint) {
    return {
      title: urlHint,
      logoUrl: null,
      tagline: null,
      blurb: null,
      metaLine: null,
      locationLine: null,
    };
  }
  return null;
}

/** Separate cards per SSE milestone so each new tier visibly stacks in the loader. */
function buildTieredSnapshotsFromTarget(
  p: Partial<TargetCompanyEnrichmentResult> | null | undefined,
  urlHint: string | null,
  enrichStep: number,
): EnrichmentSnapshotStage[] {
  const stages: EnrichmentSnapshotStage[] = [];
  const rawName =
    typeof p?.company_name === 'string' && p.company_name.trim() ? p.company_name.trim() : '';
  const descArr = Array.isArray(p?.description) ? p.description : [];
  const blurbWebsite =
    typeof descArr[0] === 'string' && descArr[0].trim()
      ? (descArr[0] as string).trim().slice(0, 380)
      : null;
  const titleBase = rawName || urlHint || 'Company';

  if (enrichStep === 0 && urlHint) {
    stages.push({
      tier: 'starting-point',
      label: 'Starting point',
      snapshot: {
        title: urlHint,
        logoUrl: null,
        tagline: null,
        blurb: null,
        metaLine: null,
        locationLine: null,
      },
    });
  }

  if (enrichStep >= 1 && (rawName || blurbWebsite || urlHint)) {
    stages.push({
      tier: 'from-website',
      label: 'From the website',
      snapshot: {
        title: titleBase,
        logoUrl: null,
        tagline: null,
        blurb: blurbWebsite,
        metaLine: null,
        locationLine: null,
      },
    });
  }

  if (enrichStep >= 2) {
    const industry =
      typeof p?.industry === 'string' && p.industry.trim() ? p.industry.trim() : null;
    const empPart =
      typeof p?.employee_count === 'number' ? `${p.employee_count.toLocaleString()} employees` : null;
    const metaLine = [industry, empPart].filter(Boolean).join(' · ') || null;
    const city = typeof p?.hq_city === 'string' && p.hq_city.trim() ? p.hq_city.trim() : null;
    const country =
      typeof p?.hq_country === 'string' && p.hq_country.trim() ? p.hq_country.trim() : null;
    const locationLine = [city, country].filter(Boolean).join(', ') || null;
    const founded =
      typeof p?.founded_year === 'number' ? `Founded ${p.founded_year}` : null;
    const fundingRaw =
      typeof p?.funding_stage === 'string' && p.funding_stage.trim() ? p.funding_stage.trim() : null;
    const timelineLine = [founded, fundingRaw].filter(Boolean).join(' · ') || null;
    if (metaLine || locationLine || timelineLine) {
      stages.push({
        tier: 'firm-context',
        label: 'Firm context',
        snapshot: {
          title: titleBase,
          logoUrl: null,
          tagline: null,
          blurb: timelineLine,
          metaLine,
          locationLine,
        },
      });
    }
  }

  if (enrichStep >= 3) {
    const logoUrl =
      typeof p?.logo_url === 'string' && p.logo_url.trim() ? p.logo_url.trim() : null;
    const tagline =
      typeof p?.tagline === 'string' && p.tagline.trim()
        ? p.tagline.trim().slice(0, 280)
        : null;
    const followers =
      typeof p?.follower_count === 'number'
        ? `${p.follower_count.toLocaleString()} followers`
        : null;
    if (logoUrl || tagline || followers) {
      stages.push({
        tier: 'public-presence',
        label: 'Public presence',
        snapshot: {
          title: titleBase,
          logoUrl,
          tagline,
          blurb: null,
          metaLine: followers,
          locationLine: null,
        },
      });
    }
  }

  return stages;
}

function buildTieredSnapshotsFromOwn(
  p: Partial<Record<string, unknown>> | null,
  urlHint: string | null,
  enrichStep: number,
): EnrichmentSnapshotStage[] {
  const stages: EnrichmentSnapshotStage[] = [];
  const rawName =
    typeof p?.company_name === 'string' && p.company_name.trim() ? p.company_name.trim() : '';
  const descArr = Array.isArray(p?.description) ? p.description : [];
  const blurbWebsite =
    typeof descArr[0] === 'string' && descArr[0].trim()
      ? (descArr[0] as string).trim().slice(0, 380)
      : null;
  const titleBase = rawName || urlHint || 'Company';

  if (enrichStep === 0 && urlHint) {
    stages.push({
      tier: 'starting-point',
      label: 'Starting point',
      snapshot: {
        title: urlHint,
        logoUrl: null,
        tagline: null,
        blurb: null,
        metaLine: null,
        locationLine: null,
      },
    });
  }

  if (enrichStep >= 1 && (rawName || blurbWebsite || urlHint)) {
    stages.push({
      tier: 'from-website',
      label: 'From the website',
      snapshot: {
        title: titleBase,
        logoUrl: null,
        tagline: null,
        blurb: blurbWebsite,
        metaLine: null,
        locationLine: null,
      },
    });
  }

  if (enrichStep >= 2) {
    const industry =
      typeof p?.industry === 'string' && p.industry.trim() ? (p.industry as string).trim() : null;
    const empPart =
      typeof p?.employee_count === 'number'
        ? `${(p.employee_count as number).toLocaleString()} employees`
        : null;
    const metaLine = [industry, empPart].filter(Boolean).join(' · ') || null;
    const city =
      typeof p?.hq_city === 'string' && p.hq_city.trim() ? (p.hq_city as string).trim() : null;
    const country =
      typeof p?.hq_country === 'string' && p.hq_country.trim() ? (p.hq_country as string).trim() : null;
    const locationLine = [city, country].filter(Boolean).join(', ') || null;
    const fundingRaw =
      typeof p?.funding_stage === 'string' && p.funding_stage.trim()
        ? (p.funding_stage as string).trim()
        : null;
    if (metaLine || locationLine || fundingRaw) {
      stages.push({
        tier: 'firm-context',
        label: 'Firm context',
        snapshot: {
          title: titleBase,
          logoUrl: null,
          tagline: null,
          blurb: fundingRaw || null,
          metaLine,
          locationLine,
        },
      });
    }
  }

  if (enrichStep >= 3) {
    const logoUrl =
      typeof p?.logo_url === 'string' && p.logo_url.trim() ? (p.logo_url as string).trim() : null;
    const tagline =
      typeof p?.tagline === 'string' && p.tagline.trim()
        ? (p.tagline as string).trim().slice(0, 280)
        : null;
    const followers =
      typeof p?.follower_count === 'number'
        ? `${(p.follower_count as number).toLocaleString()} followers`
        : null;
    if (logoUrl || tagline || followers) {
      stages.push({
        tier: 'public-presence',
        label: 'Public presence',
        snapshot: {
          title: titleBase,
          logoUrl,
          tagline,
          blurb: null,
          metaLine: followers,
          locationLine: null,
        },
      });
    }
  }

  return stages;
}

function EnrichmentSnapshotBody({
  snapshot,
  variant = 'glass',
}: {
  snapshot: InlineEnrichmentSnapshot;
  variant?: 'glass' | 'chat';
}) {
  const isGlass = variant === 'glass';
  return (
    <div className="flex gap-3">
      <div
        className={cn(
          'relative h-11 w-11 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset',
          isGlass ? 'bg-slate-100 ring-slate-200/80' : 'bg-gray-100 ring-gray-200/90',
        )}
      >
        {snapshot.logoUrl ? (
          <Image
            src={snapshot.logoUrl}
            alt=""
            width={44}
            height={44}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Building2 className={cn('h-5 w-5', isGlass ? 'text-slate-500' : 'text-gray-500')} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className={cn(
            'font-semibold leading-tight tracking-[-0.02em]',
            isGlass ? 'text-[14px] text-slate-800' : 'text-sm text-gray-800',
          )}
        >
          {snapshot.title}
        </p>
        {snapshot.tagline ? (
          <p
            className={cn(
              'line-clamp-2 leading-snug',
              isGlass ? 'text-xs text-slate-600' : 'text-xs text-gray-500',
            )}
          >
            {snapshot.tagline}
          </p>
        ) : null}
        {snapshot.metaLine ? (
          <p className={cn('text-xs', isGlass ? 'text-slate-500' : 'text-gray-400')}>{snapshot.metaLine}</p>
        ) : null}
        {snapshot.locationLine ? (
          <p className={cn('text-xs', isGlass ? 'text-slate-500' : 'text-gray-400')}>
            {snapshot.locationLine}
          </p>
        ) : null}
        {snapshot.blurb ? (
          <p
            className={cn(
              'line-clamp-2 leading-snug',
              isGlass ? 'text-xs text-slate-600' : 'text-xs text-gray-500',
            )}
          >
            {snapshot.blurb}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SnapshotStageCard({
  label,
  snapshot,
  variant,
}: {
  label: string;
  snapshot: InlineEnrichmentSnapshot;
  variant: 'glass' | 'chat';
}) {
  const isGlass = variant === 'glass';
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2.5 ring-1',
        isGlass
          ? 'bg-white/40 ring-slate-200/60 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.65)]'
          : 'bg-gray-50/90 ring-gray-100',
      )}
      style={{ animation: 'arcova-msg-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both' }}
    >
      {label.trim().length > 0 ? (
        <p
          className={cn(
            'text-[10px] font-semibold uppercase tracking-[0.14em]',
            isGlass ? 'text-slate-500' : 'text-gray-400',
          )}
        >
          {label}
        </p>
      ) : null}
      <div className={label.trim().length > 0 ? 'mt-2' : undefined}>
        <EnrichmentSnapshotBody snapshot={snapshot} variant={variant} />
      </div>
    </div>
  );
}

function SetupEnrichmentSnapshotStrip({
  stages,
  variant,
}: {
  stages: EnrichmentSnapshotStage[];
  variant: 'glass' | 'chat';
}) {
  if (stages.length === 0) return null;
  const latest = stages[stages.length - 1]!;
  return (
    <div className="mt-3 max-h-[min(340px,45vh)] overflow-y-auto pr-0.5 [scrollbar-width:thin]">
      <SnapshotStageCard
        key={latest.tier}
        label={latest.label}
        snapshot={latest.snapshot}
        variant={variant}
      />
    </div>
  );
}

function SetupInlineEnrichmentPanel({
  statusLine,
  displayPct,
  snapshotStages,
  showStop,
  onCancel,
}: {
  statusLine: string;
  displayPct: number;
  snapshotStages?: EnrichmentSnapshotStage[] | null;
  showStop: boolean;
  onCancel?: () => void;
}) {
  return (
    <div
      className="w-full rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-white px-4 py-4 font-manrope text-slate-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] ring-1 ring-slate-200/55"
      style={{ animation: 'arcova-msg-in 0.2s ease' }}
    >
      <p className="text-sm leading-snug text-slate-600">{statusLine}</p>
      {snapshotStages && snapshotStages.length > 0 ? (
        <SetupEnrichmentSnapshotStrip stages={snapshotStages} variant="glass" />
      ) : null}
      <div className="mt-3 space-y-1.5">
        <div className="relative h-2 overflow-hidden rounded-full bg-slate-200/80">
          <div
            className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, displayPct)}%` }}
          >
            <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-10 rounded-full" />
          </div>
        </div>
        <p className="text-right text-xs tabular-nums text-slate-400">{Math.min(100, Math.round(displayPct))}%</p>
      </div>
      {showStop && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 text-left text-xs text-slate-400 underline underline-offset-2 transition-colors hover:text-slate-600"
        >
          Stop
        </button>
      ) : null}
    </div>
  );
}

// ── Selection chips ────────────────────────────────────────────────────────

type ChipOption = string | { value: string; label?: string; description?: string };

type SignalOption = {
  id: string;
  name: string;
  category: string;
};

function ChipGrid({
  options,
  selected,
  onToggle,
}: {
  options: ChipOption[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (options.length > 0 && typeof options[0] === 'object') {
    return (
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {(options as Array<{ value: string; label?: string; description?: string }>).map((o) => (
          <button
            key={o.value}
            onClick={() => onToggle(o.value)}
            className={`w-full rounded-xl border-2 p-3 text-left text-base transition-all ${
              selected.includes(o.value)
                ? 'border-arcova-teal bg-arcova-teal/10'
                : 'border-white/15 bg-white/[0.06] hover:border-white/30'
            }`}
          >
            <p className={`font-medium ${selected.includes(o.value) ? 'text-arcova-teal' : 'text-white/85'}`}>
              {o.label ?? o.value}
            </p>
            {o.description && <p className="mt-0.5 text-sm text-white/45">{o.description}</p>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
      {(options as string[]).map((o) => (
        <button
          key={o}
          onClick={() => onToggle(o)}
          className={`rounded-full px-3 py-2 text-base transition-colors ${
            selected.includes(o)
              ? 'bg-arcova-teal text-white'
              : 'bg-white/10 text-white/75 hover:bg-white/15'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SetupFlow: main component
// ═══════════════════════════════════════════════════════════════════════════

interface SetupFlowProps {
  firstName?: string;
  email?: string;
  emailDomain?: string;
  entryPoint?: EntryPoint;
  onCompletePath?: string;
  companyProfiles?: TargetCompanyProfile[];
  companyContactsMap?: Record<string, string>;
}

export default function SetupFlow({
  firstName,
  email,
  emailDomain,
  entryPoint = 'full',
  onCompletePath,
  companyProfiles = [],
  companyContactsMap = {},
}: SetupFlowProps) {
  const router = useRouter();
  const pathname = usePathname();
  // ── UI state ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('greeting');
  const [bootstrapFinished, setBootstrapFinished] = useState(false);
  const [thread, setThread] = useState<DisplayMsg[]>([]);
  const [thinking, setThinking] = useState(true);
  const [inputEnabled, setInput] = useState(false);
  const [inputValue, setInputVal] = useState('');
  const [chipSel, setChipSel] = useState<string[]>([]);
  const [setupGreetingChatClock, setSetupGreetingChatClock] = useState(() => new Date());
  const [loadMsg, setLoadMsg] = useState('Visiting your website…');
  const [customerUrlLoadMsg, setCustomerUrlLoadMsg] = useState('Visiting the website…');
  const [customerUrlProgressNow, setCustomerUrlProgressNow] = useState(0);
  const customerUrlStartedAtRef = useRef<number | null>(null);
  const [ownCompanyProgressNow, setOwnCompanyProgressNow] = useState(0);
  const ownCompanyStartedAtRef = useRef<number | null>(null);
  const [savingProgressNow, setSavingProgressNow] = useState(0);
  const savingStartedAtRef = useRef<number | null>(null);
  // Partial enrichment data — populated incrementally via SSE as each step completes
  const [partialTargetEnrichment, setPartialTargetEnrichment] = useState<Partial<import('@/lib/target-company-enrichment').TargetCompanyEnrichmentResult> | null>(null);
  const [partialOwnEnrichment, setPartialOwnEnrichment] = useState<Partial<Record<string, unknown>> | null>(null);
  const [targetEnrichStep, setTargetEnrichStep] = useState(0); // 0 = not started, 1–4 = step completed
  const [ownEnrichStep, setOwnEnrichStep] = useState(0);
  const [ownEnrichLinkedinWait, setOwnEnrichLinkedinWait] = useState(false);
  /** True from `step_apollo` until `step_linkedin` during my-company enrichment. */
  const [ownEnrichAwaitingLinkedinEvent, setOwnEnrichAwaitingLinkedinEvent] = useState(false);
  const [ownEnrichSynthesisWait, setOwnEnrichSynthesisWait] = useState(false);
  /** True during own-company SSE (initial load or re-enrich on the results screen). */
  const [ownCompanyAnalysisInFlight, setOwnCompanyAnalysisInFlight] = useState(false);
  const [customerUrlLinkedinWait, setCustomerUrlLinkedinWait] = useState(false);
  /** True from `step_apollo` until `step_linkedin` (lookup can feel silent without rotating copy). */
  const [customerUrlAwaitingLinkedinEvent, setCustomerUrlAwaitingLinkedinEvent] = useState(false);
  const [customerUrlSynthesisWait, setCustomerUrlSynthesisWait] = useState(false);
  /** Anchor for soft progress creep while stuck on enrich step 2 (before `step_apify`). */
  const customerUrlStep2AnchorRef = useRef<number | null>(null);
  /** Anchor for soft progress creep during my-company enrich step 2 (before `step_apify`). */
  const ownCompanyStep2AnchorRef = useRef<number | null>(null);
  const [buyingLoadPct, setBuyingLoadPct] = useState(18);
  const [analysisError, setAnalysisError] = useState('');
  const [pendingTransition, setPendingTransition] = useState<{
    target: 'proceed_to_customer_url' | 'confirm_own_company' | 'restart';
    buttonLabel: string;
  } | null>(null);
  const [reviewDraft, setReviewDraft] = useState({
    companyType: '',
    platformCategory: '',
    therapeuticAreas: [] as string[],
    modalities: [] as string[],
    developmentStages: [] as string[],
    customerTherapeuticAreas: [] as string[],
    customerModalities: [] as string[],
    customerDevelopmentStages: [] as string[],
    companySizes: [] as string[],
    liFollowerSizes: [] as string[],
    fundingStages: [] as string[],
  });
  const [reviewedCompanyName, setReviewedCompanyName] = useState('');
  const [enrichedTargetCompany, setEnrichedTargetCompany] = useState<import('@/lib/target-company-enrichment').TargetCompanyEnrichmentResult | null>(null);
  const [editingFindings, setEditingFindings] = useState(false);
  const [editingFindingsData, setEditingFindingsData] = useState<Record<string, unknown> | null>(null);
  const editingFindingsDataRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    editingFindingsDataRef.current = editingFindingsData;
  }, [editingFindingsData]);
  const [savingFindings, setSavingFindings] = useState(false);
  const [saveChangesClickAnim, setSaveChangesClickAnim] = useState(false);
  const [icpEditMode, setIcpEditMode] = useState(false);
  const icpEditSnapshotRef = useRef<typeof reviewDraft | null>(null);
  /** Snapshot of enrichment (e.g. competitors) when opening ICP edit from the panel. */
  const icpEditPanelSegmentsRef = useRef<{ targetCustomers: string[]; buyerTypes: string[]; competitors: import('@/components/SetupProfilePanel').CompetitorItem[] } | null>(null);

  // ── Panel state (mirrors refs so the profile panel re-renders live) ───────
  const [panelCompany, setPanelCompany] = useState<PanelCompanyData>({
    companyType: '', platformCategory: '', companySizes: [], liFollowerSizes: [], therapeuticAreas: [],
    modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [],
    fundingStages: [], signals: [], targetCustomers: [], buyerTypes: [], competitors: [],
  });
  const [panelPersona, setPanelPersona] = useState<PanelPersonaData>({ functions: [], seniority: [], signals: [] });
  const [buyingTeamEditMode, setBuyingTeamEditMode] = useState(false);
  const [savedIcpName, setSavedIcpName] = useState('');
  const [savedPersonaName, setSavedPersonaName] = useState('');
  const [icpSuggestions, setIcpSuggestions] = useState<IcpSuggestion[]>([]);

  // ── Accumulated form data (refs avoid stale closure in async callbacks) ──
  const companyRef = useRef({
    companyType: '', platformCategory: '', companySizes: [] as string[], liFollowerSizes: [] as string[], therapeuticAreas: [] as string[],
    modalities: [] as string[], developmentStages: [] as string[],
    customerTherapeuticAreas: [] as string[], customerModalities: [] as string[], customerDevelopmentStages: [] as string[],
    fundingStages: [] as string[], signals: [] as string[],
    targetCustomers: [] as string[], buyerTypes: [] as string[], competitors: [] as import('@/components/SetupProfilePanel').CompetitorItem[],
  });
  const personaRef = useRef({ functions: [] as string[], seniority: [] as string[], jobTitles: [] as string[], signals: [] as string[] });
  const icpIdRef = useRef<string | null>(null);
  const personaIdRef = useRef<string | null>(null);
  const lastTargetUrlRef = useRef<string | null>(null);
  const selectedCompanyRef = useRef<TargetCompanyProfile | null>(null);
  const historyRef = useRef<ApiMsg[]>([]);
  const firstNameRef = useRef(firstName);
  const startedRef = useRef(false);
  /** Normalised URL for the last successful analyse-and-store run (re-analyse / panel header). */
  const lastAnalyzedUrlRef = useRef<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const preEditDataRef = useRef<Record<string, unknown> | null>(null);
  /**
   * `/arcova-setup?step=` sync: first run aligns URL to current phase only (fixes stale ?step=target
   * on step 0). Later, only a *changed* step param (sidebar, back/forward) calls handleGoToStep.
   */
  const setupStepDeepLinkDoneRef = useRef(false);
  const setupStepParamPrevRef = useRef<string | null>(null);
  const setupStepInitialReplacePendingRef = useRef(false);

  const resetSetupStepUrlSyncRefs = () => {
    setupStepDeepLinkDoneRef.current = false;
    setupStepParamPrevRef.current = null;
    setupStepInitialReplacePendingRef.current = false;
  };

  // ── Enrichment navigation guard ────────────────────────────────────────────
  const { setIsEnriching } = useEnrichmentGuard();
  const isEnrichingPhase =
    phase === 'customer_url_loading' ||
    phase === 'analysis_loading' ||
    phase === 'buying_team_loading' ||
    (phase === 'analysis_results' && ownCompanyAnalysisInFlight);

  useEffect(() => {
    setIsEnriching(isEnrichingPhase);
    return () => setIsEnriching(false);
  }, [isEnrichingPhase, setIsEnriching]);

  // Warn if the user tries to close the tab / browser while enrichment is running
  useEffect(() => {
    if (!isEnrichingPhase) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show their own generic message; returnValue is kept for compat
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isEnrichingPhase]);

  useEffect(() => {
    firstNameRef.current = firstName;
  }, [firstName]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const mainChatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const welcomeInputRef = useRef<HTMLInputElement>(null);
  const setupGreetingThreadRef = useRef<HTMLDivElement>(null);

  const scrollSetupGreetingThreadToBottom = useCallback(() => {
    const el = setupGreetingThreadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scrollMainChatToBottom = useCallback(() => {
    const el = mainChatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);
  const availableCompanyProfiles = companyProfiles.filter((company) => !companyContactsMap[company.id]);
  const resolvedCompletePath =
    onCompletePath ?? (entryPoint === 'full' ? '/import' : entryPoint === 'target-company' ? '/company-criteria' : entryPoint === 'company-only' ? '/my-profile' : ROUTES.setup.icps);

  const parseSectionItems = useCallback((value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    }
    return [];
  }, [phase]);

  const formatFindingsSummary = useCallback((data: Record<string, unknown>): string[] => {
    return FINDINGS_SECTION_CONFIG
      .map((section) => {
        const items = parseSectionItems(data[section.key]).slice(0, 5);
        if (items.length === 0) return null;
        return `${section.label}\n${items.map((item) => `- ${item}`).join('\n')}`;
      })
      .filter((line): line is string => Boolean(line));
  }, [parseSectionItems]);

  // ── Scroll ────────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [thread, thinking, phase]);

  useEffect(() => {
    if (!inputEnabled) return;
    const greetingWelcome =
      phase === 'greeting' &&
      !thread.some((m) => m.kind === 'text' && m.role === 'user');
    if (greetingWelcome) welcomeInputRef.current?.focus();
    else inputRef.current?.focus();
  }, [inputEnabled, phase, thread]);

  useEffect(() => {
    const tickClock =
      phase === 'greeting' ||
      phase === 'customer_url_conversation' ||
      phase === 'analysis_loading' ||
      phase === 'customer_url_loading' ||
      phase === 'buying_team_loading';
    if (!tickClock) return;
    setSetupGreetingChatClock(new Date());
    const id = setInterval(() => setSetupGreetingChatClock(new Date()), 30_000);
    return () => clearInterval(id);
  }, [phase]);

  /** Rotate generic status during my-company deep-gather phase. */
  useEffect(() => {
    if (phase !== 'analysis_loading' || !ownEnrichLinkedinWait) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % ENRICH_GENERIC_DEEP_GATHER_LINES.length;
      setLoadMsg(ENRICH_GENERIC_DEEP_GATHER_LINES[i]);
    }, 5200);
    return () => clearInterval(id);
  }, [phase, ownEnrichLinkedinWait]);

  /** Rotate status during my-company profile condense phase. */
  useEffect(() => {
    if (phase !== 'analysis_loading' || !ownEnrichSynthesisWait) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % ENRICH_GENERIC_SYNTHESIS_LINES.length;
      setLoadMsg(ENRICH_GENERIC_SYNTHESIS_LINES[i]);
    }, 3800);
    return () => clearInterval(id);
  }, [phase, ownEnrichSynthesisWait]);

  /** Rotate during my-company mid-pass wait (before deep-gather SSE lands). */
  useEffect(() => {
    if (phase !== 'analysis_loading' || !ownEnrichAwaitingLinkedinEvent) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % ENRICH_GENERIC_LOOKUP_LINES.length;
      setLoadMsg(ENRICH_GENERIC_LOOKUP_LINES[i]);
    }, 3400);
    return () => clearInterval(id);
  }, [phase, ownEnrichAwaitingLinkedinEvent]);

  /** Rotate while waiting mid-pass during target ICP enrichment. */
  useEffect(() => {
    if (phase !== 'customer_url_loading' || !customerUrlAwaitingLinkedinEvent) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % TARGET_ICP_LINKEDIN_LOOKUP_LINES.length;
      setCustomerUrlLoadMsg(TARGET_ICP_LINKEDIN_LOOKUP_LINES[i]);
    }, 3400);
    return () => clearInterval(id);
  }, [phase, customerUrlAwaitingLinkedinEvent]);

  /** Target ICP deep-gather phase rotation. */
  useEffect(() => {
    if (phase !== 'customer_url_loading' || !customerUrlLinkedinWait) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % TARGET_ICP_LINKEDIN_SCRAPE_LINES.length;
      setCustomerUrlLoadMsg(TARGET_ICP_LINKEDIN_SCRAPE_LINES[i]);
    }, 5200);
    return () => clearInterval(id);
  }, [phase, customerUrlLinkedinWait]);

  useEffect(() => {
    if (phase !== 'customer_url_loading' || !customerUrlSynthesisWait) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % TARGET_ICP_SYNTHESIS_LINES.length;
      setCustomerUrlLoadMsg(TARGET_ICP_SYNTHESIS_LINES[i]);
    }, 3800);
    return () => clearInterval(id);
  }, [phase, customerUrlSynthesisWait]);

  useEffect(() => {
    if (phase !== 'buying_team_loading') return;
    setBuyingLoadPct(18);
    const id = setInterval(() => setBuyingLoadPct((p) => Math.min(p + 7, 88)), 880);
    return () => clearInterval(id);
  }, [phase]);

  // Tick the customer-URL progress bar while enrichment is in flight
  useEffect(() => {
    if (phase !== 'customer_url_loading') {
      customerUrlStartedAtRef.current = null;
      return;
    }
    if (customerUrlStartedAtRef.current === null) {
      customerUrlStartedAtRef.current = Date.now();
    }
    setCustomerUrlProgressNow(Date.now());
    const interval = setInterval(() => setCustomerUrlProgressNow(Date.now()), 900);
    return () => clearInterval(interval);
  }, [phase]);

  // Tick the own-company analysis progress bar
  useEffect(() => {
    const ownEnrichActive =
      phase === 'analysis_loading' || (phase === 'analysis_results' && ownCompanyAnalysisInFlight);
    if (!ownEnrichActive) {
      ownCompanyStartedAtRef.current = null;
      return;
    }
    if (ownCompanyStartedAtRef.current === null) {
      ownCompanyStartedAtRef.current = Date.now();
    }
    setOwnCompanyProgressNow(Date.now());
    const interval = setInterval(() => setOwnCompanyProgressNow(Date.now()), 900);
    return () => clearInterval(interval);
  }, [phase, ownCompanyAnalysisInFlight]);

  // Tick the saving progress bar (ICP + persona saves)
  useEffect(() => {
    const saving = phase === 'company_saving' || phase === 'persona_saving';
    if (!saving) {
      savingStartedAtRef.current = null;
      return;
    }
    if (savingStartedAtRef.current === null) {
      savingStartedAtRef.current = Date.now();
    }
    setSavingProgressNow(Date.now());
    const interval = setInterval(() => setSavingProgressNow(Date.now()), 900);
    return () => clearInterval(interval);
  }, [phase]);

  // Keep panelCompany in sync with reviewDraft while the user edits it
  useEffect(() => {
    if (phase === 'customer_url_review') {
      setPanelCompany({
        companyType: reviewDraft.companyType,
        platformCategory: visiblePlatformCategory(reviewDraft.companyType, reviewDraft.platformCategory),
        companySizes: reviewDraft.companySizes,
        liFollowerSizes: reviewDraft.liFollowerSizes,
        therapeuticAreas: reviewDraft.therapeuticAreas,
        modalities: reviewDraft.modalities,
        developmentStages: reviewDraft.developmentStages,
        customerTherapeuticAreas: reviewDraft.customerTherapeuticAreas,
        customerModalities: reviewDraft.customerModalities,
        customerDevelopmentStages: reviewDraft.customerDevelopmentStages,
        fundingStages: reviewDraft.fundingStages,
        signals: companyRef.current.signals,
        targetCustomers: companyRef.current.targetCustomers,
        buyerTypes: companyRef.current.buyerTypes,
        competitors: companyRef.current.competitors,
      });
    }
  }, [reviewDraft, phase]);

  // ── Thread helpers ────────────────────────────────────────────────────────

  const pushText = (role: 'assistant' | 'user', text: string, typing = false): string => {
    const id = crypto.randomUUID();
    setThread((p) => [...p, { id, kind: 'text', role, text, typing }]);
    return id;
  };

  const finishTyping = (id: string) =>
    setThread((p) => p.map((m) => (m.id === id ? { ...m, typing: false } : m)));

  const rememberAssistantText = (text: string) => {
    historyRef.current = [
      ...historyRef.current,
      { role: 'assistant', content: [{ type: 'text', text }] },
    ];
  };

  /** Push an assistant message with typewriter, await its completion */
  const say = async (text: string): Promise<void> => {
    const id = pushText('assistant', text, true);
    await new Promise<void>((res) => setTimeout(res, text.length * TYPING_MS + 200));
    finishTyping(id);
  };

  /** One bubble per part; short pause between beats so they read as separate messages. */
  const sayBeats = async (parts: string[]): Promise<void> => {
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, 450));
      await say(parts[i]);
    }
  };

  // ── Claude API call ───────────────────────────────────────────────────────

  const askClaude = useCallback(async ({
    extra,
    mode = 'conversation',
    phase = 'greeting',
    selectedCompanyName,
    availableCompanyCount,
  }: AskClaudeOptions = {}): Promise<OnboardingResponse> => {
    if (extra) historyRef.current = [...historyRef.current, extra];

    setThinking(true);
    try {
      const res = await fetch('/api/onboarding-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyRef.current,
          firstName: firstNameRef.current,
          mode,
          phase: mapPhaseForOnboardingApi(phase),
          context: {
            entryPoint,
            selectedCompanyName: selectedCompanyName ?? selectedCompanyRef.current?.name ?? null,
            availableCompanyCount,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`onboarding-chat ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const data = (await res.json()) as ApiOnboardingJson;

      for (const action of data.actions || []) {
        if (action.type === 'capture_name' && action.first_name) {
          firstNameRef.current = action.first_name;
          try {
            await supabase.auth.updateUser({ data: { full_name: action.first_name } });
          } catch {}
        }
      }

      const text = data.text ?? '';
      const fromSegments =
        Array.isArray(data.segments) && data.segments.length > 0
          ? data.segments.map((s) => s.trim()).filter(Boolean)
          : [];
      const displayParts = fromSegments.length > 0 ? fromSegments : splitAssistantBeats(text);

      if (displayParts.length > 0) {
        const historyText = displayParts.join('\n\n');
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: [{ type: 'text', text: historyText }] },
        ];
      }

      return {
        text,
        actions: data.actions || [],
        displayParts,
      };
    } catch (error) {
      console.error('[setup-flow] onboarding-chat error:', error);
      const fallback = 'Sorry, I hit a snag there. Can you try that again?';
      return {
        text: fallback,
        actions: [],
        displayParts: [fallback],
      };
    } finally {
      setThinking(false);
    }
  }, [entryPoint]);

  // ── Scripted say + advance to next phase ─────────────────────────────────

  const advanceTo = useCallback(async (next: Phase) => {
    setChipSel([]);
    setPhase(next);
    const narration = NARRATION[next];
    if (narration) await say(narration);
    setInput(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save ICP ──────────────────────────────────────────────────────────────

  const saveIcp = useCallback(async () => {
    setPhase('company_saving');
    const d = companyRef.current;

    // Auto-generate name
    const nameRes = await fetch('/api/generate-icp-name', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...d,
        exampleCompanyName: enrichedTargetCompany?.company_name ?? reviewedCompanyName ?? null,
        exampleCompanyDescription: enrichedTargetCompany?.description ?? null,
      }),
    });
    const { name } = nameRes.ok ? await nameRes.json() : { name: `${d.companyType} Profile` };
    setSavedIcpName(name);

    const summaryRes = await fetch('/api/generate-icp-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyType: d.companyType,
        platformCategory: visiblePlatformCategory(d.companyType, d.platformCategory),
        therapeuticAreas: d.therapeuticAreas,
        modalities: d.modalities,
        developmentStages: d.developmentStages,
        customerTherapeuticAreas: d.customerTherapeuticAreas,
        customerModalities: d.customerModalities,
        customerDevelopmentStages: d.customerDevelopmentStages,
        companySizes: d.companySizes,
        fundingStages: d.fundingStages,
        exampleCompanyName: enrichedTargetCompany?.company_name ?? reviewedCompanyName ?? null,
        exampleCompanyDescription: enrichedTargetCompany?.description ?? null,
      }),
    }).catch(() => null);
    const { summary: icpSummary } = summaryRes?.ok
      ? await summaryRes.json() as { summary: string }
      : { summary: null as string | null };

    const saveRes = await fetch('/api/company-criteria', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        icpSummary,
        companyType: d.companyType,
        platformCategory: visiblePlatformCategory(d.companyType, d.platformCategory),
        therapeuticAreas: d.therapeuticAreas,
        modalities: d.modalities,
        developmentStages: d.developmentStages,
        customerTherapeuticAreas: d.customerTherapeuticAreas,
        customerModalities: d.customerModalities,
        customerDevelopmentStages: d.customerDevelopmentStages,
        companySizes: d.companySizes,
        liFollowerSizes: d.liFollowerSizes,
        fundingStages: d.fundingStages,
        signals: d.signals,
        exampleCompanies: [],
        exampleCompanyUrl: enrichedTargetCompany?.website ?? lastTargetUrlRef.current ?? '',
        exampleCompanyEnrichment: enrichedTargetCompany ?? undefined,
        targetCustomers: d.targetCustomers,
        buyerTypes: d.buyerTypes,
        competitors: d.competitors,
      }),
    });

    if (saveRes.ok) {
      const saved = await saveRes.json();
      const row = saved?.data ?? saved;
      icpIdRef.current = typeof row?.id === 'string' ? row.id : null;
    }

    // Generate buying team suggestions from seller + ICP profiles
    setPhase('buying_team_loading');
    const sellerData = editingFindingsData ?? {};
    const icpData = companyRef.current;

    const btRes = await fetch('/api/generate-buying-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seller_company_name: sellerData.company_name,
        seller_company_type: sellerData.company_type,
        seller_platform_category: visiblePlatformCategory(sellerData.company_type as string | null | undefined, sellerData.platform_category as string | null | undefined),
        seller_therapeutic_areas: sellerData.therapeutic_areas,
        seller_products_services: sellerData.products_services,
        seller_services: sellerData.services,
        seller_customers_we_serve: sellerData.customers_we_serve,
        seller_value_propositions: sellerData.value_propositions,
        icp_company_type: icpData.companyType,
        icp_platform_category: visiblePlatformCategory(icpData.companyType, icpData.platformCategory),
        icp_therapeutic_areas: icpData.therapeuticAreas,
        icp_modalities: icpData.modalities,
        icp_development_stages: icpData.developmentStages,
        icp_company_sizes: icpData.companySizes,
        ...icContextForBuyingTeam(icpData, enrichedTargetCompany),
        example_company_name: reviewedCompanyName || undefined,
      }),
    }).catch(() => null);

    if (btRes?.ok) {
      const btData = await btRes.json() as { functions?: string[]; seniority_levels?: string[]; job_titles?: string[] };
      const fns = btData.functions ?? [];
      const sens = btData.seniority_levels ?? [];
      const titles = btData.job_titles ?? [];
      personaRef.current.functions = fns;
      personaRef.current.seniority = sens;
      personaRef.current.jobTitles = titles;
      setPanelPersona((p) => ({ ...p, functions: fns, seniority: sens, jobTitles: titles }));
      setBuyingTeamEditMode(false);
      setChipSel([]);
      setPhase('buying_team_review');
      setInput(false);
    }

    // Claude narration — references example company + ICP type
    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: `[System: the target company profile has been saved. The example account used was "${reviewedCompanyName || 'the company they entered'}" — a ${icpData.companyType || 'target'} company. Based on that, buying team functions and seniority levels have been pre-filled. Tell the user: based on [example company] as their example account — a [company type] — here's who typically buys in accounts like this. Tell them they can review and confirm, or select and deselect the pills to adjust the teams and seniority if needed. Keep it to 2 sentences, name the example company and its type.]`,
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
  }, [askClaude, advanceTo, editingFindingsData, reviewedCompanyName, enrichedTargetCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSignalsCatalog = useCallback(async (
    endpoint: string,
    body: Record<string, unknown>,
    existingSelection: string[],
  ): Promise<{ all: SignalOption[]; selected: string[] }> => {
    const fallbackResponse = await fetch(endpoint);
    const fallbackPayload = fallbackResponse.ok ? await fallbackResponse.json() as { all?: SignalOption[] } : {};
    const all = fallbackPayload.all ?? [];

    if (existingSelection.length > 0) {
      return { all, selected: existingSelection };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!response?.ok) {
      return { all, selected: [] };
    }

    const payload = await response.json() as { all?: SignalOption[]; recommended?: SignalOption[] };
    return {
      all: payload.all ?? all,
      selected: (payload.recommended ?? []).map((signal) => signal.id),
    };
  }, []);

  /** Fetches recommended IDs and merges into refs + panel only (no phase change / no narration). */
  const applyRecommendedSignalsSilently = useCallback(async () => {
    const companyCatalog = await loadSignalsCatalog('/api/recommend-signals', {
      companyType: companyRef.current.companyType,
      platformCategory: visiblePlatformCategory(companyRef.current.companyType, companyRef.current.platformCategory),
      companySizes: companyRef.current.companySizes,
      therapeuticAreas: companyRef.current.therapeuticAreas,
      modalities: companyRef.current.modalities,
      developmentStages: companyRef.current.developmentStages,
      fundingStages: companyRef.current.fundingStages,
    }, companyRef.current.signals);
    companyRef.current.signals = companyCatalog.selected;
    setPanelCompany((prev) => ({ ...prev, signals: companyCatalog.selected }));
  }, [loadSignalsCatalog]);

  // ── Save persona (and persist ICP + contact rows) ─────────────────────────

  const savePersona = useCallback(async () => {
    setPhase('persona_saving');
    setBuyingTeamEditMode(false);
    await applyRecommendedSignalsSilently();
    const p = personaRef.current;

    const personaName =
      p.functions.length > 0 ? `Buying group: ${p.functions[0]}` : 'Buying group';
    setSavedPersonaName(personaName);

    if (icpIdRef.current) {
      await fetch(`/api/company-criteria/${icpIdRef.current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: savedIcpName || `${companyRef.current.companyType} Profile`,
          companyType: companyRef.current.companyType,
          platformCategory: visiblePlatformCategory(companyRef.current.companyType, companyRef.current.platformCategory),
          therapeuticAreas: companyRef.current.therapeuticAreas,
          modalities: companyRef.current.modalities,
          developmentStages: companyRef.current.developmentStages,
          customerTherapeuticAreas: companyRef.current.customerTherapeuticAreas,
          customerModalities: companyRef.current.customerModalities,
          customerDevelopmentStages: companyRef.current.customerDevelopmentStages,
          companySizes: companyRef.current.companySizes,
          liFollowerSizes: companyRef.current.liFollowerSizes,
          fundingStages: companyRef.current.fundingStages,
          signals: companyRef.current.signals,
          exampleCompanyUrl: enrichedTargetCompany?.website ?? lastTargetUrlRef.current ?? '',
          exampleCompanyEnrichment: enrichedTargetCompany ?? undefined,
          targetCustomers: companyRef.current.targetCustomers,
          buyerTypes: companyRef.current.buyerTypes,
          competitors: companyRef.current.competitors,
        }),
      }).catch(() => null);
    }

    const personaPayload = {
      name: personaName,
      functions: p.functions,
      seniorityLevels: p.seniority,
      jobTitles: p.jobTitles,
      icpId: icpIdRef.current,
    };

    const personaRes = await fetch(
      personaIdRef.current ? `/api/contacts/${personaIdRef.current}` : '/api/contacts',
      {
        method: personaIdRef.current ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(personaPayload),
      },
    );
    if (personaRes.ok) {
      const saved = await personaRes.json();
      const row = saved?.data ?? saved;
      personaIdRef.current = typeof row?.id === 'string' ? row.id : null;
    }

    // Claude wrap-up
    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content:
          '[System: setup for this flow is complete. Brief congratulations: they can import contacts next, and add company profiles or edit this buying group anytime. Max 2 short sentences. Do not use the words signal or signals.]',
      },
    });
    if (displayParts.length) await sayBeats(displayParts);

    setPhase('done');
    setTimeout(() => router.push(resolvedCompletePath), 2500);
  }, [applyRecommendedSignalsSilently, askClaude, enrichedTargetCompany, lastTargetUrlRef, resolvedCompletePath, router, savedIcpName]); // eslint-disable-line react-hooks/exhaustive-deps

  const startBuyingGroupForCompany = useCallback(async (co: TargetCompanyProfile) => {
    selectedCompanyRef.current = co;
    icpIdRef.current = co.id;

    const nextCompanyState = {
      companyType: co.company_type || '',
      platformCategory: visiblePlatformCategory(co.company_type || '', co.platform_category || ''),
      companySizes: co.company_sizes || [],
      liFollowerSizes: (co as unknown as Record<string, unknown>).li_follower_sizes as string[] || [],
      therapeuticAreas: co.therapeutic_areas || [],
      modalities: co.modalities || [],
      developmentStages: co.development_stages || [],
      customerTherapeuticAreas: (co as unknown as Record<string, unknown>).customer_therapeutic_areas as string[] || [],
      customerModalities: (co as unknown as Record<string, unknown>).customer_modalities as string[] || [],
      customerDevelopmentStages: (co as unknown as Record<string, unknown>).customer_development_stages as string[] || [],
      fundingStages: co.funding_stages || [],
      signals: normalizeOrderedSignalIds((co as unknown as Record<string, unknown>).signals),
      targetCustomers: co.target_customers ?? [],
      buyerTypes: co.buyer_types ?? [],
      competitors: (co.competitors ?? []) as import('@/components/SetupProfilePanel').CompetitorItem[],
    };

    companyRef.current = nextCompanyState;
    setPanelCompany(nextCompanyState);
    setSavedIcpName(co.name || '');

    const exampleCompanyName = co.example_company_enrichment?.company_name || co.name || 'this company profile';
    setReviewedCompanyName(exampleCompanyName);
    setEnrichedTargetCompany((co.example_company_enrichment as TargetCompanyEnrichmentResult | null | undefined) ?? null);

    const analysesRes = await fetch('/api/user-company');
    const existingAnalysis = analysesRes.ok ? ((await analysesRes.json())?.analyses?.[0] ?? null) : null;
    if (existingAnalysis) {
      setEditingFindingsData(existingAnalysis as Record<string, unknown>);
      const storedWebsite = (existingAnalysis as Record<string, unknown>).website;
      if (typeof storedWebsite === 'string' && storedWebsite) {
        lastAnalyzedUrlRef.current = storedWebsite;
      }
    }

    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: `[System: the user picked "${co.name}" and needs a buying team. One sentence: acknowledge the profile and say you're generating buying team suggestions now.]`,
      },
    });
    if (displayParts.length) await sayBeats(displayParts);

    setPhase('buying_team_loading');

    const sellerData = (existingAnalysis as Record<string, unknown> | null) ?? {};
    const btRes = await fetch('/api/generate-buying-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seller_company_name: sellerData.company_name,
        seller_company_type: sellerData.company_type,
        seller_platform_category: visiblePlatformCategory(sellerData.company_type as string | null | undefined, sellerData.platform_category as string | null | undefined),
        seller_therapeutic_areas: sellerData.therapeutic_areas,
        seller_products_services: sellerData.products_services,
        seller_services: sellerData.services,
        seller_customers_we_serve: sellerData.customers_we_serve,
        seller_value_propositions: sellerData.value_propositions,
        icp_company_type: nextCompanyState.companyType,
        icp_platform_category: visiblePlatformCategory(nextCompanyState.companyType, nextCompanyState.platformCategory),
        icp_therapeutic_areas: nextCompanyState.therapeuticAreas,
        icp_modalities: nextCompanyState.modalities,
        icp_development_stages: nextCompanyState.developmentStages,
        icp_company_sizes: nextCompanyState.companySizes,
        ...icContextForBuyingTeam(
          nextCompanyState,
          co.example_company_enrichment as TargetCompanyEnrichmentResult | null | undefined,
        ),
        example_company_name: co.example_company_enrichment?.company_name || undefined,
      }),
    }).catch(() => null);

    if (btRes?.ok) {
      const btData = await btRes.json() as { functions?: string[]; seniority_levels?: string[]; job_titles?: string[] };
      const fns = btData.functions ?? [];
      const sens = btData.seniority_levels ?? [];
      const titles = btData.job_titles ?? [];
      personaRef.current.functions = fns;
      personaRef.current.seniority = sens;
      personaRef.current.jobTitles = titles;
      setPanelPersona({ functions: fns, seniority: sens, jobTitles: titles, signals: personaRef.current.signals });
      setBuyingTeamEditMode(false);
      setChipSel([]);
      setPhase('buying_team_review');
      setInput(false);

      const { displayParts: reviewParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content: `[System: buying team suggestions for "${co.name}" are ready. One sentence: tell the user the buying team is pre-filled in the card on the right and they can select or deselect the pills to adjust it before confirming.]`,
        },
      });
      if (reviewParts.length) await sayBeats(reviewParts);
      return;
    }

    const { displayParts: fallbackParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: `[System: buying team suggestions could not be generated automatically for "${co.name}". One short sentence: say they'll define the buying group manually below.]`,
      },
    });
    if (fallbackParts.length) await sayBeats(fallbackParts);
    setPhase('persona_functions');
    setInput(true);
  }, [askClaude]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle chip selection ─────────────────────────────────────────────────

  const handleChipToggle = (value: string, multi: boolean) => {
    if (!multi) {
      // Single-select: immediately advance
      handleContinue([value]);
      return;
    }
    setChipSel((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  };

  const handleContinue = useCallback((selection: string[]) => {
    // Store into refs and mirror into panel state for live rendering
    switch (phase) {
      case 'company_type':
        companyRef.current.companyType = selection[0] ?? '';
        setPanelCompany((p) => ({ ...p, companyType: selection[0] ?? '' }));
        break;
      case 'company_size':
        companyRef.current.companySizes = selection;
        setPanelCompany((p) => ({ ...p, companySizes: selection }));
        break;
      case 'company_ta':
        companyRef.current.therapeuticAreas = selection;
        setPanelCompany((p) => ({ ...p, therapeuticAreas: selection }));
        break;
      case 'company_modality':
        companyRef.current.modalities = selection;
        setPanelCompany((p) => ({ ...p, modalities: selection }));
        break;
      case 'company_stage':
        companyRef.current.developmentStages = selection;
        setPanelCompany((p) => ({ ...p, developmentStages: selection }));
        break;
      case 'company_funding':
        companyRef.current.fundingStages = selection;
        setPanelCompany((p) => ({ ...p, fundingStages: selection }));
        break;
      case 'persona_functions':
        personaRef.current.functions = selection;
        setPanelPersona((p) => ({ ...p, functions: selection }));
        break;
      case 'persona_seniority':
        personaRef.current.seniority = selection;
        setPanelPersona((p) => ({ ...p, seniority: selection }));
        break;
    }

    // Record user selection as a bubble
    if (selection.length > 0) pushText('user', selection.join(', '));

    // Phase transitions
    (async () => {
      switch (phase) {
        case 'company_type': await advanceTo('company_size'); break;
        case 'company_size': await advanceTo('company_ta'); break;
        case 'company_ta': await advanceTo('company_modality'); break;
        case 'company_modality': await advanceTo('company_stage'); break;
        case 'company_stage': await advanceTo('company_funding'); break;
        case 'company_funding': await saveIcp(); break;
        case 'persona_functions': await advanceTo('persona_seniority'); break;
        case 'persona_seniority': {
          const personaName =
            personaRef.current.functions.length > 0 ? `Buying group: ${personaRef.current.functions[0]}` : 'Buying group';
          setSavedPersonaName(personaName);
          const { displayParts } = await askClaude({
            mode: 'narration',
            extra: {
              role: 'user',
              content:
                '[System: the user finished picking teams and seniority manually. One sentence: confirm the summary is on the card and they should tap Looks right when it matches, or tweak the pills first.]',
            },
          });
          if (displayParts.length) await sayBeats(displayParts);
          setBuyingTeamEditMode(false);
          setChipSel([]);
          setPhase('buying_team_review');
          setInput(false);
          break;
        }
      }
    })();
  }, [phase, advanceTo, saveIcp, askClaude, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ICP suggestions: fire-and-forget after own-company analysis ───────────

  const generateIcpSuggestions = useCallback(async (enrichmentData: Record<string, unknown>): Promise<IcpSuggestion[]> => {
    try {
      const res = await fetch('/api/suggest-icp-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: enrichmentData.company_name,
          description: enrichmentData.description,
          products_services: enrichmentData.products_services,
          services: enrichmentData.services,
          target_customers: enrichmentData.target_customers,
          customers_we_serve: enrichmentData.customers_we_serve,
          good_fit: enrichmentData.good_fit,
          therapeutic_areas: enrichmentData.therapeutic_areas,
          modalities: enrichmentData.modalities,
          company_type: enrichmentData.company_type,
        }),
      });
      if (!res.ok) return [];
      const { suggestions } = await res.json() as { suggestions: IcpSuggestion[] };
      if (Array.isArray(suggestions) && suggestions.length > 0) {
        setIcpSuggestions(suggestions);
        saveStoredSuggestions(suggestions);
      }
      return suggestions ?? [];
    } catch {
      // Non-fatal — fall back to manual URL entry
      return [];
    }
  }, []);

  // ── Handle analysis results confirmed ────────────────────────────────────

  const handleResultsConfirmed = useCallback(async () => {
    pushText('user', 'Looks good');
    setThread((p) => p.filter((m) => m.kind !== 'results'));

    if (entryPoint === 'company-only') {
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content:
            '[System: the user confirmed their updated company profile looks right. One short sentence: confirm the profile is saved and they are all set — no praise, just a calm warm confirmation.]',
        },
      });
      if (displayParts.length) await sayBeats(displayParts);
      setPhase('done');
      setTimeout(() => router.push(resolvedCompletePath), 1800);
      return;
    }

    // If ICPs already exist (e.g. user deleted their company but kept their target profiles),
    // skip the target-company and buying-team steps — they don't need to redo them.
    if (icpIdRef.current !== null) {
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content:
            "[System: the user confirmed their updated company profile. I can see they already have target company profiles and buying teams set up — no need to redo those steps. One sentence: confirm the profile is saved and they're all set, and you're sending them back to their workspace.]",
        },
      });
      if (displayParts.length) await sayBeats(displayParts);
      setPhase('done');
      setTimeout(() => router.push(ROUTES.leads.accounts), 1800);
      return;
    }

    // Resolve suggested target accounts: in-memory, then localStorage (background API may have
    // finished after "Looks good"), then await API so copy about "suggestions below" matches the UI.
    let resolvedSuggestions = icpSuggestions.filter(
      (s) => typeof s.name === 'string' && s.name.trim().length > 0 && typeof s.domain === 'string' && s.domain.trim().length > 0,
    );
    if (resolvedSuggestions.length === 0) {
      resolvedSuggestions = unenrolledSuggestions();
    }
    const sellerProfile = editingFindingsData;
    if (
      resolvedSuggestions.length === 0
      && sellerProfile
      && typeof sellerProfile === 'object'
      && Object.keys(sellerProfile).length > 0
    ) {
      resolvedSuggestions = await generateIcpSuggestions(sellerProfile as Record<string, unknown>);
    }
    if (resolvedSuggestions.length > 0) {
      setIcpSuggestions(resolvedSuggestions);
      const companyName = (editingFindingsData?.company_name as string | undefined) ?? 'your company';
      const segmentList = resolvedSuggestions.map((s) => `${s.name} (${s.segmentLabel})`).join(', ');
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content:
            `[System: the user confirmed their company profile for ${companyName}. 4-6 short sentences max, no em dashes, no long essay. ` +
            `(1) Brief ack the profile looks good. ` +
            `(2) One line on purpose: we are defining ideal target accounts, real companies they want as customers. ` +
            `(3) Example companies that illustrate different buyer types: ${segmentList}. ` +
            `(4) They can tap one to start or paste their own URL. ` +
            `(5) If they are not sure, say we suggested those options from their company and they can use one of those picks.]`,
        },
      });
      if (displayParts.length) await sayBeats(displayParts);
      setPhase('icp_suggestion');
      setInput(true);
      return;
    }

    historyRef.current = [...historyRef.current, { role: 'user', content: 'Looks good' }];
    setPhase('customer_url_conversation');
    setInput(false);
    const { displayParts: targetIntroParts } = await askClaude({
      mode: 'narration',
      extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
    });
    if (targetIntroParts.length) await sayBeats(targetIntroParts);
    setInput(true);
  }, [askClaude, editingFindingsData, entryPoint, icpSuggestions, generateIcpSuggestions, resolvedCompletePath, router, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps

  const getLatestResultsData = useCallback((): Record<string, unknown> | null => {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const message = thread[i];
      if (message.kind === 'results') return message.data;
    }
    return null;
  }, [thread]);

  /** If background suggest-icp finished after we navigated, pull from localStorage into state so pills render. */
  useEffect(() => {
    if (phase !== 'customer_url_conversation' && phase !== 'icp_suggestion') return;
    if (icpSuggestions.length > 0) return;
    const stored = unenrolledSuggestions();
    if (stored.length > 0) setIcpSuggestions(stored);
  }, [phase, icpSuggestions.length]);

  // ── Progress step navigation ──────────────────────────────────────────────

  const handleGoToStep = useCallback(async (stepIndex: number) => {
    if (stepIndex === 0) {
      const latestProfile = editingFindingsData ?? getLatestResultsData();
      const rec = latestProfile && typeof latestProfile === 'object'
        ? (latestProfile as Record<string, unknown>)
        : null;
      const hasCompanyProfile = Boolean(
        rec
        && (typeof rec.id === 'string'
          || (typeof rec.company_name === 'string' && rec.company_name.trim().length > 0)
          || (typeof rec.website === 'string' && rec.website.trim().length > 0)),
      );

      if (hasCompanyProfile && rec) {
        setEditingFindingsData({ ...rec });
        setEditingFindings(false);
        setPhase('analysis_results');
        setInput(false);
        return;
      }

      // No saved profile yet: restart URL capture
      icpIdRef.current = null;
      setPhase('greeting');
      setInput(true);
    } else if (stepIndex === 1) {
      const hasTargetReview =
        enrichedTargetCompany != null
        || icpIdRef.current != null
        || (Boolean(lastTargetUrlRef.current)
          && (Boolean(reviewedCompanyName?.trim()) || Boolean(companyRef.current.companyType)));

      if (hasTargetReview) {
        setIcpEditMode(false);
        setPhase('customer_url_review');
        setInput(false);
      } else {
        let resolvedSuggestions = icpSuggestions.filter(
          (s) => typeof s.name === 'string' && s.name.trim().length > 0 && typeof s.domain === 'string' && s.domain.trim().length > 0,
        );
        if (resolvedSuggestions.length === 0) {
          resolvedSuggestions = unenrolledSuggestions();
        }
        const profile = editingFindingsData ?? getLatestResultsData();
        if (
          resolvedSuggestions.length === 0
          && profile
          && typeof profile === 'object'
          && Object.keys(profile).length > 0
        ) {
          resolvedSuggestions = await generateIcpSuggestions(profile as Record<string, unknown>);
        }
        if (resolvedSuggestions.length > 0) {
          setIcpSuggestions(resolvedSuggestions);
          setPhase('icp_suggestion');
          setInput(true);
        } else {
          setPhase('customer_url_conversation');
          setInput(false);
          const { displayParts: targetIntroParts } = await askClaude({
            mode: 'narration',
            extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
          });
          if (targetIntroParts.length) await sayBeats(targetIntroParts);
          setInput(true);
        }
      }
    } else if (stepIndex === 2) {
      setPhase('buying_team_review');
      setInput(false);
    }
  }, [editingFindingsData, enrichedTargetCompany, generateIcpSuggestions, getLatestResultsData, icpSuggestions, reviewedCompanyName, askClaude, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleResumeRestart = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm(START_AGAIN_CONFIRM)) return;

    let resetOk = false;
    try {
      const res = await fetch('/api/setup-reset', { method: 'POST' });
      resetOk = res.ok;
      if (!res.ok) {
        console.error('[setup-flow] setup-reset failed:', await res.text().catch(() => ''));
      }
    } catch (e) {
      console.error('[setup-flow] setup-reset:', e);
    }

    if (!resetOk) {
      await say('We could not wipe your setup on the server. Check your connection and try again.');
      return;
    }

    clearStoredIcpSuggestionState();

    // Reset all local state
    setPendingTransition(null);
    setAnalysisError('');
    setIcpSuggestions([]);
    setChipSel([]);
    setBuyingTeamEditMode(false);
    setIcpEditMode(false);
    setOwnCompanyAnalysisInFlight(false);
    setSavingFindings(false);
    personaIdRef.current = null;
    icpIdRef.current = null;
    lastTargetUrlRef.current = null;
    lastAnalyzedUrlRef.current = null;
    selectedCompanyRef.current = null;
    setEnrichedTargetCompany(null);
    setReviewedCompanyName('');
    setReviewDraft({ companyType: '', platformCategory: '', therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], companySizes: [], liFollowerSizes: [], fundingStages: [] });
    setSavedIcpName('');
    setSavedPersonaName('');
    setPanelCompany({ companyType: '', platformCategory: '', companySizes: [], liFollowerSizes: [], therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], fundingStages: [], signals: [], targetCustomers: [], buyerTypes: [], competitors: [] });
    setPanelPersona({ functions: [], seniority: [], jobTitles: [], signals: [] });
    companyRef.current = { companyType: '', platformCategory: '', companySizes: [], liFollowerSizes: [], therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], fundingStages: [], signals: [], targetCustomers: [], buyerTypes: [], competitors: [] };
    personaRef.current = { functions: [], seniority: [], jobTitles: [], signals: [] };
    setEditingFindings(false);
    setEditingFindingsData(null);
    setThread([]);
    historyRef.current = [];
    setOwnEnrichLinkedinWait(false);
    setOwnEnrichSynthesisWait(false);
    setCustomerUrlLinkedinWait(false);
    setCustomerUrlSynthesisWait(false);
    setPartialOwnEnrichment(null);
    setPartialTargetEnrichment(null);
    setOwnEnrichStep(0);
    setTargetEnrichStep(0);
    setInputVal('');
    resetSetupStepUrlSyncRefs();

    // Jump to greeting before the onboarding API toggles thinking — avoids the dark interim shell
    // (`thinking && thread.length === 0`) while phase was still analysis_results.
    setPhase('greeting');
    setInput(false);

    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: '[System: the user wants to start fresh. One sentence: acknowledge and ask them to enter their company website URL to begin.]',
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
    setInput(true);
  }, [askClaude, say, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle LLM-surfaced transition confirmation ───────────────────────────

  const handleConfirmTransition = useCallback(async () => {
    const t = pendingTransition;
    setPendingTransition(null);
    if (!t) return;

    switch (t.target) {
      case 'restart':
        await handleResumeRestart();
        break;
      case 'proceed_to_customer_url':
        setPhase('customer_url_conversation');
        setInput(false);
        {
          const { displayParts: targetIntroParts } = await askClaude({
            mode: 'narration',
            extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
          });
          if (targetIntroParts.length) await sayBeats(targetIntroParts);
          setInput(true);
        }
        break;
      case 'confirm_own_company':
        await handleResultsConfirmed();
        break;
    }
  }, [pendingTransition, handleResumeRestart, handleResultsConfirmed, askClaude, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle customer URL analysis (ICP step) ──────────────────────────────

  const handleCustomerUrlAnalyse = useCallback(async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    lastTargetUrlRef.current = normalized;
    setInput(false);
    setPhase('customer_url_loading');

    setCustomerUrlLoadMsg('Researching the company…');
    setPartialTargetEnrichment(null);
    setTargetEnrichStep(0);
    customerUrlStep2AnchorRef.current = null;
    setCustomerUrlLinkedinWait(false);
    setCustomerUrlAwaitingLinkedinEvent(false);
    setCustomerUrlSynthesisWait(false);

    try {
      const res = await fetch('/api/analyze-example-company-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      });
      if (!res.ok) throw new Error('Analysis failed');

      let data: import('@/lib/target-company-enrichment').TargetCompanyEnrichmentResult | null = null;
      for await (const { event, data: eventData } of parseSSEStream(res)) {
        if (event === 'step_claude') {
          setCustomerUrlLoadMsg('Website analysed ✓ Verifying firm details…');
          setTargetEnrichStep(1);
          setPartialTargetEnrichment({
            company_name: (eventData.company_name as string) || null,
            description: Array.isArray(eventData.description) ? (eventData.description as string[]) : null,
          });
        } else if (event === 'step_apollo') {
          customerUrlStep2AnchorRef.current = Date.now();
          setCustomerUrlAwaitingLinkedinEvent(true);
          setCustomerUrlLoadMsg(TARGET_ICP_LINKEDIN_LOOKUP_LINES[0]);
          setTargetEnrichStep(2);
          setPartialTargetEnrichment((prev) => ({
            ...prev,
            employee_count: typeof eventData.company_employee_count === 'number' ? eventData.company_employee_count : null,
            industry: (eventData.company_industry as string) || null,
            hq_city: (eventData.company_hq_city as string) || null,
            hq_country: (eventData.company_hq_country as string) || null,
            founded_year: typeof eventData.company_founded_year === 'number' ? eventData.company_founded_year : null,
            funding_stage: (eventData.company_funding_stage as string) || null,
          }));
        } else if (event === 'step_linkedin') {
          setCustomerUrlAwaitingLinkedinEvent(false);
          const found = Boolean(eventData.linkedin_found);
          setCustomerUrlLinkedinWait(found);
          setCustomerUrlSynthesisWait(false);
          if (found) {
            setCustomerUrlLoadMsg(TARGET_ICP_LINKEDIN_SCRAPE_LINES[0]);
          } else {
            setCustomerUrlLoadMsg('No strong public profile signal ✓ Continuing with web and available records…');
          }
        } else if (event === 'step_apify') {
          customerUrlStep2AnchorRef.current = null;
          setCustomerUrlLinkedinWait(false);
          setCustomerUrlLoadMsg('Sources merged ✓ Shaping the profile…');
          setTargetEnrichStep(3);
          setPartialTargetEnrichment((prev) => ({
            ...prev,
            logo_url: (eventData.logo_url as string) || null,
            tagline: (eventData.tagline as string) || null,
            follower_count: typeof eventData.follower_count === 'number' ? eventData.follower_count : null,
          }));
        } else if (event === 'step_synthesis') {
          setCustomerUrlSynthesisWait(true);
          setCustomerUrlLoadMsg(TARGET_ICP_SYNTHESIS_LINES[0]);
        } else if (event === 'step_taxonomy') {
          setCustomerUrlSynthesisWait(false);
          setCustomerUrlLoadMsg('Profile shaped ✓ Finishing up…');
          setTargetEnrichStep(4);
        } else if (event === 'done') {
          data = eventData as unknown as import('@/lib/target-company-enrichment').TargetCompanyEnrichmentResult;
        } else if (event === 'error') {
          throw new Error((eventData.message as string) || 'Analysis failed');
        }
      }
      if (!data) throw new Error('Analysis failed');
      const name = data.company_name || normalized.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
      setReviewedCompanyName(name);
      setEnrichedTargetCompany(data);

      const enrichmentSegments = resolveCustomerSegments({
        targetCustomers: data.target_customers,
        customersWeServe: data.customers_we_serve,
        fallbackItems: data.customers_we_serve,
      });
      const draft = {
        companyType: data.company_type ?? '',
        platformCategory: visiblePlatformCategory(data.company_type ?? '', data.platform_category ?? ''),
        therapeuticAreas: data.therapeutic_areas ?? [],
        modalities: data.modalities ?? [],
        developmentStages: data.development_stages ?? [],
        customerTherapeuticAreas: data.customer_therapeutic_areas ?? [],
        customerModalities: data.customer_modalities ?? [],
        customerDevelopmentStages: data.customer_development_stages ?? [],
        companySizes: employeeCountToSizeBucket(data.employee_count, data.employee_range),
        liFollowerSizes: followerCountToFollowerBucket(data.follower_count),
        fundingStages: (() => { const s = canonicalizeFundingStage(data.funding_stage, data.total_funding_usd); return s ? [s] : []; })(),
        targetCustomers: enrichmentSegments.customerOrganizations,
        buyerTypes: enrichmentSegments.buyerTypes,
        competitors: data.competitors_enriched ?? [],
      };
      setReviewDraft(draft);
      companyRef.current = { ...companyRef.current, ...draft };
      setPanelCompany((prev) => ({ ...prev, ...draft }));

      // Generate the ICP name now so it shows in the panel immediately
      const nameRes = await fetch('/api/generate-icp-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          exampleCompanyName: data.company_name ?? name,
          exampleCompanyDescription: data.description ?? undefined,
        }),
      });
      const { name: icpName } = nameRes.ok ? await nameRes.json() : { name: `${draft.companyType || 'Target'} Profile` };
      setSavedIcpName(icpName);

      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content: `[System: analysis of the customer company "${name}" is complete and we've auto-generated an ICP profile from it. One sentence: the draft profile is ready in this step so they can tweak anything before saving or save it as is. Do not mention a left or right panel or sidebar.]`,
        },
      });
      if (displayParts.length) await sayBeats(displayParts);

      setPhase('customer_url_review');
      setInput(true);
    } catch {
      await say("Couldn't analyse that URL — check it's correct and try again.");
      setPhase('customer_url_conversation');
      setInput(true);
    }
  }, [askClaude]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle own-company analysis ───────────────────────────────────────────

  const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  const cancelAnalysis = useCallback(() => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalysisError('');
    setInput(true);
    setLoadMsg('');
    setCustomerUrlLoadMsg('');
    setPartialOwnEnrichment(null);
    setPartialTargetEnrichment(null);
    setOwnEnrichStep(0);
    setTargetEnrichStep(0);
    setOwnEnrichLinkedinWait(false);
    setOwnEnrichAwaitingLinkedinEvent(false);
    ownCompanyStep2AnchorRef.current = null;
    setOwnEnrichSynthesisWait(false);
    setCustomerUrlLinkedinWait(false);
    setCustomerUrlAwaitingLinkedinEvent(false);
    customerUrlStep2AnchorRef.current = null;
    setCustomerUrlSynthesisWait(false);
    if (phase === 'customer_url_loading') {
      setPhase('customer_url_conversation');
      return;
    }
    if (phase === 'analysis_results') {
      setOwnCompanyAnalysisInFlight(false);
      setLoadMsg('');
      setPartialOwnEnrichment(null);
      setOwnEnrichStep(0);
      ownCompanyStep2AnchorRef.current = null;
      setOwnEnrichLinkedinWait(false);
      setOwnEnrichAwaitingLinkedinEvent(false);
      setOwnEnrichSynthesisWait(false);
      setInput(true);
      return;
    }
    // Clear thread so welcome card is shown again (hasUserMsg → false)
    setThread([]);
    setPhase('greeting');
  }, [phase]);

  const runAnalysis = useCallback(async (url: string, isReenrich = false) => {
    const trimmed = url.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    lastAnalyzedUrlRef.current = normalized;
    setThread((p) => p.filter((m) => m.kind !== 'results'));
    setAnalysisError('');
    setInput(false);

    // Re-enrich: keep the phase as-is so cards 2 & 3 stay in their completed state.
    // Fresh analysis: drive the phase through the loading screen.
    if (!isReenrich) setPhase('analysis_loading');

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

    setLoadMsg('Researching your company…');
    setPartialOwnEnrichment(null);
    setOwnEnrichStep(0);
    ownCompanyStep2AnchorRef.current = null;
    setOwnEnrichLinkedinWait(false);
    setOwnEnrichAwaitingLinkedinEvent(false);
    setOwnEnrichSynthesisWait(false);

    setOwnCompanyAnalysisInFlight(true);
    try {
      const res = await fetch('/api/analyze-and-store-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: normalized }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Keep analysisAbortRef alive through the SSE loop so Stop can cancel mid-stream.
      if (!res.ok) throw new Error('Analysis failed');

      let data: Record<string, unknown> | null = null;
      for await (const { event, data: eventData } of parseSSEStream(res)) {
        if (controller.signal.aborted) return;
        if (event === 'step_claude') {
          setLoadMsg('Website analysed ✓ Verifying firm details…');
          setOwnEnrichStep(1);
          setPartialOwnEnrichment({
            company_name: (eventData.company_name as string) || null,
            description: Array.isArray(eventData.description) ? eventData.description : null,
          });
        } else if (event === 'step_apollo') {
          ownCompanyStep2AnchorRef.current = Date.now();
          setOwnEnrichAwaitingLinkedinEvent(true);
          setLoadMsg(ENRICH_GENERIC_LOOKUP_LINES[0]);
          setOwnEnrichStep(2);
          setPartialOwnEnrichment((prev) => ({
            ...prev,
            employee_count: typeof eventData.company_employee_count === 'number' ? eventData.company_employee_count : null,
            industry: (eventData.company_industry as string) || null,
            hq_city: (eventData.company_hq_city as string) || null,
            hq_country: (eventData.company_hq_country as string) || null,
            funding_stage: (eventData.company_funding_stage as string) || null,
          }));
        } else if (event === 'step_linkedin') {
          setOwnEnrichAwaitingLinkedinEvent(false);
          const found = Boolean(eventData.linkedin_found);
          setOwnEnrichLinkedinWait(found);
          setOwnEnrichSynthesisWait(false);
          if (found) {
            setLoadMsg(ENRICH_GENERIC_DEEP_GATHER_LINES[0]);
          } else {
            setLoadMsg('No strong public profile signal ✓ Continuing with web and available records…');
          }
        } else if (event === 'step_apify') {
          ownCompanyStep2AnchorRef.current = null;
          setOwnEnrichLinkedinWait(false);
          setLoadMsg('Sources merged ✓ Shaping the profile…');
          setOwnEnrichStep(3);
          setPartialOwnEnrichment((prev) => ({
            ...prev,
            logo_url: (eventData.logo_url as string) || null,
            tagline: (eventData.tagline as string) || null,
            follower_count: typeof eventData.follower_count === 'number' ? eventData.follower_count : null,
          }));
        } else if (event === 'step_synthesis') {
          setOwnEnrichSynthesisWait(true);
          setLoadMsg(ENRICH_GENERIC_SYNTHESIS_LINES[0]);
        } else if (event === 'step_taxonomy') {
          setOwnEnrichSynthesisWait(false);
          setLoadMsg('Profile shaped ✓ Finishing up…');
          setOwnEnrichStep(4);
        } else if (event === 'done') {
          data = eventData;
        } else if (event === 'error') {
          throw new Error((eventData.message as string) || 'Analysis failed');
        }
      }
      if (!data) {
        throw new Error(
          'Analysis did not finish. If this keeps happening, try again or use a different network.',
        );
      }

      // Stream done — clear the ref and bail if user cancelled during SSE
      analysisAbortRef.current = null;
      if (controller.signal.aborted) return;

      setEditingFindings(false);
      setEditingFindingsData(data);

      try {
        const narrationPrompt = isReenrich
          ? `[System: re-enrichment of ${data.company_name ?? normalized} is complete. Give a single short sentence confirming the company profile has been refreshed with the latest data, no reaction, no praise, just a calm factual update.]`
          : `[System: analysis of ${normalized} is complete. Company: ${data.company_name ?? normalized}. One short warm sentence: the enriched profile is ready in this step. They can review the details, adjust anything that looks off, then tap Looks right when they are happy. Do not mention a left or right panel or sidebar.]`;
        const { displayParts } = await askClaude({
          mode: 'narration',
          extra: { role: 'user', content: narrationPrompt },
        });
        if (displayParts.length) await sayBeats(displayParts);
      } catch {
        await say('Your company profile is ready in this step. Review the details and tap Looks right when you are happy.');
      }

      if (controller.signal.aborted) return;

      // Keep results on the thread for data + history; UI shows them in the side panel only.
      setThread((p) => [...p, { id: crypto.randomUUID(), kind: 'results', data }]);
      if (!isReenrich) setPhase('analysis_results');
      setInput(true);

      // Fire ICP suggestions in background while user reviews their company card.
      if (!isReenrich) void generateIcpSuggestions(data);

    } catch (err) {
      clearTimeout(timeout);
      analysisAbortRef.current = null;
      // Aborted (user cancel or timeout) — reset silently, don't show an error
      if (err instanceof Error && err.name === 'AbortError') {
        if (!isReenrich) setPhase('greeting');
        setInput(true);
        return;
      }

      const saved = await fetchLatestUserCompanyRow();
      if (saved && typeof saved.id === 'string') {
        setEditingFindingsData(saved);
        setEditingFindings(false);
        setThread((p) => {
          const withoutResults = p.filter((m) => m.kind !== 'results');
          return [...withoutResults, { id: crypto.randomUUID(), kind: 'results', data: saved }];
        });
        setPhase('analysis_results');
        setInput(true);
        const detail =
          err instanceof Error && err.message ? err.message.slice(0, 280) : 'Something went wrong.';
        setAnalysisError(
          `We could not refresh from the web. Your saved company profile is still shown. (${detail})`,
        );
        return;
      }

      setAnalysisError(
        err instanceof Error && err.name !== 'AbortError' && err.message
          ? err.message.slice(0, 500)
          : "Couldn't analyse that website, maybe it's blocking us. Try another URL.",
      );
      if (!isReenrich) { setPhase('greeting'); setInput(true); }
    } finally {
      setOwnCompanyAnalysisInFlight(false);
    }
  }, [askClaude, formatFindingsSummary, generateIcpSuggestions, say, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReanalyseFromPanel = useCallback(() => {
    const u = lastAnalyzedUrlRef.current;
    if (u) void runAnalysis(u, true);
  }, [runAnalysis]);

  const handleMyCompanyChange = useCallback((
    field: keyof import('@/components/SetupProfilePanel').PanelMyCompanyData,
    value: import('@/components/SetupProfilePanel').MyCompanyChangeValue,
  ) => {
    const keyMap: Partial<Record<string, string>> = {
      description: 'description',
      customersWeServe: 'customers_we_serve',
      goodFit: 'good_fit',
      badFit: 'bad_fit',
      valuePropositions: 'value_propositions',
      companyType: 'company_type',
      companyTypeDisplay: 'company_type_display',
      platformCategory: 'platform_category',
      therapeuticAreas: 'therapeutic_areas',
      modalities: 'modalities',
      developmentStages: 'development_stages',
      productsServices: 'products_services',
      services: 'services',
      technologies: 'technologies',
      competitorsEnriched: 'competitors_enriched',
      employeeCount: 'employee_count',
      employeeRange: 'employee_range',
      followerCount: 'follower_count',
      foundedYear: 'founded_year',
      fundingStage: 'funding_stage',
      totalFundingUsd: 'total_funding_usd',
      hqCity: 'hq_city',
      hqCountry: 'hq_country',
      companyStatus: 'company_status',
      industry: 'industry',
      companyName: 'company_name',
      website: 'website',
      tagline: 'tagline',
      linkedinUrl: 'linkedin_url',
    };
    const rawKey = keyMap[field as string] ?? field;
    setEditingFindingsData((prev) => ({ ...(prev ?? {}), [rawKey]: value }));
  }, []);

  const handleAnalysisNotRight = useCallback(async () => {
    const current = editingFindingsData ?? getLatestResultsData();
    preEditDataRef.current = current;
    setEditingFindingsData(current);
    setEditingFindings(true);
    await say('Sure — edit any fields directly in the panel on the right, then hit Save when you\'re done.');
  }, [editingFindingsData, getLatestResultsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteCompanyProfile = useCallback(async () => {
    resetSetupStepUrlSyncRefs();
    const data = editingFindingsData ?? getLatestResultsData();
    const id = typeof data?.id === 'string' ? data.id : null;
    if (id) {
      try {
        await fetch(`/api/user-company?id=${id}`, { method: 'DELETE' });
      } catch {}
    }
    setEditingFindings(false);
    setEditingFindingsData(null);
    setThread([]);
    historyRef.current = [];
    lastAnalyzedUrlRef.current = null;
    setPhase('greeting');
    setInput(false);
    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: '[System: the user deleted their company profile and wants to start that step fresh. One sentence: acknowledge and ask them to enter their company website URL to begin again.]',
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
    setInput(true);
  }, [editingFindingsData, getLatestResultsData, askClaude]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReenrichIcp = useCallback(() => {
    if (!lastTargetUrlRef.current) return;
    icpIdRef.current = null;
    void handleCustomerUrlAnalyse(lastTargetUrlRef.current);
  }, [handleCustomerUrlAnalyse]);

  const handleDeleteIcp = useCallback(async () => {
    const id = icpIdRef.current;
    if (id) {
      try {
        await fetch('/api/company-criteria', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
      } catch {}
      icpIdRef.current = null;
    }
    setIcpEditMode(false);
    setReviewDraft({ companyType: '', platformCategory: '', therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], companySizes: [], liFollowerSizes: [], fundingStages: [] });
    setReviewedCompanyName('');
    setEnrichedTargetCompany(null);
    setSavedIcpName('');
    companyRef.current.signals = [];
    lastTargetUrlRef.current = null;
    setPhase('customer_url_conversation');
    setInput(false);
    await say('Profile deleted.');
    const { displayParts: targetIntroParts } = await askClaude({
      mode: 'narration',
      extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
    });
    if (targetIntroParts.length) await sayBeats(targetIntroParts);
    setInput(true);
  }, [say, askClaude, sayBeats]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeletePersona = useCallback(async () => {
    const id = personaIdRef.current;
    if (id) {
      try { await fetch(`/api/contacts?id=${id}`, { method: 'DELETE' }); } catch {}
      personaIdRef.current = null;
    }
    setPanelPersona({ functions: [], seniority: [], jobTitles: [], signals: [] });
    personaRef.current = { functions: [], seniority: [], jobTitles: [], signals: [] };
    setBuyingTeamEditMode(false);
    setSavedPersonaName('');
    setPhase('buying_team_review');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReenrichPersona = useCallback(async () => {
    setPhase('buying_team_loading');
    const sellerData = editingFindingsData ?? {};
    const icpData = companyRef.current;
    const btRes = await fetch('/api/generate-buying-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seller_company_name: sellerData.company_name,
        seller_company_type: sellerData.company_type,
        seller_platform_category: visiblePlatformCategory(sellerData.company_type as string | null | undefined, sellerData.platform_category as string | null | undefined),
        seller_therapeutic_areas: sellerData.therapeutic_areas,
        seller_products_services: sellerData.products_services,
        seller_services: sellerData.services,
        seller_customers_we_serve: sellerData.customers_we_serve,
        seller_value_propositions: sellerData.value_propositions,
        icp_company_type: icpData.companyType,
        icp_platform_category: visiblePlatformCategory(icpData.companyType, icpData.platformCategory),
        icp_therapeutic_areas: icpData.therapeuticAreas,
        icp_modalities: icpData.modalities,
        icp_development_stages: icpData.developmentStages,
        icp_company_sizes: icpData.companySizes,
        ...icContextForBuyingTeam(icpData, enrichedTargetCompany),
        example_company_name: reviewedCompanyName || undefined,
      }),
    }).catch(() => null);
    if (btRes?.ok) {
      const btData = await btRes.json() as { functions?: string[]; seniority_levels?: string[]; job_titles?: string[] };
      const fns = btData.functions ?? [];
      const sens = btData.seniority_levels ?? [];
      const titles = btData.job_titles ?? [];
      personaRef.current.functions = fns;
      personaRef.current.seniority = sens;
      personaRef.current.jobTitles = titles;
      setPanelPersona({ functions: fns, seniority: sens, jobTitles: titles, signals: personaRef.current.signals });
      setBuyingTeamEditMode(false);
      setPhase('buying_team_review');
      setInput(false);
    }
  }, [editingFindingsData, reviewedCompanyName, enrichedTargetCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancelFindingsEdit = useCallback(() => {
    setEditingFindings(false);
    setEditingFindingsData(preEditDataRef.current);
  }, []);

  const handleSaveFindingsEdit = useCallback(async () => {
    if (typeof document !== 'undefined') {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && ae.closest('[data-my-company-card]')) ae.blur();
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const snapshot = editingFindingsDataRef.current;
    if (!snapshot) return;
    setSavingFindings(true);
    try {
      const id = typeof snapshot.id === 'string' ? snapshot.id : null;
      let nextData = snapshot;

      if (id) {
        const response = await fetch('/api/user-company', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        });
        if (!response.ok) throw new Error('Failed to save analysis edits');
        nextData = await response.json();
      }

      setThread((prev) =>
        prev.map((m) => (m.kind === 'results' ? { ...m, data: nextData } : m))
      );
      setEditingFindingsData(nextData);
      setEditingFindings(false);
      await say('Saved. These updated findings are now what I will use for the rest of setup.');
    } catch (error) {
      console.error('[setup-flow] failed to save findings edits:', error);
      await say('I could not save those edits yet. Please try again.');
    } finally {
      setSavingFindings(false);
    }
  }, [say]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ICP card inline edit handlers ────────────────────────────────────────

  const handleEditIcp = useCallback(() => {
    icpEditSnapshotRef.current = { ...reviewDraft };
    icpEditPanelSegmentsRef.current = {
      targetCustomers: [...panelCompany.targetCustomers],
      buyerTypes: [...panelCompany.buyerTypes],
      competitors: [...panelCompany.competitors],
    };
    setIcpEditMode(true);
  }, [reviewDraft, panelCompany]);

  const handleCancelIcp = useCallback(() => {
    if (icpEditSnapshotRef.current) {
      setReviewDraft(icpEditSnapshotRef.current);
    }
    if (icpEditPanelSegmentsRef.current) {
      const snap = icpEditPanelSegmentsRef.current;
      companyRef.current.targetCustomers = snap.targetCustomers;
      companyRef.current.buyerTypes = snap.buyerTypes;
      companyRef.current.competitors = snap.competitors;
      setPanelCompany((prev) => ({ ...prev, ...snap }));
    }
    setIcpEditMode(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveIcp = useCallback(async () => {
    setIcpEditMode(false);
    if (phase === 'customer_url_review') {
      await handleReviewConfirm();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleIcpFieldChange = useCallback((field: string, value: import('@/components/SetupProfilePanel').IcpChangeValue) => {
    if (field === 'icpName') {
      setSavedIcpName(value as string);
      return;
    }
    if (field === 'competitors') {
      const v = value as import('@/components/SetupProfilePanel').CompetitorItem[];
      companyRef.current.competitors = v;
      setPanelCompany((prev) => ({ ...prev, competitors: v }));
      return;
    }
    if (field === 'targetCustomers') {
      const v = value as string[];
      companyRef.current.targetCustomers = v;
      setPanelCompany((prev) => ({ ...prev, targetCustomers: v }));
      return;
    }
    if (field === 'customersWeServe') {
      const v = value as string[];
      companyRef.current.buyerTypes = v;
      setPanelCompany((prev) => ({ ...prev, buyerTypes: v }));
      return;
    }
    setReviewDraft((prev) => ({ ...prev, [field]: value }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle user text input (greeting phase) ───────────────────────────────

  const submitSetupChatText = useCallback(
    async (displayText: string, modelContent?: string) => {
      const show = displayText.trim();
      const api = (modelContent ?? displayText).trim();
      if (!show || !api || !inputEnabled) return;

      setInputVal('');
      setInput(false);
      setPendingTransition(null);
      pushText('user', show);

      const response = await askClaude({
        mode:
          phase === 'greeting' ||
          phase === 'customer_url_input' ||
          phase === 'customer_url_conversation' ||
          phase === 'icp_suggestion'
            ? 'conversation'
            : 'phase_help',
        phase,
        extra: { role: 'user', content: api },
      });

      const beginAnalysis = response.actions.find(
        (action): action is Extract<OnboardingAction, { type: 'begin_analysis' }> =>
          action.type === 'begin_analysis',
      );

      if (beginAnalysis?.website_url) {
        const treatAsOwnCompany =
          phase === 'greeting' && (entryPoint === 'full' || entryPoint === 'company-only');
        if (treatAsOwnCompany) {
          await runAnalysis(beginAnalysis.website_url);
          return;
        }
        const isCustomer =
          phase === 'customer_url_input' ||
          phase === 'customer_url_conversation' ||
          phase === 'icp_suggestion' ||
          beginAnalysis.analysis_type === 'target_customer';
        if (isCustomer) {
          await handleCustomerUrlAnalyse(beginAnalysis.website_url);
        } else {
          await runAnalysis(beginAnalysis.website_url);
        }
        return;
      }

      if (response.displayParts.length) {
        await sayBeats(response.displayParts);
      }

      const transition = response.actions.find(
        (a): a is Extract<OnboardingAction, { type: 'confirm_transition' }> => a.type === 'confirm_transition',
      );
      if (transition) {
        setPendingTransition({ target: transition.target, buttonLabel: transition.button_label });
      }

      setInput(true);
    },
    [inputEnabled, phase, entryPoint, askClaude, runAnalysis, handleCustomerUrlAnalyse],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await submitSetupChatText(inputValue.trim());
    },
    [inputValue, submitSetupChatText],
  );

  // ── Mount: start the conversation (entry point chooses opening phase) ──

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
      if (entryPoint === 'full') {
        let bootstrapExampleEnrichment: TargetCompanyEnrichmentResult | null = null;
        // Decision tree: check what the user has already completed and resume from the right step.
        const [analysesRes, icpRes, personaRes] = await Promise.all([
          fetch('/api/user-company'),
          fetch('/api/company-criteria'),
          fetch('/api/contacts'),
        ]);
        const existingAnalysis = analysesRes.ok ? ((await analysesRes.json())?.analyses?.[0] ?? null) : null;
        const existingIcps: TargetCompanyProfile[] = icpRes.ok ? ((await icpRes.json())?.data ?? []) : [];
        const existingPersonas = personaRes.ok ? ((await personaRes.json())?.data ?? []) : [];

        // Pre-populate the profile panel with whatever is already stored
        if (existingAnalysis) {
          setEditingFindingsData(existingAnalysis as Record<string, unknown>);
          const storedWebsite = (existingAnalysis as Record<string, unknown>).website;
          if (typeof storedWebsite === 'string' && storedWebsite) {
            lastAnalyzedUrlRef.current = storedWebsite;
          }
        }
        if (existingIcps.length > 0) {
          const icp = existingIcps[0] as unknown as Record<string, unknown>;
          icpIdRef.current = (existingIcps[0] as TargetCompanyProfile).id;
          setSavedIcpName(typeof icp.name === 'string' ? icp.name : '');
          const taxonomy = {
            companyType: typeof icp.company_type === 'string' ? icp.company_type : '',
            platformCategory: visiblePlatformCategory(
              typeof icp.company_type === 'string' ? icp.company_type : '',
              typeof icp.platform_category === 'string' ? icp.platform_category : '',
            ),
            companySizes: Array.isArray(icp.company_sizes) ? (icp.company_sizes as string[]) : [],
            liFollowerSizes: Array.isArray(icp.li_follower_sizes) ? (icp.li_follower_sizes as string[]) : [],
            therapeuticAreas: Array.isArray(icp.therapeutic_areas) ? (icp.therapeutic_areas as string[]) : [],
            modalities: Array.isArray(icp.modalities) ? (icp.modalities as string[]) : [],
            developmentStages: Array.isArray(icp.development_stages) ? (icp.development_stages as string[]) : [],
            customerTherapeuticAreas: Array.isArray(icp.customer_therapeutic_areas) ? (icp.customer_therapeutic_areas as string[]) : [],
            customerModalities: Array.isArray(icp.customer_modalities) ? (icp.customer_modalities as string[]) : [],
            customerDevelopmentStages: Array.isArray(icp.customer_development_stages) ? (icp.customer_development_stages as string[]) : [],
            fundingStages: Array.isArray(icp.funding_stages) ? (icp.funding_stages as string[]) : [],
            signals: normalizeOrderedSignalIds(icp.signals),
            targetCustomers: Array.isArray(icp.target_customers) ? (icp.target_customers as string[]) : [],
            buyerTypes: Array.isArray(icp.buyer_types) ? (icp.buyer_types as string[]) : [],
            competitors: Array.isArray(icp.competitors)
              ? (icp.competitors as import('@/components/SetupProfilePanel').CompetitorItem[]) : [],
          };
          setPanelCompany(taxonomy);
          setReviewDraft(taxonomy);
          // Keep companyRef in sync so buying-team generation can read it
          companyRef.current = taxonomy;
          const enrichment = icp.example_company_enrichment as TargetCompanyEnrichmentResult | null | undefined;
          bootstrapExampleEnrichment = enrichment ?? null;
          if (enrichment) {
            setEnrichedTargetCompany(enrichment);
            setReviewedCompanyName(typeof enrichment.company_name === 'string' ? enrichment.company_name : '');
            if (enrichment.website) lastTargetUrlRef.current = enrichment.website;
          }
        }
        if (existingPersonas.length > 0) {
          const persona = existingPersonas[0] as Record<string, unknown>;
          if (typeof persona.id === 'string') personaIdRef.current = persona.id;
          const rawFns = Array.isArray(persona.functions) ? persona.functions : [];
          const fnNames = rawFns.map((f: unknown) => {
            if (typeof f === 'string') {
              try { return (JSON.parse(f) as { name?: string }).name ?? f; } catch { return f as string; }
            }
            if (typeof f === 'object' && f !== null && 'name' in f) return String((f as { name: unknown }).name);
            return String(f);
          });
          setSavedPersonaName(typeof persona.name === 'string' ? persona.name : 'Buying group');
          setPanelPersona({
            functions: fnNames,
            seniority: Array.isArray(persona.seniority_levels) ? (persona.seniority_levels as string[]) : [],
            jobTitles: Array.isArray(persona.job_titles) ? (persona.job_titles as string[]) : [],
            signals: normalizeOrderedSignalIds(persona.signals),
          });
          personaRef.current = {
            functions: fnNames,
            seniority: Array.isArray(persona.seniority_levels) ? (persona.seniority_levels as string[]) : [],
            jobTitles: Array.isArray(persona.job_titles) ? (persona.job_titles as string[]) : [],
            signals: normalizeOrderedSignalIds(persona.signals),
          };
        }

        // Leg 1: nothing stored — greet and ask for company URL
        if (!existingAnalysis) {
          const { displayParts } = await askClaude();
          setInput(true);
          if (displayParts.length) void sayBeats(displayParts);
          return;
        }

        // Leg 2: company done, no ICP — skip greeting, go straight to target company step
        if (existingIcps.length === 0) {
          setPhase('customer_url_conversation');
          setInput(false);
          const { displayParts: targetIntroParts } = await askClaude({
            mode: 'narration',
            extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
          });
          if (targetIntroParts.length) await sayBeats(targetIntroParts);
          setInput(true);
          return;
        }

        // Leg 3: company + ICP done, no persona — generate buying team and go straight to review
        if (existingPersonas.length === 0) {
          const { displayParts } = await askClaude({
            mode: 'narration',
            extra: {
              role: 'user',
              content: `[System: the user's company profile and target company profile are already set up. One sentence: acknowledge this and say you're generating their buying team suggestions now.]`,
            },
          });
          if (displayParts.length) await sayBeats(displayParts);

          setPhase('buying_team_loading');
          const sellerData = existingAnalysis as Record<string, unknown>;
          const icpData = companyRef.current;
          const exampleName = typeof (existingIcps[0] as unknown as Record<string, unknown>).example_company_enrichment === 'object'
            ? ((existingIcps[0] as unknown as Record<string, unknown>).example_company_enrichment as Record<string, unknown>)?.company_name as string | undefined
            : undefined;

          const btRes = await fetch('/api/generate-buying-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              seller_company_name: sellerData.company_name,
              seller_company_type: sellerData.company_type,
              seller_platform_category: visiblePlatformCategory(sellerData.company_type as string | null | undefined, sellerData.platform_category as string | null | undefined),
              seller_therapeutic_areas: sellerData.therapeutic_areas,
              seller_products_services: sellerData.products_services,
              seller_services: sellerData.services,
              seller_customers_we_serve: sellerData.customers_we_serve,
              seller_value_propositions: sellerData.value_propositions,
              icp_company_type: icpData.companyType,
              icp_platform_category: visiblePlatformCategory(icpData.companyType, icpData.platformCategory),
              icp_therapeutic_areas: icpData.therapeuticAreas,
              icp_modalities: icpData.modalities,
              icp_development_stages: icpData.developmentStages,
              icp_company_sizes: icpData.companySizes,
              ...icContextForBuyingTeam(icpData, bootstrapExampleEnrichment),
              example_company_name: exampleName,
            }),
          }).catch(() => null);

          if (btRes?.ok) {
            const btData = await btRes.json() as { functions?: string[]; seniority_levels?: string[]; job_titles?: string[] };
            const fns = btData.functions ?? [];
            const sens = btData.seniority_levels ?? [];
            const titles = btData.job_titles ?? [];
            personaRef.current.functions = fns;
            personaRef.current.seniority = sens;
            personaRef.current.jobTitles = titles;
            setPanelPersona({ functions: fns, seniority: sens, jobTitles: titles, signals: personaRef.current.signals });
            setBuyingTeamEditMode(false);
            setChipSel([]);
            setPhase('buying_team_review');
            setInput(false);
          }

          const { displayParts: reviewParts } = await askClaude({
            mode: 'narration',
            extra: {
              role: 'user',
              content: `[System: buying team suggestions are ready. One sentence: tell the user the buying team is pre-filled in the card on the right — they can select or deselect the pills, then hit "Looks right" when ready.]`,
            },
          });
          if (reviewParts.length) await sayBeats(reviewParts);
          return;
        }

        // Leg 4: persona exists — backfill recommended company signal selections via save (no extra review step).
        if (companyRef.current.signals.length === 0) {
          await savePersona();
          return;
        }

        // Leg 5: everything done — brief confirmation then redirect
        const { displayParts } = await askClaude({
          mode: 'narration',
          extra: {
            role: 'user',
            content: '[System: setup is fully complete — company profile, target company profile, and buying team are all saved. One sentence: let the user know they\'re all set and you\'re taking them to their workspace.]',
          },
        });
        if (displayParts.length) await sayBeats(displayParts);
        setPhase('done');
        setTimeout(() => router.push(resolvedCompletePath), 2200);
        return;
      }

      if (entryPoint === 'company-only') {
        // Just greet and ask for company URL — skip ICP/persona steps entirely
        const { displayParts } = await askClaude({
          mode: 'narration',
          extra: {
            role: 'user',
            content: `[System: The user wants to change their company. One short sentence: greet them warmly and ask them to share the website URL of their new company so you can analyse it.]`,
          },
        });
        setInput(true);
        if (displayParts.length) void sayBeats(displayParts);
        return;
      }

      if (entryPoint === 'target-company') {
        // Fetch seller analysis and existing ICPs in parallel
        const [analysesRes, icpsRes] = await Promise.all([
          fetch('/api/user-company'),
          fetch('/api/company-criteria'),
        ]);
        const existingAnalysis = analysesRes.ok ? ((await analysesRes.json())?.analyses?.[0] ?? null) : null;
        const existingIcps: TargetCompanyProfile[] = icpsRes.ok ? ((await icpsRes.json())?.data ?? []) : [];

        if (existingAnalysis) {
          setEditingFindingsData(existingAnalysis as Record<string, unknown>);
          const storedWebsite = (existingAnalysis as Record<string, unknown>).website;
          if (typeof storedWebsite === 'string' && storedWebsite) {
            lastAnalyzedUrlRef.current = storedWebsite;
          }
        }

        if (existingIcps.length === 0) {
          // No ICPs yet — generate fresh suggestions and present them in chat
          if (existingAnalysis) {
            await say('Give me just a moment while I line up a few example target accounts from your profile.');
            const suggestions = await generateIcpSuggestions(existingAnalysis as Record<string, unknown>);
            if (suggestions.length > 0) {
              const segmentList = suggestions.map((s) => `${s.name} (${s.segmentLabel})`).join(', ');
              const { displayParts: dp2 } = await askClaude({
                mode: 'narration',
                extra: {
                  role: 'user',
                  content:
                    `[System: The user is resuming setup; company profile is ready. 4-6 short sentences max, no em dashes. ` +
                    `(1) Brief glad the company pass went well. ` +
                    `(2) One line: we are defining ideal target accounts, real companies they sell to. ` +
                    `(3) Examples for different buyer types: ${segmentList}. ` +
                    `(4) Tap one or paste their own URL. ` +
                    `(5) If unsure, those suggestions came from their company and any pick is fine.]`,
                },
              });
              if (dp2.length) await sayBeats(dp2);
              setPhase('icp_suggestion');
              setInput(true);
              return;
            }
          }
          // Fallback to URL input if suggestion generation failed
          setPhase('customer_url_conversation');
          setInput(false);
          const { displayParts: targetIntroParts } = await askClaude({
            mode: 'narration',
            extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
          });
          if (targetIntroParts.length) await sayBeats(targetIntroParts);
          setInput(true);
          return;
        }

        // Has existing ICPs — check for unenrolled suggestions
        const remaining = unenrolledSuggestions();
        if (remaining.length > 0) {
          setIcpSuggestions(remaining);
          const { displayParts } = await askClaude({
            mode: 'narration',
            extra: {
              role: 'user',
              content:
                '[System: The user is adding another ideal customer profile. Two or three short sentences, no em dashes. ' +
                'Each ICP should stay a distinct slice of the market with little overlap. ' +
                'They still have suggested accounts below, or they can type their own. If they are not sure, picking one of the suggestions below is fine.]',
            },
          });
          if (displayParts.length) await sayBeats(displayParts);
          setPhase('icp_suggestion');
          setInput(true);
          return;
        }

        // All previous suggestions enrolled or none stored — they have one in mind
        setPhase('customer_url_conversation');
        setInput(false);
        const { displayParts: targetIntroParts } = await askClaude({
          mode: 'narration',
          extra: { role: 'user', content: SETUP_NARRATION_TARGET_ACCOUNTS_STEP },
        });
        if (targetIntroParts.length) await sayBeats(targetIntroParts);
        setInput(true);
        return;
      }
    } finally {
        setBootstrapFinished(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectCompanyForBuyingGroup = async (co: TargetCompanyProfile) => {
    pushText('user', co.name);
    setChipSel([]);
    await startBuyingGroupForCompany(co);
  };

  // ── Widget config per phase ───────────────────────────────────────────────

  type WidgetConfig = { options: ChipOption[]; multi: boolean };
  const WIDGET: Partial<Record<Phase, WidgetConfig>> = {
    company_type: { options: COMPANY_TYPE_SELECTION_OPTIONS, multi: false },
    company_size: { options: SIZE_OPTIONS, multi: true },
    company_ta: { options: TA_OPTIONS, multi: true },
    company_modality: { options: MODALITY_SELECTION_OPTIONS, multi: true },
    company_stage: { options: DEV_STAGE_OPTIONS, multi: true },
    company_funding: { options: FUNDING_OPTIONS, multi: true },
    persona_functions: { options: FUNCTION_OPTIONS, multi: true },
    persona_seniority: { options: SENIORITY_OPTIONS, multi: true },
  };

  const widget = WIDGET[phase];
  const showChatBar =
    phase === 'greeting' ||
    phase === 'customer_url_input' ||
    phase === 'customer_url_conversation' ||
    phase === 'company_select' ||
    phase === 'company_type' ||
    phase === 'company_size' ||
    phase === 'company_ta' ||
    phase === 'company_modality' ||
    phase === 'company_stage' ||
    phase === 'company_funding' ||
    phase === 'persona_functions' ||
    phase === 'persona_seniority' ||
    phase === 'buying_team_review';
  const isSaving = phase === 'company_saving' || phase === 'persona_saving' || phase === 'done';
  const isCustomerUrlLoading = phase === 'customer_url_loading';
  const customerUrlPercent = (() => {
    if (!isCustomerUrlLoading || customerUrlStartedAtRef.current === null) return 0;
    const elapsed = Math.max(customerUrlProgressNow - customerUrlStartedAtRef.current, 0);
    const progress = 1 - Math.exp(-elapsed / 9000);
    return Math.round(5 + (85 - 5) * progress);
  })();

  const ownCompanyPercent = (() => {
    const ownEnrichTicker =
      phase === 'analysis_loading' || (phase === 'analysis_results' && ownCompanyAnalysisInFlight);
    if (!ownEnrichTicker || ownCompanyStartedAtRef.current === null) return 0;
    const elapsed = Math.max(ownCompanyProgressNow - ownCompanyStartedAtRef.current, 0);
    const progress = 1 - Math.exp(-elapsed / 11000);
    return Math.round(5 + (85 - 5) * progress);
  })();

  // Once SSE steps arrive, switch from fake timer curve to real step-based progress.
  // Cap the fake curve at 20% so the first real event (step 1 → 30%) always feels like forward movement.
  const ENRICH_STEP_PCT = [30, 55, 75, 92] as const;
  const targetEnrichDisplayPct = (() => {
    if (targetEnrichStep <= 0) return Math.min(customerUrlPercent, 20);
    const stepBase = ENRICH_STEP_PCT[targetEnrichStep - 1] ?? 92;
    if (
      phase === 'customer_url_loading' &&
      targetEnrichStep === 2 &&
      customerUrlStep2AnchorRef.current !== null
    ) {
      const elapsed = Math.max(0, customerUrlProgressNow - customerUrlStep2AnchorRef.current);
      const maxCreep = 17;
      const creep = Math.min(maxCreep, (elapsed / 20000) * maxCreep);
      return Math.round(stepBase + creep);
    }
    return stepBase;
  })();
  const ownEnrichDisplayPct = (() => {
    if (ownEnrichStep <= 0) return Math.min(ownCompanyPercent, 20);
    const stepBase = ENRICH_STEP_PCT[ownEnrichStep - 1] ?? 92;
    const creepPhase =
      phase === 'analysis_loading' || (phase === 'analysis_results' && ownCompanyAnalysisInFlight);
    if (
      creepPhase &&
      ownEnrichStep === 2 &&
      ownCompanyStep2AnchorRef.current !== null
    ) {
      const elapsed = Math.max(0, ownCompanyProgressNow - ownCompanyStep2AnchorRef.current);
      const maxCreep = 17;
      const creep = Math.min(maxCreep, (elapsed / 20000) * maxCreep);
      return Math.round(stepBase + creep);
    }
    return stepBase;
  })();

  const savingPercent = (() => {
    if (!isSaving || savingStartedAtRef.current === null) return 0;
    const elapsed = Math.max(savingProgressNow - savingStartedAtRef.current, 0);
    const progress = 1 - Math.exp(-elapsed / 4000);
    return Math.round(5 + (90 - 5) * progress);
  })();

  const SETUP_STEPS = [
    { label: 'Your company', phases: ['greeting', 'analysis_loading', 'analysis_results'] as Phase[] },
    { label: 'Target companies', phases: ['icp_suggestion', 'customer_url_input', 'customer_url_conversation', 'customer_url_loading', 'customer_url_review', 'company_type', 'company_size', 'company_ta', 'company_modality', 'company_stage', 'company_funding', 'company_saving'] as Phase[] },
    {
      label: 'Buying teams',
      phases: ['buying_team_loading', 'buying_team_review', 'persona_functions', 'persona_seniority', 'persona_saving', 'done'] as Phase[],
    },
  ];
  const currentStepIndex = SETUP_STEPS.findIndex((s) => s.phases.includes(phase));

  /** Single reconciliation: first sync URL ← phase; later, changed ?step= from nav may call handleGoToStep. */
  useEffect(() => {
    if (entryPoint !== 'full' || !bootstrapFinished) return;
    if (pathname !== ROUTES.setup.arcova) return;
    if (currentStepIndex < 0) return;

    const canonical =
      currentStepIndex === 0 ? 'company' : currentStepIndex === 1 ? 'target' : 'buying';
    const raw = new URLSearchParams(window.location.search).get('step');
    const idxFromUrl =
      raw === 'company' ? 0 : raw === 'target' ? 1 : raw === 'buying' ? 2 : null;

    const prevRaw = setupStepParamPrevRef.current;

    if (!setupStepDeepLinkDoneRef.current) {
      setupStepDeepLinkDoneRef.current = true;
      if (raw !== canonical) {
        setupStepInitialReplacePendingRef.current = true;
        router.replace(`${pathname}?step=${canonical}`, { scroll: false });
      }
      setupStepParamPrevRef.current = canonical;
      return;
    }

    if (setupStepInitialReplacePendingRef.current) {
      if (raw === canonical) {
        setupStepInitialReplacePendingRef.current = false;
        setupStepParamPrevRef.current = raw;
      } else {
        router.replace(`${pathname}?step=${canonical}`, { scroll: false });
      }
      return;
    }

    const stepParamChanged = prevRaw !== null && prevRaw !== raw;
    if (stepParamChanged && idxFromUrl != null && idxFromUrl !== currentStepIndex) {
      setupStepParamPrevRef.current = raw;
      void handleGoToStep(idxFromUrl);
      return;
    }

    setupStepParamPrevRef.current = raw;

    if (raw !== canonical) {
      router.replace(`${pathname}?step=${canonical}`, { scroll: false });
    }
  }, [entryPoint, bootstrapFinished, pathname, currentStepIndex, router, handleGoToStep]);

  const showProgress = (entryPoint === 'full') && currentStepIndex >= 0;
  /** Only show step pills up to the current leg so step 1 does not preview target / buying. */
  const visibleSetupSteps = SETUP_STEPS.slice(0, Math.min(SETUP_STEPS.length, currentStepIndex + 1));
  const isCustomerUrlReview = phase === 'customer_url_review';
  const isReviewValid =
    reviewDraft.companyType !== '' &&
    (visiblePlatformCategory(reviewDraft.companyType, reviewDraft.platformCategory).length > 0 ||
      reviewDraft.therapeuticAreas.length > 0 ||
      reviewDraft.modalities.length > 0 ||
      reviewDraft.developmentStages.length > 0 ||
      reviewDraft.companySizes.length > 0 ||
      reviewDraft.liFollowerSizes.length > 0 ||
      reviewDraft.fundingStages.length > 0);

  const toggleReview = (
    field: keyof Pick<typeof reviewDraft, 'therapeuticAreas' | 'modalities' | 'developmentStages' | 'customerTherapeuticAreas' | 'customerModalities' | 'customerDevelopmentStages' | 'companySizes' | 'liFollowerSizes' | 'fundingStages'>
  ) => (value: string) =>
    setReviewDraft((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value],
    }));

  const handleReviewConfirm = async () => {
    companyRef.current.companyType = reviewDraft.companyType;
    companyRef.current.platformCategory = visiblePlatformCategory(reviewDraft.companyType, reviewDraft.platformCategory);
    companyRef.current.therapeuticAreas = reviewDraft.therapeuticAreas;
    companyRef.current.modalities = reviewDraft.modalities;
    companyRef.current.developmentStages = reviewDraft.developmentStages;
    companyRef.current.customerTherapeuticAreas = reviewDraft.customerTherapeuticAreas;
    companyRef.current.customerModalities = reviewDraft.customerModalities;
    companyRef.current.customerDevelopmentStages = reviewDraft.customerDevelopmentStages;
    companyRef.current.companySizes = reviewDraft.companySizes;
    companyRef.current.liFollowerSizes = reviewDraft.liFollowerSizes;
    companyRef.current.fundingStages = reviewDraft.fundingStages;
    await saveIcp();
  };

  const isResultsStep = phase === 'analysis_results';
  const resultsEntry = thread.find((m): m is ResultsMsg => m.kind === 'results');
  const resultsPanelData = (editingFindingsData ?? resultsEntry?.data) ?? null;
  const showResultsActions = Boolean(isResultsStep && resultsPanelData);
  const visibleMessages = thread.filter((m) => m.kind !== 'results');
  const analysedUrlForPanel = lastAnalyzedUrlRef.current ?? '';

  useEffect(() => {
    const enrichGlass =
      phase === 'analysis_loading' || phase === 'customer_url_loading' || phase === 'buying_team_loading';
    if (phase === 'greeting') {
      if (!visibleMessages.some((m) => m.role === 'user')) return;
    } else if (!enrichGlass && phase !== 'customer_url_conversation' && phase !== 'icp_suggestion') {
      return;
    }
    const el = setupGreetingThreadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [
    phase,
    visibleMessages,
    thinking,
    loadMsg,
    customerUrlLoadMsg,
    customerUrlPercent,
    ownCompanyPercent,
    ownEnrichStep,
    targetEnrichStep,
    ownEnrichDisplayPct,
    targetEnrichDisplayPct,
    buyingLoadPct,
    partialOwnEnrichment,
    partialTargetEnrichment,
  ]);

  // ── Data helpers (available to all phase renders below) ─────────────────

  function getNum(v: unknown): number | undefined {
    return typeof v === 'number' ? v : undefined;
  }
  function getStr(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  }
  function getStrArr(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const filtered = v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    return filtered.length > 0 ? filtered : undefined;
  }

  const myCompany: import('@/components/SetupProfilePanel').PanelMyCompanyData = {
    companyName: getStr(resultsPanelData?.company_name),
    website: getStr(resultsPanelData?.website),
    logoUrl: getStr(resultsPanelData?.logo_url),
    tagline: getStr(resultsPanelData?.tagline),
    linkedinUrl: getStr(resultsPanelData?.linkedin_url),
    description: getStrArr(resultsPanelData?.description),
    customersWeServe: getStrArr(resultsPanelData?.customers_we_serve),
    valuePropositions: getStrArr(resultsPanelData?.value_propositions),
    goodFit: getStrArr(resultsPanelData?.good_fit),
    badFit: getStrArr(resultsPanelData?.bad_fit),
    competitorsEnriched: Array.isArray(resultsPanelData?.competitors_enriched)
      ? (resultsPanelData.competitors_enriched as import('@/components/SetupProfilePanel').CompetitorItem[])
      : undefined,
    companyStatus: (() => {
      const stage = getStr(resultsPanelData?.funding_stage);
      const total = getNum(resultsPanelData?.total_funding_usd);
      const fmtUsd = (usd: number) => {
        if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
        if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
        if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
        return `$${usd}`;
      };
      if (stage && total != null) return `${stage} · ${fmtUsd(total)}`;
      if (stage) return stage;
      return getStr(resultsPanelData?.company_status);
    })(),
    companyType: getStr(resultsPanelData?.company_type),
    companyTypeDisplay: getStr(resultsPanelData?.company_type_display),
    platformCategory: getStr(resultsPanelData?.platform_category),
    therapeuticAreas: getStrArr(resultsPanelData?.therapeutic_areas),
    modalities: getStrArr(resultsPanelData?.modalities),
    developmentStages: getStrArr(resultsPanelData?.development_stages),
    productsServices: getStrArr(resultsPanelData?.products_services),
    services: getStrArr(resultsPanelData?.services),
    technologies: getStrArr(resultsPanelData?.technologies),
    employeeCount: getNum(resultsPanelData?.employee_count),
    employeeRange: getStr(resultsPanelData?.employee_range),
    followerCount: getNum(resultsPanelData?.follower_count),
    foundedYear: getNum(resultsPanelData?.founded_year),
    fundingStage: getStr(resultsPanelData?.funding_stage),
    totalFundingUsd: getNum(resultsPanelData?.total_funding_usd),
    hqCity: getStr(resultsPanelData?.hq_city),
    hqCountry: getStr(resultsPanelData?.hq_country),
    industry: getStr(resultsPanelData?.industry),
  };

  const setupGlassTargetPills = icpSuggestions.slice(0, 12);

  // Shared props for SetupProfilePanel (avoids repetition across phase renders)
  const sharedPanelProps = {
    myCompany,
    analysisLoading: false as const,
    editMode: editingFindings,
    onMyCompanyChange: handleMyCompanyChange,
    onEditCompany: resultsPanelData ? () => void handleAnalysisNotRight() : undefined,
    onSaveEdit: editingFindings ? () => void handleSaveFindingsEdit() : undefined,
    onCancelEdit: editingFindings ? handleCancelFindingsEdit : undefined,
    onDeleteCompany: resultsPanelData ? () => void handleDeleteCompanyProfile() : undefined,
    onReenrichCompany: resultsPanelData && !editingFindings ? handleReanalyseFromPanel : undefined,
    reviewedCompanyName,
    enrichedTargetCompany,
    savedIcpName,
    panelCompany,
    chipSel,
    icpEditMode,
    onEditIcp: handleEditIcp,
    onSaveIcp: () => void handleSaveIcp(),
    onCancelIcp: handleCancelIcp,
    onReenrichIcp: handleReenrichIcp,
    onDeleteIcp: () => void handleDeleteIcp(),
    onIcpFieldChange: handleIcpFieldChange,
    panelPersona,
    savedPersonaName,
    buyingTeamEditMode,
    onEditBuyingTeam: () => setBuyingTeamEditMode(true),
    onCancelBuyingTeamEdit: () => setBuyingTeamEditMode(false),
    onToggleBuyingTeamFn: (v: string) => {
      const next = panelPersona.functions.includes(v)
        ? panelPersona.functions.filter((x) => x !== v)
        : [...panelPersona.functions, v];
      personaRef.current.functions = next;
      setPanelPersona((p) => ({ ...p, functions: next }));
    },
    onToggleBuyingTeamSeniority: (v: string) => {
      const next = panelPersona.seniority.includes(v)
        ? panelPersona.seniority.filter((x) => x !== v)
        : [...panelPersona.seniority, v];
      personaRef.current.seniority = next;
      setPanelPersona((p) => ({ ...p, seniority: next }));
    },
    buyingTeamExampleCompany: reviewedCompanyName || undefined,
    buyingTeamIcpName: savedIcpName || undefined,
    showSignalPills: false as const,
  } as const;

  // CTA button shared styles
  const ctaPrimary =
    'inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-br from-arcova-teal to-[#007e8b] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(0,164,180,0.5)] transition-all hover:-translate-y-px hover:bg-arcova-navy disabled:opacity-50';
  const ctaSecondary =
    'rounded-[14px] border border-arcova-navy/12 bg-white/70 px-5 py-3 text-sm font-medium text-arcova-navy/70 transition-all hover:bg-white hover:text-arcova-navy disabled:opacity-50';
  const ctaGhost =
    'rounded-[14px] border border-transparent px-4 py-3 text-sm font-medium text-arcova-navy/45 transition-all hover:text-arcova-navy/70 ml-auto';

  // ── Redesigned phase screens ──────────────────────────────────────────────

  const welcomeChatPart1 = `Hi ${firstName || 'there'}, let's get you set up. `;
  const welcomeChatPart2 = `First, what's your company's website?`;

  // Phase: greeting, step-2 target ICP URL chat, or suggested model accounts, all in the same glass agent window.
  // • Before the user sends anything: welcome card (orb + headline + URL input).
  // • After the first user message: same 460px shell, in-place thread + Today-style composer (no separate header chrome).
  if (phase === 'greeting' || phase === 'customer_url_conversation' || phase === 'icp_suggestion') {
    const isGlassTargetStep = phase === 'customer_url_conversation' || phase === 'icp_suggestion';
    const hasUserMsg = visibleMessages.some((m) => m.role === 'user') || isGlassTargetStep;
    // Opening beats are appended to `thread` on mount while the welcome card shows static headline copy.
    // In chat mode, list only messages from the first user turn so the UI matches what the user experienced.
    const firstGreetingUserIdx = visibleMessages.findIndex((m) => m.role === 'user');
    const greetingChatMessages =
      phase === 'icp_suggestion'
        ? visibleMessages
        : firstGreetingUserIdx >= 0
          ? visibleMessages.slice(firstGreetingUserIdx)
          : visibleMessages;
    const greetingChatMessagesDisplay =
      phase === 'icp_suggestion'
        ? greetingChatMessages.filter((m): m is TextMsg => m.kind === 'text')
        : filterFirstAssistantIfWelcomeHeadlineDuplicate(
            greetingChatMessages,
            welcomeChatPart1,
            welcomeChatPart2,
          );
    const WELCOME_SPEED = 44;
    const isWorkDomain = !!emailDomain && !FREE_EMAIL_DOMAINS.has(emailDomain.toLowerCase());

    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-16">
        <AppAmbientBackground />
        <div className="absolute left-0 right-0 top-0 z-20 flex justify-center px-6 pt-6 sm:px-10">
          <div className="flex w-full max-w-[1080px] flex-wrap items-center gap-3">
            <StepEyebrow step={isGlassTargetStep ? 1 : 0} />
          </div>
        </div>
        <div className="relative z-10 flex w-[460px] flex-col">
          {isGlassTargetStep && entryPoint === 'full' && (
            <button
              type="button"
              onClick={() => void handleGoToStep(0)}
              disabled={thinking}
              className={cn(SETUP_GLASS_BACK_ABOVE_CARD_CLASS, 'mb-3 self-start')}
            >
              <span aria-hidden>←</span> Back
            </button>
          )}
          <div
            className={cn(
              'relative flex w-full flex-col rounded-3xl border border-white/55 bg-white/65 px-10 pb-10 pt-0 shadow-arcova backdrop-blur-xl',
              hasUserMsg
                ? 'h-[min(85vh,52rem)] min-h-[580px] max-h-[85vh] overflow-hidden'
                : 'min-h-[580px] overflow-visible',
            )}
          >
          {!hasUserMsg ? (
            <>
              <SetupGlassAgentMetaStrip
                clock={setupGreetingChatClock}
                statusKey={thinking ? 'thinking' : inputEnabled ? 'ready' : 'waiting'}
              />
              {/*
                Fixed-height orb band keeps the orb centered in the same window as before; larger
                margin-top on the eyebrow moves “Welcome to Arcova” down toward the headline.
              */}
              <div className="flex w-full shrink-0 flex-col items-center">
                <div className="flex h-[13.4375rem] w-full flex-col items-center justify-center">
                  <SetupOrb variant="welcome" welcomeEnergised={false} />
                </div>
                <div className="mt-[1.15cm] shrink-0 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-arcova-navy/45">
                  Welcome to Arcova
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col justify-start">
                <h1 className="mb-7 mt-[0.75cm] min-h-[5rem] text-center font-manrope text-3xl font-medium leading-snug tracking-tight text-arcova-navy">
                  {inputEnabled ? (
                    <TypingHeadline part1={welcomeChatPart1} part2={welcomeChatPart2} speed={WELCOME_SPEED} />
                  ) : (
                    <span className="block text-arcova-navy/40">Getting ready.</span>
                  )}
                </h1>

                <div className="space-y-3">
                  <form onSubmit={(e) => void handleSend(e)}>
                    <div
                      className={cn(
                        'flex min-w-0 items-center gap-2 rounded-2xl border bg-white/90 px-3 py-2.5 shadow-[0_8px_32px_-20px_rgba(13,53,71,0.18)] backdrop-blur-md transition-all',
                        inputEnabled
                          ? 'border-[rgba(13,53,71,0.12)] focus-within:border-arcova-teal/45 focus-within:shadow-[0_8px_28px_-18px_rgba(0,164,180,0.22)]'
                          : 'pointer-events-none border-arcova-navy/10 opacity-55',
                      )}
                    >
                      <Sparkles
                        className={cn(
                          'h-4 w-4 shrink-0',
                          inputEnabled ? 'text-arcova-teal/45' : 'text-arcova-navy/25',
                        )}
                      />
                      <input
                        ref={welcomeInputRef}
                        value={inputValue.replace(/^https?:\/\//i, '')}
                        onChange={(e) => setInputVal(e.target.value.replace(/^https?:\/\//i, ''))}
                        placeholder="Your company name or website"
                        spellCheck={false}
                        autoComplete="off"
                        disabled={!inputEnabled}
                        aria-disabled={!inputEnabled}
                        className="min-w-0 flex-1 bg-transparent font-manrope text-[1.0625rem] text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
                      />
                      <button
                        type="submit"
                        disabled={!inputValue.trim() || !inputEnabled}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-arcova-teal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={inputEnabled ? 'Send' : 'Getting ready'}
                      >
                        <Send className="h-4 w-4" />
                        Send
                      </button>
                    </div>
                  </form>
                  {inputEnabled && isWorkDomain && !inputValue.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        pushText('user', emailDomain);
                        void runAnalysis(emailDomain);
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-arcova-teal/30 bg-arcova-teal/8 px-3.5 py-1.5 text-xs font-medium text-arcova-teal transition-all hover:bg-arcova-teal/15"
                    >
                      Use {emailDomain} from my email
                    </button>
                  )}
                  {analysisError && (
                    <p className="text-xs text-red-600">{analysisError}</p>
                  )}
                </div>
              </div>
              <div className="mt-8 flex items-center justify-center gap-2 text-xs text-arcova-navy/40">
                <span className="flex -space-x-1.5">
                  {['#a3e3df', '#f6d6c1', '#b5d6f0'].map((bg, i) => (
                    <span
                      key={i}
                      className="h-5 w-5 rounded-full border border-white/60"
                      style={{ background: bg }}
                    />
                  ))}
                </span>
                <span>
                  Joining as{' '}
                  <strong className="font-semibold text-arcova-navy/70">{firstName || 'you'}</strong>
                  {email && (
                    <span className="ml-1 text-arcova-navy/35">• {email}</span>
                  )}
                </span>
              </div>
            </>
          ) : (
            <>
              <SetupGlassAgentMetaStrip
                clock={setupGreetingChatClock}
                statusKey={thinking ? 'thinking' : inputEnabled ? 'ready' : 'waiting'}
              />
              <div
                ref={setupGreetingThreadRef}
                className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-1 py-2 [touch-action:pan-y] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {greetingChatMessagesDisplay.map((msg, i) => {
                  if (msg.role === 'user') {
                    return (
                      <div
                        key={msg.id}
                        className="flex justify-end"
                        style={{ animation: 'arcova-msg-in 0.2s ease' }}
                      >
                        <div className="max-w-[min(100%,36rem)] rounded-2xl rounded-br-md rounded-tl-2xl rounded-tr-2xl bg-arcova-teal px-4 py-3.5 font-manrope text-[1.125rem] leading-[1.45] tracking-[-0.016em] text-white shadow-[0_10px_40px_-18px_rgba(0,164,180,0.45)]">
                          {msg.text}
                        </div>
                      </div>
                    );
                  }
                  const isLast = i === greetingChatMessagesDisplay.length - 1;
                  return (
                    <div key={msg.id} className="flex w-full" style={{ animation: 'arcova-msg-in 0.2s ease' }}>
                      <div
                        className={cn(
                          'max-w-[min(100%,40rem)] rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-white px-4 py-4 font-manrope text-[1.1875rem] leading-[1.45] tracking-[-0.018em] text-slate-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] ring-1 ring-slate-200/55 transition-opacity',
                          !isLast ? 'opacity-55' : 'opacity-100',
                        )}
                      >
                        <SetupAssistantMessageParagraphs
                          text={msg.text}
                          typing={!!msg.typing}
                          onTypingLayout={msg.typing ? scrollSetupGreetingThreadToBottom : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
                {thinking && (
                  <div className="flex w-full">
                    <div className="max-w-[min(100%,40rem)] rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-slate-100/80 px-4 py-4 font-manrope text-[1.1875rem] leading-[1.45] tracking-[-0.018em] text-slate-700 ring-1 ring-slate-200/60">
                      <div className="flex h-5 items-center gap-1.5">
                        {[0, 120, 240].map((d) => (
                          <span
                            key={d}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/60"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {analysisError && (
                  <p className="text-center text-xs text-red-500">{analysisError}</p>
                )}
              </div>
              {(phase === 'icp_suggestion' || phase === 'customer_url_conversation') &&
                setupGlassTargetPills.length > 0 &&
                !thinking &&
                inputEnabled && (
                  <div className="shrink-0 border-t border-arcova-navy/[0.06] px-1 pb-1 pt-3">
                    <div className="flex w-full flex-col gap-2">
                      {setupGlassTargetPills.map((suggestion) => (
                          <button
                            key={suggestion.domain}
                            type="button"
                            title={suggestion.segmentLabel}
                            disabled={thinking}
                            onClick={() => {
                              markDomainEnrolled(suggestion.domain);
                              pushText('user', suggestion.name);
                              void handleCustomerUrlAnalyse(suggestion.domain);
                            }}
                            className="inline-flex w-full min-w-0 max-w-none items-start gap-1.5 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 py-2 text-left font-manrope text-sm font-semibold leading-snug text-arcova-teal shadow-sm transition-colors hover:border-arcova-teal/35 hover:bg-slate-50/90 disabled:pointer-events-none disabled:opacity-40"
                          >
                            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-arcova-teal/70" />
                            <span className="min-w-0 flex-1 whitespace-normal break-words">{suggestion.name}</span>
                          </button>
                      ))}
                    </div>
                  </div>
                )}
              {phase === 'icp_suggestion' && !thinking && inputEnabled && (
                <div className="shrink-0 px-1 pb-1 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      pushText('user', 'I will enter my own');
                      setPhase('customer_url_conversation');
                      setInput(true);
                    }}
                    disabled={thinking}
                    className="w-full rounded-2xl border border-dashed border-arcova-navy/22 bg-white/45 px-4 py-3.5 text-left font-manrope text-sm font-medium text-arcova-navy/65 transition-all hover:border-arcova-teal/35 hover:bg-white/75 hover:text-arcova-navy disabled:opacity-45"
                  >
                    I will enter my own ICP →
                  </button>
                </div>
              )}
              {inputEnabled && (
                <SetupEmbedChatInput
                  value={inputValue}
                  onChange={(v) => setInputVal(v)}
                  onSubmit={(e) => void handleSend(e)}
                  disabled={!inputEnabled}
                  placeholder={
                    phase === 'customer_url_conversation' || phase === 'icp_suggestion'
                      ? 'URL or company name…'
                      : 'Reply…'
                  }
                  autoFocusInput
                />
              )}
            </>
          )}
          </div>
        </div>
      </div>
    );
  }

  // Phases: inline enrichment (own company, target URL, buying team) inside the same glass chat shell
  if (
    phase === 'analysis_loading' ||
    phase === 'customer_url_loading' ||
    phase === 'buying_team_loading'
  ) {
    const enrichMessages = visibleGreetingStyleMessages(thread, welcomeChatPart1, welcomeChatPart2);
    const glassOwnStages = buildTieredSnapshotsFromOwn(
      partialOwnEnrichment,
      prettyCompanyUrlHint(lastAnalyzedUrlRef.current),
      ownEnrichStep,
    );
    const glassTargetStages = buildTieredSnapshotsFromTarget(
      partialTargetEnrichment,
      prettyCompanyUrlHint(lastTargetUrlRef.current),
      targetEnrichStep,
    );
    const glassBuyingSnapshot = buildBuyingTeamSnapshot(
      enrichedTargetCompany,
      reviewedCompanyName || savedIcpName || null,
      prettyCompanyUrlHint(lastTargetUrlRef.current),
    );
    const glassBuyingStages: EnrichmentSnapshotStage[] | null = glassBuyingSnapshot
      ? [{ tier: 'buying-summary', label: '', snapshot: glassBuyingSnapshot }]
      : null;

    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-16">
        <AppAmbientBackground />
        <div className="absolute left-0 right-0 top-0 z-20 flex justify-center px-6 pt-6 sm:px-10">
          <div className="w-full max-w-[1080px]">
            <StepEyebrow step={Math.max(0, currentStepIndex) as 0 | 1 | 2} />
          </div>
        </div>
        <div className="relative z-10 flex w-[460px] flex-col">
          {entryPoint === 'full' && phase === 'customer_url_loading' && (
            <button
              type="button"
              onClick={() => void handleGoToStep(0)}
              disabled={thinking}
              className={cn(SETUP_GLASS_BACK_ABOVE_CARD_CLASS, 'mb-3 self-start')}
            >
              <span aria-hidden>←</span> Back
            </button>
          )}
          {entryPoint === 'full' && phase === 'buying_team_loading' && (
            <button
              type="button"
              onClick={() => void handleGoToStep(1)}
              disabled={thinking}
              className={cn(SETUP_GLASS_BACK_ABOVE_CARD_CLASS, 'mb-3 self-start')}
            >
              <span aria-hidden>←</span> Back
            </button>
          )}
          <div className="relative flex h-[min(85vh,52rem)] w-full min-h-[580px] max-h-[85vh] flex-col overflow-hidden rounded-3xl border border-white/55 bg-white/65 px-10 pb-0 pt-0 shadow-arcova backdrop-blur-xl">
          <SetupGlassAgentMetaStrip clock={setupGreetingChatClock} statusKey="thinking" />
          <div
            ref={setupGreetingThreadRef}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-1 py-2 pb-4 [touch-action:pan-y] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {enrichMessages.map((msg, i) => {
              if (msg.role === 'user') {
                return (
                  <div
                    key={msg.id}
                    className="flex justify-end"
                    style={{ animation: 'arcova-msg-in 0.2s ease' }}
                  >
                    <div className="max-w-[min(100%,36rem)] rounded-2xl rounded-br-md rounded-tl-2xl rounded-tr-2xl bg-arcova-teal px-4 py-3.5 font-manrope text-[1.125rem] leading-[1.45] tracking-[-0.016em] text-white shadow-[0_10px_40px_-18px_rgba(0,164,180,0.45)]">
                      {msg.text}
                    </div>
                  </div>
                );
              }
              const isLast = i === enrichMessages.length - 1;
              return (
                <div key={msg.id} className="flex w-full" style={{ animation: 'arcova-msg-in 0.2s ease' }}>
                  <div
                    className={cn(
                      'max-w-[min(100%,40rem)] rounded-2xl rounded-tl-sm bg-gradient-to-br from-slate-50 to-white px-4 py-4 font-manrope text-[1.1875rem] leading-[1.45] tracking-[-0.018em] text-slate-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] ring-1 ring-slate-200/55 transition-opacity',
                      !isLast ? 'opacity-55' : 'opacity-100',
                    )}
                  >
                    <SetupAssistantMessageParagraphs
                      text={msg.text}
                      typing={!!msg.typing}
                      onTypingLayout={msg.typing ? scrollSetupGreetingThreadToBottom : undefined}
                    />
                  </div>
                </div>
              );
            })}
            {analysisError ? <p className="text-center text-xs text-red-500">{analysisError}</p> : null}
            {phase === 'analysis_loading' ? (
              <SetupInlineEnrichmentPanel
                statusLine={loadMsg}
                displayPct={ownEnrichDisplayPct}
                snapshotStages={glassOwnStages}
                showStop
                onCancel={cancelAnalysis}
              />
            ) : phase === 'customer_url_loading' ? (
              <SetupInlineEnrichmentPanel
                statusLine={customerUrlLoadMsg}
                displayPct={targetEnrichDisplayPct}
                snapshotStages={glassTargetStages}
                showStop
                onCancel={cancelAnalysis}
              />
            ) : (
              <SetupInlineEnrichmentPanel
                statusLine="Mapping buying teams for your target accounts…"
                displayPct={buyingLoadPct}
                snapshotStages={glassBuyingStages}
                showStop={false}
              />
            )}
          </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Welcome splash (dark, fallback for chip-select phases during boot) ────
  // Do not steal the canvas from light review / URL phases if they are still mounted.
  if (
    thinking &&
    thread.length === 0 &&
    phase !== 'analysis_results' &&
    phase !== 'customer_url_input' &&
    phase !== 'customer_url_review' &&
    phase !== 'buying_team_review'
  ) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_SURROUND}`}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 p-6 sm:p-10">
          <div className="flex h-[min(36vh,220px)] w-full shrink-0 items-center justify-center">
            <ArcovaWelcomeOrb energised size="lg" />
          </div>
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold text-white">
              {entryPoint === 'target-company' ? 'Add a target company'
                : entryPoint === 'company-only' ? 'Update your company'
                : 'Welcome to Arcova'}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              {entryPoint === 'full' ? 'Getting your workspace ready.' : 'One moment…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Redesigned review/action phase screens ────────────────────────────────

  const timeGreeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();
  const greetName = firstName ? `, ${firstName}` : '';

  // Shared hero wrapper for all light-layout phases
  const setupReviewBackButtonClass =
    'mb-4 inline-flex items-center gap-1.5 rounded-full border border-arcova-navy/10 bg-white/65 px-3 py-1.5 text-[12px] font-medium text-arcova-navy/65 backdrop-blur transition-all hover:-translate-x-0.5 hover:bg-white hover:text-arcova-navy disabled:opacity-50';

  const setupProgressBackButtonClass =
    'shrink-0 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40';

  const LightLayout = ({
    eyebrow,
    title,
    subtitle,
    children,
    onBack,
  }: {
    eyebrow?: ReactNode;
    title: string;
    subtitle?: string;
    children: ReactNode;
    onBack?: () => void;
  }) => (
    <div className="arcova-scroll-surface relative flex min-h-0 flex-1 flex-col overflow-y-auto">
      <AppAmbientBackground />
      <div className="relative z-10 flex min-h-full flex-col px-4 pb-16 pt-10 sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={thinking}
              className={setupReviewBackButtonClass}
            >
              <span aria-hidden>←</span> Back
            </button>
          )}
          {eyebrow && <div className="mb-3">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold text-arcova-navy sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-arcova-ink-soft">{subtitle}</p>}
        </div>
        <div className="mx-auto mt-6 w-full max-w-2xl flex-1">{children}</div>
      </div>
    </div>
  );


  // Phase: analysis_results → light glass review of own company (matches Setup.html design)
  if (phase === 'analysis_results') {
    const domain = analysedUrlForPanel.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'your company';
    const ownResultsSnapshots = buildTieredSnapshotsFromOwn(
      partialOwnEnrichment,
      prettyCompanyUrlHint(lastAnalyzedUrlRef.current),
      ownEnrichStep,
    );
    return (
      <div className="arcova-scroll-surface relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AppAmbientBackground />
        <div className="relative z-10 flex flex-col px-6 py-9 lg:px-10">
            {/* Hero */}
            <div className="mb-6 max-w-[820px]">
              <div className="mb-5">
                <StepEyebrow step={0} />
              </div>
              <h1 className="mb-3 font-manrope text-[44px] font-medium leading-[1.06] tracking-[-0.032em] text-arcova-navy">
                {timeGreeting}{greetName}.<br />
                Here&apos;s what I found on{' '}
                <span className="bg-gradient-to-br from-arcova-teal to-[#007e8b] bg-clip-text text-transparent">
                  {domain}
                </span>
                .
              </h1>
              <p className="m-0 max-w-[640px] text-[15px] leading-[1.6] text-arcova-navy/65">
                {editingFindings ? (
                  'Edit any fields below, then save when you\'re done.'
                ) : (
                  <>
                    Here&apos;s what we have so far. Hit{' '}
                    <strong className="font-semibold text-arcova-navy">Looks good</strong> when it matches how
                    you&apos;d describe the company, or edit to tighten anything that&apos;s off.
                  </>
                )}
              </p>
            </div>

            {ownCompanyAnalysisInFlight ? (
              <div className="mx-auto mb-8 w-full max-w-[760px] rounded-2xl border border-arcova-navy/10 bg-white/80 p-5 shadow-[0_14px_44px_-26px_rgba(13,53,71,0.22)] backdrop-blur-sm">
                <p className="text-sm leading-snug text-arcova-navy/70">{loadMsg}</p>
                <SetupEnrichmentSnapshotStrip stages={ownResultsSnapshots} variant="glass" />
                <div className="mt-3 space-y-1.5">
                  <div className="relative h-2 overflow-hidden rounded-full bg-arcova-navy/[0.09]">
                    <div
                      className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: `${Math.min(100, ownEnrichDisplayPct)}%` }}
                    >
                      <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-10 rounded-full" />
                    </div>
                  </div>
                  <p className="text-right text-xs tabular-nums text-arcova-navy/40">
                    {Math.min(100, Math.round(ownEnrichDisplayPct))}%
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cancelAnalysis()}
                  className="mt-4 text-left text-xs text-arcova-navy/45 underline underline-offset-2 transition-colors hover:text-arcova-navy"
                >
                  Stop
                </button>
              </div>
            ) : null}

            {/* Centred company card */}
            <div
              className={cn(
                'mx-auto w-full max-w-[760px]',
                ownCompanyAnalysisInFlight && 'pointer-events-none opacity-[0.42]',
              )}
            >
              <SetupMyCompanyCard
                data={myCompany}
                editMode={editingFindings}
                onChange={handleMyCompanyChange}
              />

              {/* CTA row */}
              {!editingFindings && (
                <>
                <div className="mt-5 flex flex-wrap items-center gap-3 px-1">
                  <button
                    type="button"
                    onClick={() => void handleResultsConfirmed()}
                    disabled={thinking || ownCompanyAnalysisInFlight}
                    className="inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-br from-arcova-teal to-[#007e8b] px-[22px] py-[13px] text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(0,164,180,0.5)] transition-all hover:-translate-y-px hover:bg-arcova-navy disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                    Looks good — continue
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAnalysisNotRight()}
                    disabled={thinking || ownCompanyAnalysisInFlight}
                    className="bg-transparent px-3.5 py-3 text-[13px] font-medium text-arcova-navy/50 transition-colors hover:text-arcova-navy disabled:opacity-50"
                  >
                    Something&apos;s off
                  </button>
                  <div className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-arcova-navy/50">
                    <span>→</span>
                    Next: <strong className="font-semibold text-arcova-navy/70">Target companies</strong>
                  </div>
                </div>
                <p className="mt-4 px-1 text-center text-[12px] leading-relaxed text-arcova-navy/50">
                  Need a different company website?{' '}
                  <button
                    type="button"
                    disabled={thinking || ownCompanyAnalysisInFlight}
                    onClick={() => void handleResumeRestart()}
                    className="font-semibold text-arcova-teal underline decoration-arcova-teal/35 underline-offset-2 hover:text-arcova-navy disabled:opacity-50"
                  >
                    Start again
                  </button>{' '}
                  (clears company, targets, and buying team).
                </p>
                </>
              )}
              {editingFindings && (
                <div className="mt-5 flex flex-wrap items-center gap-3 px-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSaveChangesClickAnim(true);
                      window.setTimeout(() => setSaveChangesClickAnim(false), 420);
                      void handleSaveFindingsEdit();
                    }}
                    disabled={thinking || savingFindings || ownCompanyAnalysisInFlight}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-[14px] bg-gradient-to-br from-arcova-teal to-[#007e8b] px-[22px] py-[13px] text-sm font-semibold text-white shadow-[0_12px_28px_-12px_rgba(0,164,180,0.5)] transition-all duration-200 ease-out hover:-translate-y-px hover:bg-arcova-navy disabled:opacity-50',
                      saveChangesClickAnim && 'origin-center scale-[0.96] brightness-105 ring-2 ring-arcova-teal/40 ring-offset-2 ring-offset-white/70',
                    )}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
                    {savingFindings ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelFindingsEdit}
                    className="rounded-[14px] border border-arcova-navy/10 bg-white/70 px-5 py-3 text-sm font-medium text-arcova-navy transition-colors hover:bg-white"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
        </div>
      </div>
    );
  }

  // Phase: customer_url_input → URL entry for target company
  if (phase === 'customer_url_input') {
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden">
        <AppAmbientBackground />
        <div className="relative z-10 flex flex-col px-4 pt-6 sm:px-6">
          <button
            type="button"
            onClick={() => void handleGoToStep(0)}
            disabled={thinking}
            className={cn(SETUP_GLASS_BACK_ABOVE_CARD_CLASS, 'mb-3 self-start')}
          >
            <span aria-hidden>←</span> Back
          </button>
          <div className="mb-4">
            <StepEyebrow step={1} />
          </div>
          <SetupWelcomeCard
            firstName={firstName}
            onSubmit={(url) => void handleCustomerUrlAnalyse(url)}
            analysisError={analysisError}
            isLoading={thinking}
            mode="target"
          />
        </div>
      </div>
    );
  }

  // Phase: customer_url_review → light glass review of target company
  if (phase === 'customer_url_review') {
    const targetName = reviewedCompanyName || (lastTargetUrlRef.current?.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? 'the target company');
    return (
      <LightLayout
        eyebrow={<StepEyebrow step={1} />}
        title={`Here's what I found on ${targetName}.`}
        subtitle="Check the fit and confirm — you can tweak before saving."
        onBack={() => void handleGoToStep(0)}
      >
        <div className="arcova-glass-panel p-6">
          <SetupProfilePanel
            {...sharedPanelProps}
            phase={phase}
            analysisLoading={false}
          />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleReviewConfirm()}
            disabled={thinking}
            className={ctaPrimary}
          >
            Looks good, save ICP →
          </button>
          <button
            type="button"
            onClick={() => { setIcpEditMode(false); setPhase('customer_url_conversation'); setInput(true); }}
            disabled={thinking}
            className={ctaSecondary}
          >
            Try a different company
          </button>
        </div>
      </LightLayout>
    );
  }

  // Phase: buying_team_review → light glass review of buying team
  if (phase === 'buying_team_review') {
    const icpName = savedIcpName || reviewedCompanyName || 'this ICP';
    return (
      <LightLayout
        eyebrow={<StepEyebrow step={2} />}
        title={`Here's who typically buys from companies like ${icpName}.`}
        subtitle="Review the roles and seniority — you can adjust before saving."
        onBack={() => void handleGoToStep(1)}
      >
        <div className="arcova-glass-panel p-6">
          <SetupProfilePanel
            {...sharedPanelProps}
            phase={phase}
            analysisLoading={false}
            onConfirmBuyingTeam={() => void savePersona()}
          />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void savePersona()}
            disabled={thinking}
            className={ctaPrimary}
          >
            Looks right →
          </button>
          <button
            type="button"
            onClick={() => setBuyingTeamEditMode((prev) => !prev)}
            disabled={thinking}
            className={ctaSecondary}
          >
            {buyingTeamEditMode ? 'Cancel edits' : "Something's off"}
          </button>
        </div>
        {inputEnabled && (
          <SetupEmbedChatInput
            value={inputValue}
            onChange={(v) => setInputVal(v)}
            onSubmit={(e) => void handleSend(e)}
            disabled={thinking}
            placeholder="Reply to the agent…"
          />
        )}
      </LightLayout>
    );
  }

  // Phase: saving / done → light aurora save splash
  if (phase === 'company_saving' || phase === 'persona_saving' || phase === 'done') {
    const savingLabel =
      phase === 'done' ? 'Redirecting…' : phase === 'persona_saving' ? 'Saving buying team…' : 'Saving profile…';
    return (
      <div className="relative flex min-h-dvh flex-col overflow-hidden">
        <AppAmbientBackground />
        <div className="absolute left-0 right-0 top-0 z-20 flex justify-center px-6 pt-6 sm:px-10">
          <div className="w-full max-w-[1080px]">
            <StepEyebrow step={Math.max(0, currentStepIndex) as 0 | 1 | 2} />
          </div>
        </div>
        <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center gap-5 px-4">
          <ArcovaLoader size={56} />
          <p className="text-sm font-medium text-arcova-ink-soft">{savingLabel}</p>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  const customerUrlChatStages = buildTieredSnapshotsFromTarget(
    partialTargetEnrichment,
    prettyCompanyUrlHint(lastTargetUrlRef.current),
    targetEnrichStep,
  );

  const chatColumn = (
    <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_CARD}`}>
      <div ref={mainChatScrollRef} className="min-h-0 flex-1 overflow-y-auto bg-arcova-darkblue px-4 py-4">
        <div className="space-y-4">
          {visibleMessages.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[min(100%,28rem)] rounded-2xl rounded-tr-none bg-arcova-teal px-4 py-3 text-base leading-relaxed text-white shadow-sm">
                    {msg.text}
                  </div>
                </div>
              );
            }

            const isLastAssistant = i === visibleMessages.length - 1 && msg.kind === 'text';
            return (
              <div key={msg.id} className="flex items-start gap-3">
                <AgentAvatar />
                <div
                  className={`max-w-[min(100%,28rem)] rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm transition-opacity ${
                    !isLastAssistant && i < visibleMessages.length - 2 ? 'opacity-55' : thinking && isLastAssistant ? 'opacity-100 animate-pulse' : 'opacity-100'
                  }`}
                >
                  <SetupAssistantMessageParagraphs
                    text={msg.text}
                    typing={!!msg.typing}
                    paragraphClassName="text-base leading-relaxed text-gray-800"
                    onTypingLayout={msg.typing ? scrollMainChatToBottom : undefined}
                  />
                </div>
              </div>
            );
          })}

          {thinking && <ThinkingDots />}

          {isCustomerUrlLoading && !thinking && (
            <div className="flex items-start gap-3">
              <ArcovaLoader size={36} />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm min-w-52 max-w-sm">
                <p
                  className={cn(
                    'text-sm text-gray-500',
                    customerUrlChatStages.length > 0 ? '' : 'mb-2.5',
                  )}
                >
                  {customerUrlLoadMsg}
                </p>
                <SetupEnrichmentSnapshotStrip stages={customerUrlChatStages} variant="chat" />
                <div className="space-y-1.5">
                  <div className="relative h-2 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: `${targetEnrichDisplayPct}%` }}
                    >
                      <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-10 rounded-full" />
                    </div>
                  </div>
                  <p className="text-right text-xs tabular-nums text-gray-400">{targetEnrichDisplayPct}%</p>
                </div>
                <button
                  type="button"
                  onClick={cancelAnalysis}
                  className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors underline underline-offset-2"
                >
                  Stop
                </button>
              </div>
            </div>
          )}

          {isSaving && !thinking && (
            <div className="flex items-start gap-3">
              <ArcovaLoader size={36} />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm min-w-52">
                <p className="mb-2.5 text-sm text-gray-500">
                  {phase === 'done' ? 'Redirecting…' : phase === 'persona_saving' ? 'Saving buying team…' : 'Saving profile…'}
                </p>
                {phase !== 'done' && (
                  <div className="space-y-1.5">
                    <div className="relative h-2 overflow-hidden rounded-full bg-slate-200/80">
                      <div
                        className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: `${savingPercent}%` }}
                      >
                        <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-10 rounded-full" />
                      </div>
                    </div>
                    <p className="text-right text-xs tabular-nums text-gray-400">{savingPercent}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {analysisError && (
            <p className="py-2 text-center text-base text-red-600">{analysisError}</p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {(showChatBar || widget || showResultsActions) && !isSaving && (
        <div className="shrink-0 space-y-3 border-t border-white/10 bg-arcova-darkblue px-4 py-3">
          {pendingTransition && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmTransition()}
                className="rounded-xl bg-arcova-teal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90"
              >
                {pendingTransition.buttonLabel}
              </button>
              <button
                type="button"
                onClick={() => setPendingTransition(null)}
                className="text-sm text-white/40 transition-colors hover:text-white/70"
              >
                Dismiss
              </button>
            </div>
          )}


          {phase === 'company_select' && (
            <div className="space-y-2">
              {availableCompanyProfiles.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void selectCompanyForBuyingGroup(c)}
                  className="w-full rounded-xl border-2 border-gray-200 bg-white p-3 text-left text-base font-medium text-gray-900 transition-all hover:border-arcova-teal hover:bg-arcova-teal/5"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}


          {widget && (
            <div className="space-y-3">
              <ChipGrid
                options={widget.options}
                selected={chipSel}
                onToggle={(v) => handleChipToggle(v, widget.multi)}
              />
              {widget.multi && (
                <div className="flex items-center justify-between pt-1">
                  {chipSel.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setChipSel([])}
                        className="text-sm text-white/40 transition-colors hover:text-white/70"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={() => handleContinue(chipSel)}
                        className="rounded-xl bg-arcova-teal px-5 py-2.5 text-base font-semibold text-white transition-colors hover:bg-arcova-teal/90"
                      >
                        Continue →
                      </button>
                    </>
                  ) : (
                    <div />
                  )}
                </div>
              )}
            </div>
          )}

          {showChatBar && !pendingTransition && (
            <form onSubmit={handleSend} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputVal(e.target.value)}
                disabled={!inputEnabled}
                placeholder={
                  inputEnabled
                    ? 'Ask anything…'
                    : ''
                }
                className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-arcova-teal disabled:bg-gray-50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputEnabled || !inputValue.trim()}
                className="rounded-xl bg-arcova-teal px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:opacity-30"
              >
                Send
              </button>
            </form>
          )}

          {showResultsActions && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
              {editingFindings ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void handleSaveFindingsEdit()}
                    disabled={savingFindings}
                    className="rounded-xl bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90 disabled:opacity-50"
                  >
                    {savingFindings ? 'Saving…' : 'Save changes'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelFindingsEdit}
                    disabled={savingFindings}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleReanalyseFromPanel}
                    disabled={savingFindings}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 sm:ml-auto"
                  >
                    Re-analyse this site
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void handleResultsConfirmed()}
                    className="rounded-xl bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90"
                  >
                    Looks right →
                  </button>
                  <button
                    type="button"
                    onClick={handleReanalyseFromPanel}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Re-analyse this site
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResumeRestart()}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Start again
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAnalysisNotRight()}
                    className="rounded-xl border border-transparent px-4 py-2 text-sm font-semibold text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 sm:ml-auto"
                  >
                    Not quite right
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_SURROUND}`}>
      {showProgress && (
        <div className="shrink-0 border-b border-white/10 px-6 py-4">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
                {visibleSetupSteps.map((step, i) => {
                const isComplete = i < currentStepIndex;
                const isCurrent = i === currentStepIndex;
                const canGoBack = isComplete && !isSaving;
                return (
                  <button
                    key={step.label}
                    type="button"
                    disabled={!canGoBack}
                    onClick={() => canGoBack && void handleGoToStep(i)}
                    className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      isCurrent
                        ? 'bg-arcova-teal text-white'
                        : isComplete
                        ? 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white cursor-pointer'
                        : 'bg-white/5 text-white/30 cursor-default'
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isCurrent ? 'bg-white/20' : isComplete ? 'bg-white/10' : 'bg-white/5'
                    }`}>
                      {i + 1}
                    </span>
                    {step.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => void handleResumeRestart()}
              className="shrink-0 rounded-full border border-white/25 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/10"
            >
              Start again
            </button>
          </div>
        </div>
      )}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center gap-5 p-4 sm:p-6">
        {/* Chat column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[min(56rem,calc(100dvh-12rem))] min-h-[20rem] w-full flex-col">
            {entryPoint === 'full' && !isSaving && currentStepIndex > 0 && (
              <div className="mb-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleGoToStep(currentStepIndex - 1)}
                  disabled={thinking}
                  className={setupProgressBackButtonClass}
                >
                  <span aria-hidden>←</span> Back
                </button>
              </div>
            )}
            {chatColumn}
          </div>
        </div>

        {/* Profile panel — visible on lg+ */}
        <div className="hidden lg:flex lg:w-72 xl:w-80 shrink-0 flex-col">
          <div className="h-[min(56rem,calc(100dvh-12rem))] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SetupProfilePanel
              phase={phase}
              myCompany={myCompany}
              analysisLoading={false}
              editMode={editingFindings}
              onMyCompanyChange={handleMyCompanyChange}
              onEditCompany={resultsPanelData ? () => void handleAnalysisNotRight() : undefined}
              onSaveEdit={editingFindings ? () => void handleSaveFindingsEdit() : undefined}
              onCancelEdit={editingFindings ? handleCancelFindingsEdit : undefined}
              onDeleteCompany={resultsPanelData ? () => void handleDeleteCompanyProfile() : undefined}
              onReenrichCompany={resultsPanelData && !editingFindings ? handleReanalyseFromPanel : undefined}
              reviewedCompanyName={reviewedCompanyName}
              enrichedTargetCompany={enrichedTargetCompany}
              savedIcpName={savedIcpName}
              panelCompany={panelCompany}
              chipSel={chipSel}
              icpEditMode={icpEditMode}
              onEditIcp={handleEditIcp}
              onSaveIcp={() => void handleSaveIcp()}
              onCancelIcp={handleCancelIcp}
              onReenrichIcp={handleReenrichIcp}
              onDeleteIcp={() => void handleDeleteIcp()}
              onIcpFieldChange={handleIcpFieldChange}
              panelPersona={panelPersona}
              savedPersonaName={savedPersonaName}
              buyingTeamEditMode={buyingTeamEditMode}
              onEditBuyingTeam={() => setBuyingTeamEditMode(true)}
              onCancelBuyingTeamEdit={() => setBuyingTeamEditMode(false)}
              onConfirmBuyingTeam={undefined}
              onToggleBuyingTeamFn={(v) => {
                const next = panelPersona.functions.includes(v)
                  ? panelPersona.functions.filter((x) => x !== v)
                  : [...panelPersona.functions, v];
                personaRef.current.functions = next;
                setPanelPersona((p) => ({ ...p, functions: next }));
              }}
              onToggleBuyingTeamSeniority={(v) => {
                const next = panelPersona.seniority.includes(v)
                  ? panelPersona.seniority.filter((x) => x !== v)
                  : [...panelPersona.seniority, v];
                personaRef.current.seniority = next;
                setPanelPersona((p) => ({ ...p, seniority: next }));
              }}
              buyingTeamExampleCompany={reviewedCompanyName || undefined}
              buyingTeamIcpName={savedIcpName || undefined}
              showSignalPills={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
