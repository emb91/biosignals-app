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
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArcovaLoader } from '@/components/ArcovaLoader';
import {
  BUSINESS_AREA_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  MODALITY_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
} from '@/lib/arcova-taxonomy';

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
  | 'company_select'
  | 'company_type'
  | 'company_size'
  | 'company_ta'
  | 'company_modality'
  | 'company_stage'
  | 'company_funding'
  | 'company_saving'
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
  persona_functions: 'Define the full buying group for this profile: functions or teams that shape the buying decision. Pick all that apply.',
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
  | { type: 'begin_analysis'; website_url: string };

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

type EntryPoint = 'full' | 'target-company' | 'buying-group';

interface TargetCompanyProfile {
  id: string;
  name: string;
  company_type: string;
  therapeutic_areas?: string[];
  company_sizes?: string[];
  funding_stages?: string[];
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
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-arcova-darkblue ring-2 ring-white/15">
      <Image src="/images/network-og.png" alt="Arcova" width={20} height={20} className="rounded-full" />
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar />
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
                ? 'border-arcova-teal bg-arcova-teal/5'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <p className={`font-medium ${selected.includes(o.value) ? 'text-arcova-teal' : 'text-gray-900'}`}>
              {o.value}
            </p>
            {o.description && <p className="mt-0.5 text-sm text-gray-500">{o.description}</p>}
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
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
  const [analysisError, setAnalysisError] = useState('');
  const [editingFindings, setEditingFindings] = useState(false);
  const [editingFindingsData, setEditingFindingsData] = useState<Record<string, unknown> | null>(null);
  const [savingFindings, setSavingFindings] = useState(false);

  // ── Accumulated form data (refs avoid stale closure in async callbacks) ──
  const companyRef = useRef({
    companyType: '', companySizes: [] as string[], therapeuticAreas: [] as string[],
    modalities: [] as string[], developmentStages: [] as string[], fundingStages: [] as string[],
  });
  const personaRef = useRef({ functions: [] as string[], seniority: [] as string[] });
  const icpIdRef = useRef<string | null>(null);
  const selectedCompanyRef = useRef<TargetCompanyProfile | null>(null);
  const historyRef = useRef<ApiMsg[]>([]);
  const firstNameRef = useRef(firstName);
  const startedRef = useRef(false);
  /** Normalised URL for the last successful analyse-and-store run (re-analyse / panel header). */
  const lastAnalyzedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    firstNameRef.current = firstName;
  }, [firstName]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const availableCompanyProfiles = companyProfiles.filter((company) => !companyContactsMap[company.id]);
  const resolvedCompletePath =
    onCompletePath ?? (entryPoint === 'full' ? '/import' : entryPoint === 'target-company' ? '/company-criteria' : '/personas');

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
  }, []);

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
      body: JSON.stringify(d),
    });
    const { name } = nameRes.ok ? await nameRes.json() : { name: `${d.companyType} Profile` };

    const saveRes = await fetch('/api/company-criteria', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        companyType: d.companyType,
        therapeuticAreas: d.therapeuticAreas,
        modalities: d.modalities,
        developmentStages: d.developmentStages,
        companySizes: d.companySizes,
        fundingStages: d.fundingStages,
        signals: [],
        exampleCompanies: [],
      }),
    });

    if (saveRes.ok) {
      const saved = await saveRes.json();
      const row = saved?.data ?? saved;
      icpIdRef.current = typeof row?.id === 'string' ? row.id : null;
    }

    // Claude transition → persona step
    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content:
          '[System: the target company profile has been saved. Briefly confirm it and introduce the next part: defining the full buying group for this profile, meaning all functions and seniority levels involved in buying, in one combined profile. Keep it to 2 sentences.]',
      },
    });
    if (displayParts.length) await sayBeats(displayParts);

    await advanceTo('persona_functions');
  }, [askClaude, advanceTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save persona ──────────────────────────────────────────────────────────

  const savePersona = useCallback(async () => {
    setPhase('persona_saving');
    const p = personaRef.current;

    const personaName =
      p.functions.length > 0 ? `Buying group: ${p.functions[0]}` : 'Buying group';

    await fetch('/api/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: personaName,
        functions: p.functions,
        seniorityLevels: p.seniority,
        jobTitles: [],
        signals: [],
        icpId: icpIdRef.current,
      }),
    });

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
    // Store into refs
    switch (phase) {
      case 'company_type': companyRef.current.companyType = selection[0] ?? ''; break;
      case 'company_size': companyRef.current.companySizes = selection; break;
      case 'company_ta': companyRef.current.therapeuticAreas = selection; break;
      case 'company_modality': companyRef.current.modalities = selection; break;
      case 'company_stage': companyRef.current.developmentStages = selection; break;
      case 'company_funding': companyRef.current.fundingStages = selection; break;
      case 'persona_functions': personaRef.current.functions = selection; break;
      case 'persona_seniority': personaRef.current.seniority = selection; break;
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
    // Claude transition → company ICP step
    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content:
          "[System: the user confirmed their company profile looks right. Now briefly transition to the next step: defining target company profiles, meaning the kinds of accounts they sell to. Keep it 1-2 sentences, be encouraging.]",
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
    await advanceTo('company_type');
  }, [askClaude, advanceTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle company analysis ───────────────────────────────────────────────

  const runAnalysis = useCallback(async (url: string) => {
    const trimmed = url.trim();
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    lastAnalyzedUrlRef.current = normalized;
    setThread((p) => p.filter((m) => m.kind !== 'results'));
    setPhase('analysis_loading');
    setInput(false);

    const msgs = ['Thinking…', 'Visiting your website…', 'Scanning for details…', 'Analysing content…', 'Building your profile…'];
    let mi = 0;
    setLoadMsg(msgs[0]);
    const interval = setInterval(() => { mi = (mi + 1) % msgs.length; setLoadMsg(msgs[mi]); }, 3000);

    try {
      const res = await fetch('/api/analyze-and-store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: normalized }),
      });
      clearInterval(interval);
      if (!res.ok) throw new Error('Analysis failed');
      const data = await res.json();
      setEditingFindings(false);
      setEditingFindingsData(data);

      // Claude comments on what it found
      const { displayParts } = await askClaude({
        mode: 'narration',
        extra: {
          role: 'user',
          content: `[System: analysis of ${normalized} is complete. Company: ${data.company_name ?? normalized}. Give a 1-sentence warm reaction and say you will share a quick findings summary in the chat.]`,
        },
      });
      if (displayParts.length) await sayBeats(displayParts);

      // Keep results on the thread for data + history; UI shows them in the side panel only.
      setThread((p) => [...p, { id: crypto.randomUUID(), kind: 'results', data }]);
      setPhase('analysis_results');

      const findingsSummary = formatFindingsSummary(data as Record<string, unknown>);
      if (findingsSummary.length > 0) {
        await sayBeats(findingsSummary);
      }
    } catch {
      clearInterval(interval);
      setAnalysisError("Couldn't analyse that website, maybe it's blocking us. Try another URL.");
      setPhase('greeting');
      setInput(true);
    }
  }, [askClaude, formatFindingsSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReanalyseFromPanel = useCallback(() => {
    const u = lastAnalyzedUrlRef.current;
    if (u) void runAnalysis(u);
  }, [runAnalysis]);

  const getLatestResultsData = useCallback((): Record<string, unknown> | null => {
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const message = thread[i];
      if (message.kind === 'results') return message.data;
    }
    return null;
  }, [thread]);

  const handleAnalysisNotRight = useCallback(async () => {
    setEditingFindingsData((prev) => prev ?? getLatestResultsData());
    setEditingFindings(true);
    await say('No problem. I switched the findings panel into edit mode so you can adjust each section directly.');
  }, [getLatestResultsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyseDifferentWebsite = useCallback(async () => {
    setThread((prev) => prev.filter((m) => m.kind !== 'results'));
    setEditingFindings(false);
    setEditingFindingsData(null);
    setPhase('greeting');
    setInput(true);
    setInputVal('');
    await say('Sure. Share the new company website and I will analyse that instead.');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFindingsSectionChange = useCallback((sectionKey: string, rawValue: string) => {
    const lines = rawValue
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    setEditingFindingsData((prev) => ({
      ...(prev ?? {}),
      [sectionKey]: lines,
    }));
  }, []);

  const handleCancelFindingsEdit = useCallback(() => {
    setEditingFindings(false);
    setEditingFindingsData(getLatestResultsData());
  }, [getLatestResultsData]);

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

  // ── Handle user text input (greeting phase) ───────────────────────────────

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || !inputEnabled) return;

    setInputVal('');
    setInput(false);
    pushText('user', text);

    const response = await askClaude({
      mode: phase === 'greeting' ? 'conversation' : 'phase_help',
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
      await runAnalysis(beginAnalysis.website_url);
      return;
    }

    setInput(true);
  }, [inputValue, inputEnabled, phase, askClaude, runAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mount: start the conversation (entry point chooses opening phase) ──

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      if (entryPoint === 'full') {
        const { displayParts } = await askClaude();
        if (displayParts.length) await sayBeats(displayParts);
        setInput(true);
        return;
      }

      if (entryPoint === 'target-company') {
        const intro = await askClaude({
          mode: 'narration',
          extra: {
            role: 'user',
            content: `[System: ${firstNameRef.current ? `The user's preferred name is ${firstNameRef.current}.` : 'The user has not shared a preferred name. Greet them warmly without assuming a name.'} They already completed "Your company" in Arcova and are adding a new target company profile (types of accounts they sell to). Two short sentences: welcome them, say you'll walk them through it using the options below. Do not ask for their company website.]`,
          },
        });
        if (intro.displayParts.length) await sayBeats(intro.displayParts);
        setPhase('company_type');
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
        selectedCompanyRef.current = co;
        icpIdRef.current = co.id;
        const { displayParts } = await askClaude({
          mode: 'narration',
          extra: {
            role: 'user',
            content: `[System: Target company profile is "${co.name}". User is defining the full buying group for it, meaning all functions and seniority levels involved in buying, in one combined profile. Two short welcoming sentences; point them to the selectors below.]`,
          },
        });
        if (displayParts.length) await sayBeats(displayParts);
        setPhase('persona_functions');
        setInput(true);
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
    selectedCompanyRef.current = co;
    icpIdRef.current = co.id;
    pushText('user', co.name);
    const { displayParts } = await askClaude({
      mode: 'narration',
      extra: {
        role: 'user',
        content: `[System: They chose target company profile "${co.name}". Two sentences: confirm and invite them to define the full buying group using the selectors below.]`,
      },
    });
    if (displayParts.length) await sayBeats(displayParts);
    setChipSel([]);
    setPhase('persona_functions');
    setInput(true);
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
    phase === 'company_select' ||
    phase === 'company_type' ||
    phase === 'company_size' ||
    phase === 'company_ta' ||
    phase === 'company_modality' ||
    phase === 'company_stage' ||
    phase === 'company_funding' ||
    phase === 'persona_functions' ||
    phase === 'persona_seniority';
  const isSaving = phase === 'company_saving' || phase === 'persona_saving' || phase === 'done';

  const isResultsStep = phase === 'analysis_results';
  const resultsEntry = thread.find((m): m is ResultsMsg => m.kind === 'results');
  const resultsPanelData = (editingFindingsData ?? resultsEntry?.data) ?? null;
  const showResultsActions = Boolean(isResultsStep && resultsPanelData);
  const visibleMessages = thread.filter((m) => m.kind !== 'results');
  const analysedUrlForPanel = lastAnalyzedUrlRef.current ?? '';
  const findingsSections = resultsPanelData
    ? FINDINGS_SECTION_CONFIG
        .map((section) => ({
          ...section,
          items: parseSectionItems(resultsPanelData[section.key]),
        }))
        .filter((section) => section.items.length > 0)
    : [];

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
                <h1 className="text-2xl font-bold text-white">Welcome to Arcova</h1>
                <p className="mt-2 text-sm text-slate-300">Getting your workspace ready.</p>
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
                    !isLastAssistant && i < visibleMessages.length - 2 ? 'opacity-55' : 'opacity-100'
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

          {phase === 'analysis_loading' && !thinking && (
            <div className="flex items-start gap-3">
              <AgentAvatar />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <div key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/70" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                  <span className="text-base text-gray-600">{loadMsg}</span>
                </div>
              </div>
            </div>
          )}

          {isSaving && !thinking && (
            <div className="flex items-start gap-3">
              <AgentAvatar />
              <div className="rounded-2xl rounded-tl-none border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <div key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-arcova-teal/70" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                  <span className="text-base text-gray-600">
                    {phase === 'done' ? 'Redirecting…' : 'Saving…'}
                  </span>
                </div>
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
        <div className="shrink-0 space-y-3 border-t border-white/25 bg-white/[0.94] px-4 py-3 backdrop-blur-sm">
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
                        className="text-sm text-gray-400 transition-colors hover:text-gray-600"
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

          {showChatBar && phase !== 'greeting' && (
            <p className="text-sm text-gray-500">Question on this step? Ask below.</p>
          )}

          {showChatBar && (
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
                      ? 'Company domain or URL…'
                      : 'Ask a question…'
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
                <div className="space-y-3">
                  {findingsSections.map((section) => (
                    <div key={section.key}>
                      <p className="mb-1 text-sm font-medium text-gray-700">{section.label}</p>
                      <textarea
                        value={section.items.join('\n')}
                        onChange={(e) => handleFindingsSectionChange(section.key, e.target.value)}
                        rows={Math.max(3, Math.min(8, section.items.length + 1))}
                        className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-arcova-teal"
                        placeholder="One line per point"
                      />
                    </div>
                  ))}
                  <div className="flex flex-col gap-2 sm:flex-row">
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
                </div>
              ) : (
                <>
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
                  <p className="text-xs text-gray-500">
                    Source analysed: <span className="font-mono text-gray-700">{analysedUrlForPanel.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</span>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${SETUP_CHAT_SURROUND}`}>
      <div
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center justify-center p-4 sm:p-6"
      >
        <div className="flex h-[min(56rem,calc(100dvh-12rem))] w-full min-h-[20rem] flex-col">
          {chatColumn}
        </div>
      </div>
    </div>
  );
}
