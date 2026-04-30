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

import { useState, useEffect, useRef, useCallback } from 'react';
import { parseSSEStream } from '@/lib/sse';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import SetupProfilePanel, { type PanelCompanyData, type PanelPersonaData } from '@/components/SetupProfilePanel';
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
  employeeCountToSizeBucket,
  followerCountToFollowerBucket,
  canonicalizeFundingStage,
} from '@/lib/arcova-taxonomy';
import type { TargetCompanyEnrichmentResult } from '@/lib/target-company-enrichment';

/** Funding, headcount + customer-segment signals for buying-team inference */
function icContextForBuyingTeam(
  icp: PanelCompanyData,
  exampleEnrichment: TargetCompanyEnrichmentResult | null | undefined,
): {
  icp_funding_stages: string[];
  icp_example_employee_count: number | null;
  icp_example_employee_range: string | null;
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

// ── Phase type ─────────────────────────────────────────────────────────────

type Phase =
  | 'greeting'
  | 'analysis_loading'
  | 'analysis_results'
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

type EntryPoint = 'full' | 'target-company' | 'buying-group' | 'company-only';

interface TargetCompanyProfile {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas?: string[];
  modalities?: string[];
  development_stages?: string[];
  company_sizes?: string[];
  funding_stages?: string[];
  example_company_enrichment?: {
    company_name?: string | null;
  } | null;
}

// ── Typing speed ───────────────────────────────────────────────────────────

const TYPING_MS = 18;

/** Full-area backdrop behind the chat column (setup flows only). Dark navy base, teal as accent. */
const SETUP_CHAT_SURROUND =
  'bg-gradient-to-b from-slate-950 to-arcova-darkblue';

/** Card panel floating over the dark surround. */
const SETUP_CHAT_CARD =
  'flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-[0_28px_70px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-[2px]';

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

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

function TypingText({ target }: { target: string }) {
  const [shown, setShown] = useState('');
  const i = useRef(0);

  useEffect(() => {
    i.current = 0;
    setShown('');
    const t = setInterval(() => {
      i.current += 1;
      setShown(target.slice(0, i.current));
      if (i.current >= target.length) clearInterval(t);
    }, TYPING_MS);
    return () => clearInterval(t);
  }, [target]);

  return (
    <>
      {shown}
      {shown.length < target.length && (
        <span className="inline-block w-[2px] h-[14px] bg-arcova-teal ml-0.5 align-middle animate-pulse" />
      )}
    </>
  );
}

// ── Selection chips ────────────────────────────────────────────────────────

type ChipOption = string | { value: string; description?: string };

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
        {(options as Array<{ value: string; description?: string }>).map((o) => (
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
              {o.value}
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
  entryPoint?: EntryPoint;
  onCompletePath?: string;
  companyProfiles?: TargetCompanyProfile[];
  companyContactsMap?: Record<string, string>;
}

export default function SetupFlow({
  firstName,
  entryPoint = 'full',
  onCompletePath,
  companyProfiles = [],
  companyContactsMap = {},
}: SetupFlowProps) {
  const router = useRouter();

  // ── UI state ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('greeting');
  const [thread, setThread] = useState<DisplayMsg[]>([]);
  const [thinking, setThinking] = useState(true);
  const [inputEnabled, setInput] = useState(false);
  const [inputValue, setInputVal] = useState('');
  const [chipSel, setChipSel] = useState<string[]>([]);
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
  const [analysisError, setAnalysisError] = useState('');
  const [pendingTransition, setPendingTransition] = useState<{
    target: 'proceed_to_customer_url' | 'confirm_own_company' | 'restart';
    buttonLabel: string;
  } | null>(null);
  const [reviewDraft, setReviewDraft] = useState({
    companyType: '',
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
  const [savingFindings, setSavingFindings] = useState(false);
  const [icpEditMode, setIcpEditMode] = useState(false);
  const icpEditSnapshotRef = useRef<typeof reviewDraft | null>(null);
  /** Snapshot of enrichment (e.g. competitors) when opening ICP edit from the panel. */
  const icpEditEnrichmentSnapshotRef = useRef<import('@/lib/target-company-enrichment').TargetCompanyEnrichmentResult | null>(null);

  // ── Panel state (mirrors refs so the profile panel re-renders live) ───────
  const [panelCompany, setPanelCompany] = useState<PanelCompanyData>({
    companyType: '', companySizes: [], liFollowerSizes: [], therapeuticAreas: [],
    modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [],
    fundingStages: [],
  });
  const [panelPersona, setPanelPersona] = useState<PanelPersonaData>({ functions: [], seniority: [] });
  const [buyingTeamEditMode, setBuyingTeamEditMode] = useState(false);
  const [savedIcpName, setSavedIcpName] = useState('');
  const [savedPersonaName, setSavedPersonaName] = useState('');

  // ── Accumulated form data (refs avoid stale closure in async callbacks) ──
  const companyRef = useRef({
    companyType: '', companySizes: [] as string[], liFollowerSizes: [] as string[], therapeuticAreas: [] as string[],
    modalities: [] as string[], developmentStages: [] as string[],
    customerTherapeuticAreas: [] as string[], customerModalities: [] as string[], customerDevelopmentStages: [] as string[],
    fundingStages: [] as string[],
  });
  const personaRef = useRef({ functions: [] as string[], seniority: [] as string[], jobTitles: [] as string[] });
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

  // ── Enrichment navigation guard ────────────────────────────────────────────
  const { setIsEnriching } = useEnrichmentGuard();
  const isEnrichingPhase = phase === 'customer_url_loading' || phase === 'analysis_loading';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const availableCompanyProfiles = companyProfiles.filter((company) => !companyContactsMap[company.id]);
  const resolvedCompletePath =
    onCompletePath ?? (entryPoint === 'full' ? '/import' : entryPoint === 'target-company' ? '/company-criteria' : entryPoint === 'company-only' ? '/my-profile' : '/personas');

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
    if (inputEnabled) inputRef.current?.focus();
  }, [inputEnabled]);

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
    if (phase !== 'analysis_loading') {
      ownCompanyStartedAtRef.current = null;
      return;
    }
    if (ownCompanyStartedAtRef.current === null) {
      ownCompanyStartedAtRef.current = Date.now();
    }
    setOwnCompanyProgressNow(Date.now());
    const interval = setInterval(() => setOwnCompanyProgressNow(Date.now()), 900);
    return () => clearInterval(interval);
  }, [phase]);

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
        companySizes: reviewDraft.companySizes,
        liFollowerSizes: reviewDraft.liFollowerSizes,
        therapeuticAreas: reviewDraft.therapeuticAreas,
        modalities: reviewDraft.modalities,
        developmentStages: reviewDraft.developmentStages,
        customerTherapeuticAreas: reviewDraft.customerTherapeuticAreas,
        customerModalities: reviewDraft.customerModalities,
        customerDevelopmentStages: reviewDraft.customerDevelopmentStages,
        fundingStages: reviewDraft.fundingStages,
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
          phase,
          context: {
            entryPoint,
            selectedCompanyName: selectedCompanyName ?? selectedCompanyRef.current?.name ?? null,
            availableCompanyCount,
          },
        }),
      });
      if (!res.ok) throw new Error('agent error');
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
        therapeuticAreas: d.therapeuticAreas,
        modalities: d.modalities,
        developmentStages: d.developmentStages,
        customerTherapeuticAreas: d.customerTherapeuticAreas,
        customerModalities: d.customerModalities,
        customerDevelopmentStages: d.customerDevelopmentStages,
        fundingStages: d.fundingStages,
        companySizes: d.companySizes,
        exampleCompanyName: enrichedTargetCompany?.company_name ?? reviewedCompanyName ?? null,
        exampleCompanyDescription: enrichedTargetCompany?.description ?? null,
      }),
    });
    const { summary: icpSummary } = summaryRes.ok
      ? await summaryRes.json()
      : { summary: '' };

    const saveRes = await fetch('/api/company-criteria', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        icpSummary,
        companyType: d.companyType,
        therapeuticAreas: d.therapeuticAreas,
        modalities: d.modalities,
        developmentStages: d.developmentStages,
        customerTherapeuticAreas: d.customerTherapeuticAreas,
        customerModalities: d.customerModalities,
        customerDevelopmentStages: d.customerDevelopmentStages,
        companySizes: d.companySizes,
        liFollowerSizes: d.liFollowerSizes,
        fundingStages: d.fundingStages,
        signals: [],
        exampleCompanies: [],
        exampleCompanyUrl: enrichedTargetCompany?.website ?? lastTargetUrlRef.current ?? '',
        exampleCompanyEnrichment: enrichedTargetCompany ?? undefined,
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
        seller_therapeutic_areas: sellerData.therapeutic_areas,
        seller_products_services: sellerData.products_services,
        seller_services: sellerData.services,
        seller_customers_we_serve: sellerData.customers_we_serve,
        seller_value_propositions: sellerData.value_propositions,
        icp_company_type: icpData.companyType,
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

  // ── Save persona ──────────────────────────────────────────────────────────

  const savePersona = useCallback(async () => {
    setPhase('persona_saving');
    setBuyingTeamEditMode(false);
    const p = personaRef.current;

    const personaName =
      p.functions.length > 0 ? `Buying group: ${p.functions[0]}` : 'Buying group';
    setSavedPersonaName(personaName);

    const personaRes = await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: personaName,
        functions: p.functions,
        seniorityLevels: p.seniority,
        jobTitles: p.jobTitles,
        signals: [],
        icpId: icpIdRef.current,
      }),
    });
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
          '[System: setup for this flow is complete. Brief congratulations: they can import contacts next, and add company profiles or edit this buying group anytime. Max 2 short sentences.]',
      },
    });
    if (displayParts.length) await sayBeats(displayParts);

    setPhase('done');
    setTimeout(() => router.push(resolvedCompletePath), 2500);
  }, [askClaude, router, resolvedCompletePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const startBuyingGroupForCompany = useCallback(async (co: TargetCompanyProfile) => {
    selectedCompanyRef.current = co;
    icpIdRef.current = co.id;

    const nextCompanyState = {
      companyType: co.company_type || '',
      companySizes: co.company_sizes || [],
      liFollowerSizes: (co as unknown as Record<string, unknown>).li_follower_sizes as string[] || [],
      therapeuticAreas: co.therapeutic_areas || [],
      modalities: co.modalities || [],
      developmentStages: co.development_stages || [],
      customerTherapeuticAreas: (co as unknown as Record<string, unknown>).customer_therapeutic_areas as string[] || [],
      customerModalities: (co as unknown as Record<string, unknown>).customer_modalities as string[] || [],
      customerDevelopmentStages: (co as unknown as Record<string, unknown>).customer_development_stages as string[] || [],
      fundingStages: co.funding_stages || [],
    };

    companyRef.current = nextCompanyState;
    setPanelCompany(nextCompanyState);
    setSavedIcpName(co.name || '');

    const exampleCompanyName = co.example_company_enrichment?.company_name || co.name || 'this company profile';
    setReviewedCompanyName(exampleCompanyName);
    setEnrichedTargetCompany((co.example_company_enrichment as import('@/lib/target-company-enrichment').TargetCompanyEnrichmentResult | null | undefined) ?? null);

    const analysesRes = await fetch('/api/user-analyses');
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
        seller_therapeutic_areas: sellerData.therapeutic_areas,
        seller_products_services: sellerData.products_services,
        seller_services: sellerData.services,
        seller_customers_we_serve: sellerData.customers_we_serve,
        seller_value_propositions: sellerData.value_propositions,
        icp_company_type: nextCompanyState.companyType,
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
      setPanelPersona({ functions: fns, seniority: sens, jobTitles: titles });
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
        case 'persona_seniority': await savePersona(); break;
      }
    })();
  }, [phase, advanceTo, saveIcp, savePersona]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle analysis results confirmed ────────────────────────────────────

  const handleResultsConfirmed = useCallback(async () => {
    pushText('user', 'Looks right');
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

    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content:
          "[System: the user confirmed their own company profile looks right. Transition to step 2 in one short sentence — something like: \"Great, now let's build your target company list. Drop in a URL — a dream account or a company that looks like your best customer — and I'll profile it.\" Conversational, no bullet points, max 2 sentences.]",
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
    setPhase('customer_url_input');
    setInput(true);
  }, [askClaude, entryPoint, resolvedCompletePath, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Progress step navigation ──────────────────────────────────────────────

  const handleGoToStep = useCallback(async (stepIndex: number) => {
    if (stepIndex === 0) {
      // Back to profile — restart own company URL
      icpIdRef.current = null;
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content: '[System: the user wants to go back and redo their company profile. One sentence: acknowledge and ask them to enter their company website URL.]',
        },
      });
      if (displayParts.length) await sayBeats(displayParts);
      setPhase('greeting');
      setInput(true);
    } else if (stepIndex === 1) {
      // Back to target companies — restart customer URL
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content: '[System: the user wants to go back and update their target company profile. One sentence: acknowledge and ask them to drop in a URL for a target account.]',
        },
      });
      if (displayParts.length) await sayBeats(displayParts);
      setPhase('customer_url_input');
      setInput(true);
    }
  }, [askClaude]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleResumeRestart = useCallback(async () => {
    pushText('user', 'Start again');

    // Delete ICP from DB
    const icpId = icpIdRef.current;
    if (icpId) {
      try {
        await fetch('/api/company-criteria', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: icpId }),
        });
      } catch {}
    }

    // Delete own-company analysis from DB
    const analysisId = typeof editingFindingsData?.id === 'string' ? editingFindingsData.id : null;
    if (analysisId) {
      try {
        await fetch(`/api/user-analyses?id=${analysisId}`, { method: 'DELETE' });
      } catch {}
    }

    // Reset all local state
    icpIdRef.current = null;
    lastTargetUrlRef.current = null;
    lastAnalyzedUrlRef.current = null;
    selectedCompanyRef.current = null;
    setEnrichedTargetCompany(null);
    setReviewedCompanyName('');
    setReviewDraft({ companyType: '', therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], companySizes: [], liFollowerSizes: [], fundingStages: [] });
    setSavedIcpName('');
    setSavedPersonaName('');
    setPanelCompany({ companyType: '', companySizes: [], liFollowerSizes: [], therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], fundingStages: [] });
    setPanelPersona({ functions: [], seniority: [], jobTitles: [] });
    setEditingFindings(false);
    setEditingFindingsData(null);
    setThread([]);

    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: '[System: the user wants to start fresh. One sentence: acknowledge and ask them to enter their company website URL to begin.]',
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
    setPhase('greeting');
    setInput(true);
  }, [askClaude, editingFindingsData]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setPhase('customer_url_input');
        setInput(true);
        break;
      case 'confirm_own_company':
        await handleResultsConfirmed();
        break;
    }
  }, [pendingTransition, handleResumeRestart, handleResultsConfirmed]); // eslint-disable-line react-hooks/exhaustive-deps

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
          setCustomerUrlLoadMsg('Website analysed ✓  Checking company database…');
          setTargetEnrichStep(1);
          setPartialTargetEnrichment({
            company_name: (eventData.company_name as string) || null,
            description: Array.isArray(eventData.description) ? (eventData.description as string[]) : null,
          });
        } else if (event === 'step_apollo') {
          setCustomerUrlLoadMsg('Company data retrieved ✓  Scanning LinkedIn…');
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
        } else if (event === 'step_apify') {
          setCustomerUrlLoadMsg('LinkedIn scanned ✓  Classifying company…');
          setTargetEnrichStep(3);
          setPartialTargetEnrichment((prev) => ({
            ...prev,
            logo_url: (eventData.logo_url as string) || null,
            tagline: (eventData.tagline as string) || null,
            follower_count: typeof eventData.follower_count === 'number' ? eventData.follower_count : null,
          }));
        } else if (event === 'step_taxonomy') {
          setCustomerUrlLoadMsg('Classified ✓  Finishing up…');
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

      const draft = {
        companyType: data.company_type ?? '',
        therapeuticAreas: data.therapeutic_areas ?? [],
        modalities: data.modalities ?? [],
        developmentStages: data.development_stages ?? [],
        customerTherapeuticAreas: data.customer_therapeutic_areas ?? [],
        customerModalities: data.customer_modalities ?? [],
        customerDevelopmentStages: data.customer_development_stages ?? [],
        companySizes: employeeCountToSizeBucket(data.employee_count, data.employee_range),
        liFollowerSizes: followerCountToFollowerBucket(data.follower_count),
        fundingStages: (() => { const s = canonicalizeFundingStage(data.funding_stage, data.total_funding_usd); return s ? [s] : []; })(),
      };
      setReviewDraft(draft);

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
          content: `[System: analysis of the customer company "${name}" is complete and we've auto-generated an ICP profile from it. One sentence: tell the user the profile is ready on the right — they can edit it before saving or just save it as is.]`,
        },
      });
      if (displayParts.length) await sayBeats(displayParts);

      setPhase('customer_url_review');
      setInput(true);
    } catch {
      await say("Couldn't analyse that URL — check it's correct and try again.");
      setPhase('customer_url_input');
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
    if (phase === 'customer_url_loading') {
      setPhase('customer_url_input');
      return;
    }
    setPhase('greeting');
  }, []);

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

    try {
      const res = await fetch('/api/analyze-and-store-stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: normalized }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      analysisAbortRef.current = null;
      if (!res.ok) throw new Error('Analysis failed');

      let data: Record<string, unknown> | null = null;
      for await (const { event, data: eventData } of parseSSEStream(res)) {
        if (event === 'step_claude') {
          setLoadMsg('Website analysed ✓  Checking company database…');
          setOwnEnrichStep(1);
          setPartialOwnEnrichment({
            company_name: (eventData.company_name as string) || null,
            description: Array.isArray(eventData.description) ? eventData.description : null,
          });
        } else if (event === 'step_apollo') {
          setLoadMsg('Company data retrieved ✓  Scanning LinkedIn…');
          setOwnEnrichStep(2);
          setPartialOwnEnrichment((prev) => ({
            ...prev,
            employee_count: typeof eventData.company_employee_count === 'number' ? eventData.company_employee_count : null,
            industry: (eventData.company_industry as string) || null,
            hq_city: (eventData.company_hq_city as string) || null,
            hq_country: (eventData.company_hq_country as string) || null,
            funding_stage: (eventData.company_funding_stage as string) || null,
          }));
        } else if (event === 'step_apify') {
          setLoadMsg('LinkedIn scanned ✓  Classifying company…');
          setOwnEnrichStep(3);
          setPartialOwnEnrichment((prev) => ({
            ...prev,
            logo_url: (eventData.logo_url as string) || null,
            tagline: (eventData.tagline as string) || null,
            follower_count: typeof eventData.follower_count === 'number' ? eventData.follower_count : null,
          }));
        } else if (event === 'step_taxonomy') {
          setLoadMsg('Classified ✓  Finishing up…');
          setOwnEnrichStep(4);
        } else if (event === 'done') {
          data = eventData;
        } else if (event === 'error') {
          throw new Error((eventData.message as string) || 'Analysis failed');
        }
      }
      if (!data) throw new Error('Analysis failed');
      setEditingFindings(false);
      setEditingFindingsData(data);

      // Claude comments on what it found
      const narrationPrompt = isReenrich
        ? `[System: re-enrichment of ${data.company_name ?? normalized} is complete. Give a single short sentence confirming the company profile has been refreshed with the latest data — no reaction, no praise, just a calm factual update.]`
        : `[System: analysis of ${normalized} is complete. Company: ${data.company_name ?? normalized}. Give a 1-sentence warm reaction and tell them all the details are now showing in their company card on the right — no need to list anything out.]`;
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: { role: 'user', content: narrationPrompt },
      });
      if (displayParts.length) await sayBeats(displayParts);

      // Keep results on the thread for data + history; UI shows them in the side panel only.
      setThread((p) => [...p, { id: crypto.randomUUID(), kind: 'results', data }]);
      if (!isReenrich) setPhase('analysis_results');
      setInput(true);

    } catch (err) {
      clearTimeout(timeout);
      analysisAbortRef.current = null;
      // Aborted (user cancel or timeout) — reset silently, don't show an error
      if (err instanceof Error && err.name === 'AbortError') {
        if (!isReenrich) { setPhase('greeting'); setInput(true); }
        return;
      }
      setAnalysisError("Couldn't analyse that website, maybe it's blocking us. Try another URL.");
      if (!isReenrich) { setPhase('greeting'); setInput(true); }
    }
  }, [askClaude, formatFindingsSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReanalyseFromPanel = useCallback(() => {
    const u = lastAnalyzedUrlRef.current;
    if (u) void runAnalysis(u, true);
  }, [runAnalysis]);

  const getLatestResultsData = useCallback((): Record<string, unknown> | null => {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const message = thread[i];
      if (message.kind === 'results') return message.data;
    }
    return null;
  }, [thread]);

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
    const data = editingFindingsData ?? getLatestResultsData();
    const id = typeof data?.id === 'string' ? data.id : null;
    if (id) {
      try {
        await fetch(`/api/user-analyses?id=${id}`, { method: 'DELETE' });
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
    setReviewDraft({ companyType: '', therapeuticAreas: [], modalities: [], developmentStages: [], customerTherapeuticAreas: [], customerModalities: [], customerDevelopmentStages: [], companySizes: [], liFollowerSizes: [], fundingStages: [] });
    setReviewedCompanyName('');
    setEnrichedTargetCompany(null);
    setSavedIcpName('');
    lastTargetUrlRef.current = null;
    setPhase('customer_url_input');
    setInput(true);
    await say('Profile deleted. Drop in a URL or company name and I\'ll build a fresh one.');
  }, [say]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeletePersona = useCallback(async () => {
    const id = personaIdRef.current;
    if (id) {
      try { await fetch(`/api/contacts?id=${id}`, { method: 'DELETE' }); } catch {}
      personaIdRef.current = null;
    }
    setPanelPersona({ functions: [], seniority: [], jobTitles: [] });
    personaRef.current = { functions: [], seniority: [], jobTitles: [] };
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
        seller_therapeutic_areas: sellerData.therapeutic_areas,
        seller_products_services: sellerData.products_services,
        seller_services: sellerData.services,
        seller_customers_we_serve: sellerData.customers_we_serve,
        seller_value_propositions: sellerData.value_propositions,
        icp_company_type: icpData.companyType,
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
      setPanelPersona({ functions: fns, seniority: sens, jobTitles: titles });
      setBuyingTeamEditMode(false);
      setPhase('buying_team_review');
      setInput(false);
    }
  }, [editingFindingsData, reviewedCompanyName, enrichedTargetCompany]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyseDifferentWebsite = useCallback(async () => {
    setThread((prev) => prev.filter((m) => m.kind !== 'results'));
    setEditingFindings(false);
    setEditingFindingsData(null);
    setPhase('greeting');
    setInput(true);
    setInputVal('');
    await say('Sure. Share the new company website and I will analyse that instead.');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancelFindingsEdit = useCallback(() => {
    setEditingFindings(false);
    setEditingFindingsData(preEditDataRef.current);
  }, []);

  const handleSaveFindingsEdit = useCallback(async () => {
    if (!editingFindingsData) return;
    setSavingFindings(true);
    try {
      const id = typeof editingFindingsData.id === 'string' ? editingFindingsData.id : null;
      let nextData = editingFindingsData;

      if (id) {
        const response = await fetch('/api/user-analyses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingFindingsData),
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
  }, [editingFindingsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ICP card inline edit handlers ────────────────────────────────────────

  const handleEditIcp = useCallback(() => {
    icpEditSnapshotRef.current = { ...reviewDraft };
    icpEditEnrichmentSnapshotRef.current = enrichedTargetCompany ? { ...enrichedTargetCompany } : null;
    setIcpEditMode(true);
  }, [reviewDraft, enrichedTargetCompany]);

  const handleCancelIcp = useCallback(() => {
    if (icpEditSnapshotRef.current) {
      setReviewDraft(icpEditSnapshotRef.current);
    }
    if (icpEditEnrichmentSnapshotRef.current) {
      setEnrichedTargetCompany(icpEditEnrichmentSnapshotRef.current);
    }
    setIcpEditMode(false);
  }, []);

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
    if (field === 'competitorsEnriched') {
      setEnrichedTargetCompany((prev) => (prev
        ? {
            ...prev,
            competitors_enriched: value as import('@/components/SetupProfilePanel').CompetitorItem[],
          }
        : prev));
      return;
    }
    setReviewDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ── Handle user text input (greeting phase) ───────────────────────────────

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || !inputEnabled) return;

    setInputVal('');
    setInput(false);
    setPendingTransition(null);
    pushText('user', text);

    const response = await askClaude({
      mode: phase === 'greeting' || phase === 'customer_url_input' ? 'conversation' : 'phase_help',
      phase,
      extra: { role: 'user', content: text },
    });

    if (response.displayParts.length) {
      await sayBeats(response.displayParts);
    }

    const beginAnalysis = response.actions.find(
      (action): action is Extract<OnboardingAction, { type: 'begin_analysis' }> =>
        action.type === 'begin_analysis'
    );

    if (beginAnalysis?.website_url) {
      const isCustomer =
        phase === 'customer_url_input' ||
        beginAnalysis.analysis_type === 'target_customer';
      if (isCustomer) {
        await handleCustomerUrlAnalyse(beginAnalysis.website_url);
      } else {
        await runAnalysis(beginAnalysis.website_url);
      }
      return;
    }

    const transition = response.actions.find(
      (a): a is Extract<OnboardingAction, { type: 'confirm_transition' }> => a.type === 'confirm_transition'
    );
    if (transition) {
      setPendingTransition({ target: transition.target, buttonLabel: transition.button_label });
    }

    setInput(true);
  }, [inputValue, inputEnabled, phase, askClaude, runAnalysis, handleCustomerUrlAnalyse]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mount: start the conversation (entry point chooses opening phase) ──

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      if (entryPoint === 'full') {
        let bootstrapExampleEnrichment: TargetCompanyEnrichmentResult | null = null;
        // Decision tree: check what the user has already completed and resume from the right step.
        const [analysesRes, icpRes, personaRes] = await Promise.all([
          fetch('/api/user-analyses'),
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
            companySizes: Array.isArray(icp.company_sizes) ? (icp.company_sizes as string[]) : [],
            liFollowerSizes: Array.isArray(icp.li_follower_sizes) ? (icp.li_follower_sizes as string[]) : [],
            therapeuticAreas: Array.isArray(icp.therapeutic_areas) ? (icp.therapeutic_areas as string[]) : [],
            modalities: Array.isArray(icp.modalities) ? (icp.modalities as string[]) : [],
            developmentStages: Array.isArray(icp.development_stages) ? (icp.development_stages as string[]) : [],
            customerTherapeuticAreas: Array.isArray(icp.customer_therapeutic_areas) ? (icp.customer_therapeutic_areas as string[]) : [],
            customerModalities: Array.isArray(icp.customer_modalities) ? (icp.customer_modalities as string[]) : [],
            customerDevelopmentStages: Array.isArray(icp.customer_development_stages) ? (icp.customer_development_stages as string[]) : [],
            fundingStages: Array.isArray(icp.funding_stages) ? (icp.funding_stages as string[]) : [],
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
          });
        }

        // Leg 1: nothing stored — greet and ask for company URL
        if (!existingAnalysis) {
          const { displayParts } = await askClaude();
          if (displayParts.length) await sayBeats(displayParts);
          setInput(true);
          return;
        }

        // Leg 2: company done, no ICP — skip greeting, go straight to target company step
        if (existingIcps.length === 0) {
          const { displayParts } = await askClaude({
            mode: 'narration',
            extra: {
              role: 'user',
              content: '[System: the user\'s company profile is already set up. One sentence: acknowledge this and invite them to drop in a target account URL to define who they sell to.]',
            },
          });
          if (displayParts.length) await sayBeats(displayParts);
          setPhase('customer_url_input');
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
              seller_therapeutic_areas: sellerData.therapeutic_areas,
              seller_products_services: sellerData.products_services,
              seller_services: sellerData.services,
              seller_customers_we_serve: sellerData.customers_we_serve,
              seller_value_propositions: sellerData.value_propositions,
              icp_company_type: icpData.companyType,
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
            setPanelPersona({ functions: fns, seniority: sens, jobTitles: titles });
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

        // Leg 4: everything done — brief confirmation then redirect
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
        if (displayParts.length) await sayBeats(displayParts);
        setInput(true);
        return;
      }

      if (entryPoint === 'target-company') {
        // Fetch seller analysis so buying-team generation later has full context
        const analysesRes = await fetch('/api/user-analyses');
        const existingAnalysis = analysesRes.ok ? ((await analysesRes.json())?.analyses?.[0] ?? null) : null;
        if (existingAnalysis) {
          setEditingFindingsData(existingAnalysis as Record<string, unknown>);
          const storedWebsite = (existingAnalysis as Record<string, unknown>).website;
          if (typeof storedWebsite === 'string' && storedWebsite) {
            lastAnalyzedUrlRef.current = storedWebsite;
          }
        }

        const intro = await askClaude({
          mode: 'narration',
          extra: {
            role: 'user',
            content: `[System: The user is adding a new target company profile. Two short sentences: welcome them and invite them to drop in the URL of a dream target account to get started.]`,
          },
        });
        if (intro.displayParts.length) await sayBeats(intro.displayParts);
        setPhase('customer_url_input');
        setInput(true);
        return;
      }

      // buying-group: needs an ICP row to attach the persona to
      if (availableCompanyProfiles.length === 0) {
        const { displayParts } = await askClaude({
          mode: 'narration',
          extra: {
            role: 'user',
            content:
              '[System: There is no target company profile available yet for a buying group. Two short sentences: explain they need a target company profile first, and that you will send them to create one.]',
          },
        });
        if (displayParts.length) await sayBeats(displayParts);
        setPhase('done');
        setTimeout(() => router.push('/company-criteria/new'), 2200);
        return;
      }

      if (availableCompanyProfiles.length === 1) {
        const co = availableCompanyProfiles[0];
        await startBuyingGroupForCompany(co);
        return;
      }

      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content:
            '[System: The user has more than one target company profile that still needs a buying group. Two short sentences: ask them to pick which profile below, then they will define the full buying group for it.]',
        },
      });
      if (displayParts.length) await sayBeats(displayParts);
      setPhase('company_select');
      setInput(true);
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
    if (phase !== 'analysis_loading' || ownCompanyStartedAtRef.current === null) return 0;
    const elapsed = Math.max(ownCompanyProgressNow - ownCompanyStartedAtRef.current, 0);
    const progress = 1 - Math.exp(-elapsed / 11000);
    return Math.round(5 + (85 - 5) * progress);
  })();

  // Once SSE steps arrive, switch from fake timer curve to real step-based progress.
  // Cap the fake curve at 20% so the first real event (step 1 → 30%) always feels like forward movement.
  const ENRICH_STEP_PCT = [30, 55, 75, 92] as const;
  const targetEnrichDisplayPct = targetEnrichStep > 0
    ? ENRICH_STEP_PCT[targetEnrichStep - 1] ?? 92
    : Math.min(customerUrlPercent, 20);
  const ownEnrichDisplayPct = ownEnrichStep > 0
    ? ENRICH_STEP_PCT[ownEnrichStep - 1] ?? 92
    : Math.min(ownCompanyPercent, 20);

  const savingPercent = (() => {
    if (!isSaving || savingStartedAtRef.current === null) return 0;
    const elapsed = Math.max(savingProgressNow - savingStartedAtRef.current, 0);
    const progress = 1 - Math.exp(-elapsed / 4000);
    return Math.round(5 + (90 - 5) * progress);
  })();

  const SETUP_STEPS = [
    { label: 'Your company', phases: ['greeting', 'analysis_loading', 'analysis_results'] as Phase[] },
    { label: 'Target companies', phases: ['customer_url_input', 'customer_url_loading', 'customer_url_review', 'company_type', 'company_size', 'company_ta', 'company_modality', 'company_stage', 'company_funding', 'company_saving'] as Phase[] },
    { label: 'Buying teams', phases: ['buying_team_loading', 'buying_team_review', 'persona_functions', 'persona_seniority', 'persona_saving', 'done'] as Phase[] },
  ];
  const currentStepIndex = SETUP_STEPS.findIndex((s) => s.phases.includes(phase));
  const showProgress = (entryPoint === 'full') && currentStepIndex >= 0;
  const isCustomerUrlReview = phase === 'customer_url_review';
  const isReviewValid =
    reviewDraft.companyType !== '' &&
    (reviewDraft.therapeuticAreas.length > 0 ||
      reviewDraft.modalities.length > 0 ||
      reviewDraft.customerTherapeuticAreas.length > 0 ||
      reviewDraft.customerModalities.length > 0 ||
      reviewDraft.developmentStages.length > 0 ||
      reviewDraft.customerDevelopmentStages.length > 0);

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

  // ── Welcome splash ────────────────────────────────────────────────────────

  if (thinking && thread.length === 0) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_SURROUND}`}>
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
          <div
            className={`flex min-h-[18rem] max-h-[min(32rem,calc(100dvh-12rem))] w-full max-w-3xl ${SETUP_CHAT_CARD}`}
          >
            <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-arcova-darkblue px-6 py-10 text-center">
              <ArcovaLoader size={64} />
              <div>
                <h1 className="text-2xl font-bold text-white">
                  {entryPoint === 'target-company' ? 'Add a target company'
                    : entryPoint === 'buying-group' ? 'Add a buying team'
                    : entryPoint === 'company-only' ? 'Update your company'
                    : 'Welcome to Arcova'}
                </h1>
                <p className="mt-2 text-sm text-slate-300">
                  {entryPoint === 'full' ? 'Getting your workspace ready.' : 'One moment…'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  const chatColumn = (
    <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_CARD}`}>
      <div className="min-h-0 flex-1 overflow-y-auto bg-arcova-darkblue px-4 py-4">
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
                  <p className="whitespace-pre-wrap text-base leading-relaxed text-gray-800">
                    {msg.typing ? <TypingText target={msg.text} /> : msg.text}
                  </p>
                </div>
              </div>
            );
          })}

          {thinking && <ThinkingDots />}

          {isCustomerUrlLoading && !thinking && (
            <div className="flex items-start gap-3">
              <ArcovaLoader size={36} />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm min-w-52 max-w-sm">
                <p className="mb-2.5 text-sm text-gray-500">{customerUrlLoadMsg}</p>
                {/* Partial data preview — populates as SSE steps arrive */}
                {partialTargetEnrichment && (partialTargetEnrichment.company_name || partialTargetEnrichment.description) && (
                  <div className="mb-3 space-y-1 border-t border-gray-100 pt-2.5">
                    {partialTargetEnrichment.company_name && (
                      <p className="font-semibold text-sm text-gray-800">{partialTargetEnrichment.company_name}</p>
                    )}
                    {partialTargetEnrichment.description?.[0] && (
                      <p className="text-xs text-gray-500 line-clamp-2">{partialTargetEnrichment.description[0]}</p>
                    )}
                    {(partialTargetEnrichment.industry || partialTargetEnrichment.employee_count) && (
                      <p className="text-xs text-gray-400">
                        {[
                          partialTargetEnrichment.industry,
                          partialTargetEnrichment.employee_count
                            ? `${partialTargetEnrichment.employee_count.toLocaleString()} employees`
                            : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {(partialTargetEnrichment.hq_city || partialTargetEnrichment.hq_country) && (
                      <p className="text-xs text-gray-400">
                        {[partialTargetEnrichment.hq_city, partialTargetEnrichment.hq_country].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                )}
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

          {phase === 'analysis_loading' && !thinking && (
            <div className="flex items-start gap-3">
              <ArcovaLoader size={36} />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm min-w-52 max-w-sm">
                <p className="mb-2.5 text-sm text-gray-500">{loadMsg}</p>
                {/* Partial data preview — populates as SSE steps arrive */}
                {!!partialOwnEnrichment && !!(partialOwnEnrichment.company_name || partialOwnEnrichment.description) && (
                  <div className="mb-3 space-y-1 border-t border-gray-100 pt-2.5">
                    {!!partialOwnEnrichment.company_name && (
                      <p className="font-semibold text-sm text-gray-800">{String(partialOwnEnrichment.company_name)}</p>
                    )}
                    {Array.isArray(partialOwnEnrichment.description) && !!(partialOwnEnrichment.description as string[])[0] && (
                      <p className="text-xs text-gray-500 line-clamp-2">{(partialOwnEnrichment.description as string[])[0]}</p>
                    )}
                    {!!(partialOwnEnrichment.industry || partialOwnEnrichment.employee_count) && (
                      <p className="text-xs text-gray-400">
                        {[
                          partialOwnEnrichment.industry as string | null,
                          typeof partialOwnEnrichment.employee_count === 'number'
                            ? `${(partialOwnEnrichment.employee_count as number).toLocaleString()} employees`
                            : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {!!(partialOwnEnrichment.hq_city || partialOwnEnrichment.hq_country) && (
                      <p className="text-xs text-gray-400">
                        {[partialOwnEnrichment.hq_city as string | null, partialOwnEnrichment.hq_country as string | null].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <div className="relative h-2 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className="arcova-enrichment-progress absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: `${ownEnrichDisplayPct}%` }}
                    >
                      <div className="arcova-enrichment-glow absolute inset-y-0 right-0 w-10 rounded-full" />
                    </div>
                  </div>
                  <p className="text-right text-xs tabular-nums text-gray-400">{ownEnrichDisplayPct}%</p>
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

          {phase === 'buying_team_loading' && !thinking && (
            <div className="flex items-start gap-3">
              <ArcovaLoader size={36} />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <span className="text-base text-gray-600">Inferring buying team…</span>
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

      {(showChatBar || widget || showResultsActions || isCustomerUrlReview) && !isSaving && (
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


          {phase === 'buying_team_review' && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-sm text-gray-500">
                Review the buying team in the card on the right. You can tweak the teams or seniority before saving.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => void savePersona()}
                  className="rounded-xl bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90"
                >
                  Looks right →
                </button>
                <button
                  type="button"
                  onClick={() => setBuyingTeamEditMode((prev) => !prev)}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  {buyingTeamEditMode ? 'Cancel edits' : "No this isn't quite right"}
                </button>
              </div>
            </div>
          )}

          {isCustomerUrlReview && (
            <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => void handleReviewConfirm()}
                  className="rounded-xl bg-arcova-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-arcova-teal/90"
                >
                  Looks right, save ICP →
                </button>
                <button
                  type="button"
                  onClick={() => { setIcpEditMode(false); setPhase('customer_url_input'); setInput(true); }}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Try a different company
                </button>
              </div>
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
                    ? phase === 'greeting'
                      ? 'e.g. arcova.app'
                      : phase === 'customer_url_input'
                      ? 'e.g. guardanthealth.com'
                      : 'Ask anything…'
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
                    onClick={() => void handleAnalyseDifferentWebsite()}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Analyse a different site
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

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_SURROUND}`}>
      {showProgress && (
        <div className="shrink-0 border-b border-white/10 px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div className="flex items-center gap-2">
              {SETUP_STEPS.map((step, i) => {
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
              className="text-sm text-white/40 hover:text-white/70 transition-colors"
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
            {chatColumn}
          </div>
        </div>

        {/* Profile panel — visible on lg+ */}
        <div className="hidden lg:flex lg:w-72 xl:w-80 shrink-0 flex-col">
          <div className="h-[min(56rem,calc(100dvh-12rem))] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SetupProfilePanel
              phase={phase}
              myCompany={myCompany}
              analysisLoading={phase === 'analysis_loading'}
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
              onConfirmBuyingTeam={phase === 'buying_team_review' ? () => void savePersona() : undefined}
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}
