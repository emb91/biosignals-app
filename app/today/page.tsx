'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { BriefingSparkline } from '@/components/briefing/BriefingSparkline';
import { supabase } from '@/lib/supabase';
import { ArrowRight, Check, Loader2, TrendingUp } from 'lucide-react';
import './briefing-today.css';
import { ROUTES, withQuery } from '@/lib/routes';
import { getDisplayName } from '@/lib/auth-helpers';
import { healthLabel, type HealthDim } from '@/lib/pipeline-icp-health';
import { cn } from '@/lib/utils';

type SetupStep = {
  id: 'profile' | 'companies' | 'personas' | 'import' | 'signals';
  label: string;
  completed: boolean;
  actionPath: string;
};

type IcpRecord = {
  id: string;
  signals?: string[] | null;
};

type ContactRecord = {
  id: string;
  signals?: string[] | null;
};

type BriefingPulseSeriesState =
  | { state: 'loading' }
  | { state: 'ready'; values: number[] }
  | { state: 'off' };

type TopLead = {
  id: string;
  name: string;
  priorityScore: number;
  href: string;
};

type IcpCoverageRow = {
  company_count: number;
};

type IcpPipelineCard = {
  icp_id: string;
  label: string;
  company_count: number;
  avg_company_fit: number | null;
  avg_contact_fit: number | null;
  contact_fit: HealthDim;
  coverage: HealthDim;
  depth: HealthDim;
  overall: HealthDim;
};

type EnrichmentJob = {
  id: string;
  kind: 'icp' | 'lead';
  status: 'running' | 'failed';
  title: string;
  subtitle: string | null;
  href: string;
  started_at: string | null;
  finished_at: string | null;
};

type AgendaItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

const hasSignals = (signals?: string[] | null) => Array.isArray(signals) && signals.length > 0;
const TASK_STATE_STORAGE_PREFIX = 'arcova_briefing_tasks';

function pct(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n <= 1 ? n * 100 : n);
}

function todayStorageDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isHealthIssue(card: IcpPipelineCard): boolean {
  return (
    card.overall === 'red' ||
    card.overall === 'amber' ||
    card.coverage === 'red' ||
    card.contact_fit === 'red' ||
    card.depth === 'red'
  );
}

function formatBriefingHeroDate(d: Date) {
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const day = d.getDate();
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday}, ${day} ${month}`;
}

/** Uses local clock hour only (matches hero clock display). */
function briefingTimeOfDayGreeting(d: Date): string {
  const hour = d.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatInt(n: number) {
  return new Intl.NumberFormat('en-GB').format(n);
}

type BriefingSignalRow = {
  id: string;
  glyph: string;
  strong: string;
  rest: string;
  what: string;
  ago: string;
};

export default function BriefingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [topLeads, setTopLeads] = useState<TopLead[]>([]);
  const [showImportReady, setShowImportReady] = useState(false);
  const [enrichmentJobs, setEnrichmentJobs] = useState<EnrichmentJob[]>([]);
  const [icpCoverageRows, setIcpCoverageRows] = useState<IcpCoverageRow[]>([]);
  const [icpCoverageUncategorized, setIcpCoverageUncategorized] = useState(0);
  const [icpHealthCards, setIcpHealthCards] = useState<IcpPipelineCard[]>([]);
  const [hubspotSyncLog, setHubspotSyncLog] = useState<{
    synced_at: string;
    contacts_synced: number;
    contacts_errors: number;
    contacts_skipped: number;
  } | null>(null);
  const [doneTaskIds, setDoneTaskIds] = useState<Set<string>>(() => new Set());
  const [agentBusy, setAgentBusy] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  /** Pulse chart: stable layout while series loads so the card height (and shadow) does not jump */
  const [pulseSeries, setPulseSeries] = useState<BriefingPulseSeriesState>({ state: 'loading' });
  const prevBriefingUserIdRef = useRef<string | undefined>(undefined);

  const taskStateStorageKey = user
    ? `${TASK_STATE_STORAGE_PREFIX}:${user.id}:${todayStorageDate()}`
    : null;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    if (!taskStateStorageKey) {
      setDoneTaskIds(new Set());
      return;
    }

    try {
      const raw = localStorage.getItem(taskStateStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setDoneTaskIds(new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []));
    } catch {
      setDoneTaskIds(new Set());
    }
  }, [taskStateStorageKey]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const timeOfDayGreeting = useMemo(() => briefingTimeOfDayGreeting(clock), [clock]);

  const persistDoneIds = (next: Set<string>) => {
    if (taskStateStorageKey) {
      localStorage.setItem(taskStateStorageKey, JSON.stringify([...next]));
    }
  };

  const toggleTaskDone = (item: AgendaItem) => {
    setDoneTaskIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      persistDoneIds(next);
      return next;
    });
  };

  const openTask = (item: AgendaItem) => {
    setDoneTaskIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      persistDoneIds(next);
      return next;
    });
    router.push(item.href);
  };

  const fetchEnrichmentJobs = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/enrichment-jobs/active');
      if (!response.ok) return;
      const result = (await response.json()) as { data?: EnrichmentJob[] };
      setEnrichmentJobs(result.data ?? []);
    } catch (error) {
      console.error('Error loading enrichment jobs:', error);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const uid = user.id;
    if (prevBriefingUserIdRef.current !== undefined && prevBriefingUserIdRef.current !== uid) {
      setPulseSeries({ state: 'loading' });
    }
    prevBriefingUserIdRef.current = uid;

    const fetchDashboardData = async () => {
      try {
        const [
          { data: profileData, error: profileError },
          icpsBootstrap,
          contactsBootstrap,
          { data: importData, error: importError },
          topLeadsRes,
          syncLogRes,
          icpCoverageRes,
          icpHealthRes,
          importReadyRes,
          pulseSeriesRes,
        ] = await Promise.all([
          supabase.from('user_company').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          fetch('/api/company-criteria'),
          fetch('/api/contacts'),
          supabase.from('raw_uploads').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          fetch('/api/leads?pageSize=5&page=1'),
          fetch('/api/hubspot/sync-log'),
          fetch('/api/accounts/icp-coverage'),
          fetch('/api/pipeline/icp-cards'),
          fetch('/api/import-ready'),
          fetch('/api/today/pulse-series'),
        ]);

        if (profileError) throw profileError;
        if (importError) throw importError;

        const icpsJson = icpsBootstrap.ok ? await icpsBootstrap.json() : {};
        const contactsJson = contactsBootstrap.ok ? await contactsBootstrap.json() : {};
        const icps = ((icpsJson as { data?: IcpRecord[] }).data ?? []) as IcpRecord[];
        const contacts = ((contactsJson as { data?: ContactRecord[] }).data ?? []) as ContactRecord[];

        if (topLeadsRes.ok) {
          const leadJson = (await topLeadsRes.json()) as { data?: Array<Record<string, unknown>> };
          setTopLeads(
            (leadJson.data ?? []).slice(0, 5).map((lead) => {
              const name =
                (typeof lead.full_name === 'string' && lead.full_name.trim()
                  ? lead.full_name
                  : `${lead.first_name || ''} ${lead.last_name || ''}`).trim() || 'Imported contact';
              const id = typeof lead.id === 'string' ? lead.id : '';
              return {
                id,
                name,
                priorityScore: pct(lead.overall_fit_score),
                href: withQuery(ROUTES.leads.contacts, `lead=${encodeURIComponent(id)}`),
              };
            }),
          );
        }

        if (syncLogRes.ok) {
          const syncJson = await syncLogRes.json() as { data: typeof hubspotSyncLog };
          setHubspotSyncLog(syncJson.data);
        }

        if (icpCoverageRes.ok) {
          const coverageJson = (await icpCoverageRes.json()) as {
            rows?: IcpCoverageRow[];
            uncategorized_company_count?: number;
          };
          setIcpCoverageRows(Array.isArray(coverageJson.rows) ? coverageJson.rows : []);
          setIcpCoverageUncategorized(
            typeof coverageJson.uncategorized_company_count === 'number'
              ? coverageJson.uncategorized_company_count
              : 0,
          );
        }

        if (icpHealthRes.ok) {
          const healthJson = (await icpHealthRes.json()) as { cards?: IcpPipelineCard[] };
          setIcpHealthCards(Array.isArray(healthJson.cards) ? healthJson.cards : []);
        }

        if (importReadyRes.ok) {
          const readyJson = (await importReadyRes.json()) as { ready?: boolean };
          setShowImportReady(Boolean(readyJson.ready));
        }

        if (pulseSeriesRes.ok) {
          const pulseJson = (await pulseSeriesRes.json()) as { data?: unknown };
          const arr = pulseJson.data;
          if (Array.isArray(arr) && arr.length >= 2 && arr.every((n) => typeof n === 'number' && Number.isFinite(n))) {
            setPulseSeries({ state: 'ready', values: arr as number[] });
          } else {
            setPulseSeries({ state: 'off' });
          }
        } else {
          setPulseSeries({ state: 'off' });
        }

        const profileComplete = Boolean(profileData);
        const companiesComplete = icps.length > 0;
        const contactsComplete = contacts.length > 0;
        const importComplete = Boolean(importData);
        const signalsComplete =
          icps.some((icp) => hasSignals(icp.signals)) || contacts.some((contact) => hasSignals(contact.signals));

        setSteps([
          { id: 'profile', label: 'company profile', completed: profileComplete, actionPath: profileComplete ? ROUTES.setup.company : '/arcova-setup' },
          { id: 'companies', label: 'ICPs', completed: companiesComplete, actionPath: ROUTES.setup.icps },
          { id: 'personas', label: 'buying teams', completed: contactsComplete, actionPath: ROUTES.setup.icps },
          { id: 'import', label: 'contact import', completed: importComplete, actionPath: ROUTES.import },
          { id: 'signals', label: 'signals setup', completed: signalsComplete, actionPath: ROUTES.setup.icps },
        ]);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
        setPulseSeries({ state: 'off' });
      } finally {
        setLoadingDashboard(false);
      }
    };

    void fetchDashboardData();
  }, [user]);

  useEffect(() => {
    void fetchEnrichmentJobs();
  }, [fetchEnrichmentJobs]);

  useEffect(() => {
    const hasRunning = enrichmentJobs.some((job) => job.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => {
      void fetchEnrichmentJobs();
    }, 15000);
    return () => clearInterval(interval);
  }, [enrichmentJobs, fetchEnrichmentJobs]);

  const nextStep = steps.find((step) => !step.completed) ?? null;
  const runningJobs = enrichmentJobs.filter((job) => job.status === 'running');
  const failedJobs = enrichmentJobs.filter((job) => job.status === 'failed');
  const totalCoveredCompanies =
    icpCoverageRows.reduce((sum, row) => sum + row.company_count, 0) + icpCoverageUncategorized;
  const healthIssues = icpHealthCards.filter(isHealthIssue);
  const syncProblemCount = (hubspotSyncLog?.contacts_errors ?? 0) + (hubspotSyncLog?.contacts_skipped ?? 0);

  const signalRows = useMemo((): BriefingSignalRow[] => {
    const rows: BriefingSignalRow[] = [];
    for (const j of runningJobs.slice(0, 2)) {
      rows.push({
        id: `run-${j.id}`,
        glyph: '◐',
        strong: 'Enrichment',
        rest: j.title,
        what: j.subtitle ? `Running · ${j.subtitle}` : 'Running',
        ago: 'now',
      });
    }
    for (const j of failedJobs.slice(0, 2)) {
      rows.push({
        id: `fail-${j.id}`,
        glyph: '◈',
        strong: 'Failed job',
        rest: j.title,
        what: j.subtitle ? `${j.subtitle} · needs a retry` : 'Needs a retry or inspection',
        ago: '',
      });
    }
    if (showImportReady) {
      rows.push({
        id: 'import-ready-feed',
        glyph: '✦',
        strong: 'Import',
        rest: 'ready',
        what: 'New contacts are waiting in Leads',
        ago: 'today',
      });
    }
    if (hubspotSyncLog?.synced_at && syncProblemCount > 0) {
      rows.push({
        id: 'hubspot-sync-feed',
        glyph: '◇',
        strong: 'HubSpot sync',
        rest: `${syncProblemCount} exceptions`,
        what: `${hubspotSyncLog.contacts_synced ?? 0} synced cleanly`,
        ago: '',
      });
    }
    if (
      rows.length === 0
    ) {
      rows.push({
        id: 'quiet',
        glyph: '○',
        strong: 'Workspace',
        rest: 'quiet',
        what: 'No live jobs or import events right now',
        ago: '',
      });
    }
    return rows.slice(0, 4);
  }, [runningJobs, failedJobs, showImportReady, hubspotSyncLog, syncProblemCount]);

  const agenda: AgendaItem[] = [
    ...(nextStep
      ? [{
          id: `setup-${nextStep.id}`,
          label: '1',
          title: `Finish ${nextStep.label}`,
          detail: 'The rest of the product depends on this being complete.',
          href: nextStep.actionPath,
          cta: 'Continue',
        }]
      : []),
    ...(showImportReady
      ? [{
          id: 'import-ready',
          label: nextStep ? '2' : '1',
          title: 'Review new contacts',
          detail: 'The import has finished, so Leads can now show what is Ready, Monitor, Source, or Deprioritised.',
          href: withQuery(ROUTES.leads.contacts, 'agentTask=new_contacts'),
          cta: 'Open leads',
        }]
      : []),
    ...failedJobs.slice(0, 2).map((job, index) => ({
      id: job.id,
      label: String(index + 1 + (nextStep ? 1 : 0) + (showImportReady ? 1 : 0)),
      title: 'Review enrichment failure',
      detail: `${job.title}${job.subtitle ? ` at ${job.subtitle}` : ''} needs a retry or inspection.`,
      href: job.href,
      cta: 'Inspect',
    })),
    ...(healthIssues.length > 0 && !nextStep
      ? [{
          id: 'pipeline-health',
          label: '2',
          title: 'Review pipeline health',
          detail:
            healthIssues.length === 1
              ? `${healthIssues[0].label} needs attention.`
              : `${healthIssues.length} ICPs need review.`,
          href: withQuery(
            ROUTES.health,
            new URLSearchParams({
              agentTask: 'health_review',
              from: 'today',
            }),
          ),
          cta: 'Open Health',
        }]
      : []),
    ...(topLeads.length > 0
      ? [{
          id: 'top-leads',
          label: '4',
          title: 'Work the best leads',
          detail: `${topLeads.length} high-fit contacts are ready to review.`,
          href: withQuery(ROUTES.leads.contacts, 'agentTask=best_leads'),
          cta: 'Review',
        }]
      : []),
    ...(hubspotSyncLog?.synced_at && syncProblemCount > 0
      ? [{
          id: 'hubspot-sync',
          label: '5',
          title: 'Check HubSpot sync exceptions',
          detail: `${hubspotSyncLog.contacts_synced ?? 0} synced cleanly; ${syncProblemCount} need attention.`,
          href: ROUTES.import,
          cta: 'View import',
        }]
      : []),
  ].slice(0, 5).map((item, index) => ({ ...item, label: String(index + 1) }));

  const prioritiesDone = useMemo(
    () => agenda.reduce((n, item) => n + (doneTaskIds.has(item.id) ? 1 : 0), 0),
    [agenda, doneTaskIds],
  );

  const briefing = [
    nextStep ? `setup incomplete: ${nextStep.label}` : 'setup complete',
    showImportReady ? 'new import ready for lead review' : 'no new import-ready event',
    failedJobs.length > 0 ? `${failedJobs.length} enrichment failed` : 'no enrichment failures',
    runningJobs.length > 0 ? `${runningJobs.length} enrichment running` : 'no enrichment running',
    healthIssues.length > 0
      ? `pipeline health needs review: ${healthIssues.map((card) => `${card.label}, ${card.company_count} companies, overall ${healthLabel(card.overall)}`).join('; ')}`
      : 'no urgent pipeline health issue detected',
    `${topLeads.length} high-fit leads available`,
    `${totalCoveredCompanies} prioritised companies`,
    hubspotSyncLog?.synced_at
      ? `HubSpot sync: ${hubspotSyncLog.contacts_synced ?? 0} synced, ${hubspotSyncLog.contacts_errors ?? 0} errors, ${hubspotSyncLog.contacts_skipped ?? 0} skipped`
      : 'no HubSpot sync summary',
  ].join('; ');

  if (loading || loadingDashboard) {
    return (
      <div className="flex min-h-dvh items-center justify-center font-jakarta">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = getDisplayName(user);
  const BT_ACCENT = '#00a4b4';
  const pipeReady = topLeads.length;

  const briefingAgentWelcome = {
    greeting: `${timeOfDayGreeting}, ${displayName}.`,
    body: `Do you already know what you want to work on today, or would you like me to suggest a good place to start?`,
  };

  const briefingAgentIdleChips = [
    {
      label: '+ Suggest where to start',
      threadPreview: 'Suggest where to start today',
      prompt: `Here is silent workspace context only (do not recite): ${briefing}. Suggest one concrete place for me to start today and why. Keep it under 55 words.`,
    },
    {
      label: '+ Summarise overnight',
      threadPreview: 'Summarise what changed overnight',
      prompt: `Here is silent workspace context only (do not recite): ${briefing}. Summarise what changed overnight that matters for today. Keep it under 55 words.`,
    },
    {
      label: '+ Just the top lead',
      threadPreview: 'Walk me through my best lead',
      prompt: `Here is silent workspace context only (do not recite): ${briefing}. Focus only on my best lead to work today: name them and the next step. Keep it under 55 words.`,
    },
  ];

  return (
    <div className="flex h-screen min-h-0 bg-transparent font-jakarta">
      <AppSidebar />

      <main className="briefing-today arcova-scroll-surface relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative z-10 bt-page pb-24">
          <header className="bt-hero">
            <p className="bt-hero-eyebrow">Daily briefing · {formatBriefingHeroDate(clock)}</p>
            <h1 className="bt-hero-title font-manrope">
              {timeOfDayGreeting}, <span className="bt-hero-accent">{displayName}</span>
            </h1>
            <p className="bt-hero-sub">
              Here&rsquo;s your day &mdash; work through your priorities, or talk it through with the agent.
            </p>
          </header>

          <div className="bt-bento-grid">
            <section className="bt-bento bt-agent-tile">
              <div className="bt-agent-meta">
                <span className="bt-agent-status">
                  <span className="bt-agent-status-dot" style={{ background: BT_ACCENT }} />
                  <span>Assistant · {agentBusy ? 'thinking' : 'listening'}</span>
                </span>
                <span className="bt-agent-time">
                  {clock.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} local
                </span>
              </div>
              <div className="bt-agent-panel-host bt-agent-panel-host--fill">
                <AgentPanel
                  page="today"
                  pageContext={{
                    todayBrief: briefing,
                    todayAgenda: agenda.map(({ title, detail, href }) => ({ title, detail, href })),
                  }}
                  wide
                  hideHeader
                  suppressPrompts
                  embedInBriefingBento
                  briefingWelcome={briefingAgentWelcome}
                  briefingIdleChips={briefingAgentIdleChips}
                  onBusyChange={setAgentBusy}
                  className="min-h-0 flex-1 overflow-hidden"
                />
              </div>
            </section>

            <div className="bt-right-stack">
              <section className="bt-bento bt-priorities-tile">
                <header className="bt-tile-head">
                  <div>
                    <p className="bt-tile-eyebrow">Today</p>
                    <h2 className="bt-tile-title">Priorities</h2>
                  </div>
                  {agenda.length > 0 ? (
                    <span className="bt-tile-pill">
                      <span className="bt-pill-num" style={{ color: BT_ACCENT }}>
                        {prioritiesDone}
                      </span>
                      <span className="bt-pill-sep">/</span>
                      <span>{agenda.length}</span>
                    </span>
                  ) : null}
                </header>
                {agenda.length === 0 ? (
                  <div className="bt-p-empty">
                    Nothing urgent is blocking the workspace. Ask the agent what to review next, or start with Leads.
                  </div>
                ) : (
                  <>
                    <ul className="bt-p-list">
                      {agenda.map((item, index) => (
                        <li
                          key={item.id}
                          className={cn('bt-p-row', doneTaskIds.has(item.id) && 'is-done')}
                          style={{ animationDelay: `${index * 60 + 80}ms` }}
                        >
                          <button
                            type="button"
                            className="bt-p-check"
                            aria-label={doneTaskIds.has(item.id) ? 'Mark not done' : 'Mark done'}
                            onClick={() => toggleTaskDone(item)}
                          >
                            <span className="bt-p-check-num">{index + 1}</span>
                            <Check className="bt-p-check-tick h-3.5 w-3.5" strokeWidth={2.4} />
                          </button>
                          <button type="button" className="bt-p-body" onClick={() => openTask(item)}>
                            <span className="bt-p-title">{item.title}</span>
                            <span className="bt-p-detail">{item.detail}</span>
                          </button>
                          <button type="button" className="bt-p-cta" onClick={() => openTask(item)}>
                            {item.cta}
                            <ArrowRight className="h-3 w-3" strokeWidth={2} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <footer className="bt-p-foot">
                      <span
                        className="bt-p-foot-line"
                        style={{
                          background: `linear-gradient(90deg, ${BT_ACCENT}, transparent)`,
                          width: agenda.length > 0 ? `${(prioritiesDone / agenda.length) * 100}%` : '0%',
                        }}
                      />
                      <span className="bt-p-foot-text">
                        {prioritiesDone === agenda.length
                          ? 'All clear for this list.'
                          : `${agenda.length - prioritiesDone} left for today`}
                      </span>
                    </footer>
                  </>
                )}
              </section>

              <section className="bt-bento bt-pipe-tile">
                <header className="bt-tile-head">
                  <div>
                    <p className="bt-tile-eyebrow">Pipeline</p>
                    <h2 className="bt-tile-title">Pulse</h2>
                  </div>
                  <span className="bt-tile-trend" style={{ color: BT_ACCENT }}>
                    {runningJobs.length > 0 ? (
                      <>
                        <TrendingUp className="h-3 w-3" strokeWidth={2.2} />
                        {runningJobs.length} active
                      </>
                    ) : (
                      <>steady</>
                    )}
                  </span>
                </header>
                <div className="bt-pipe-grid">
                  <div>
                    <p className="bt-pipe-num">{formatInt(totalCoveredCompanies)}</p>
                    <p className="bt-pipe-label">prioritised companies</p>
                  </div>
                  <div>
                    <p className="bt-pipe-num bt-pipe-num-sub">{pipeReady}</p>
                    <p className="bt-pipe-label">high-fit · surfaced</p>
                  </div>
                </div>
                <div className="bt-pipe-series-slot">
                  {pulseSeries.state === 'ready' ? (
                    <>
                      <BriefingSparkline accent={BT_ACCENT} values={pulseSeries.values} />
                      <div className="bt-pipe-legend">
                        <span>
                          <i style={{ background: BT_ACCENT }} />
                          signals / day (last 28 days)
                        </span>
                        <span>
                          <i className="dim" />
                          trailing 7-day average
                        </span>
                      </div>
                    </>
                  ) : pulseSeries.state === 'loading' ? (
                    <div className="bt-pipe-series-pending" aria-busy="true" aria-label="Loading signal trend">
                      <div className="bt-pipe-chart-skeleton" />
                      <div className="bt-pipe-legend-skeleton" aria-hidden>
                        <span />
                        <span />
                      </div>
                    </div>
                  ) : (
                    <div className="bt-pipe-series-pending bt-pipe-series-off" role="status">
                      <p className="bt-pipe-off-text">Signal trend unavailable</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="bt-bento bt-signals-tile">
              <header className="bt-tile-head">
                <div>
                  <p className="bt-tile-eyebrow">Live</p>
                  <h2 className="bt-tile-title">Signals</h2>
                </div>
                <span className="bt-tile-live">
                  <span className="bt-live-dot" style={{ background: BT_ACCENT }} />
                  workspace
                </span>
              </header>
              <ul className="bt-sig-list">
                {signalRows.map((s, i) => (
                  <li key={s.id} className="bt-sig-row" style={{ animationDelay: `${i * 50}ms` }}>
                    <span className="bt-sig-glyph" style={{ color: BT_ACCENT }}>
                      {s.glyph}
                    </span>
                    <span className="bt-sig-body">
                      <span className="bt-sig-line">
                        <strong>{s.strong}</strong>
                        {s.rest ? ` · ${s.rest}` : ''}
                      </span>
                      <span className="bt-sig-what">{s.what}</span>
                    </span>
                    {s.ago ? <span className="bt-sig-ago">{s.ago}</span> : <span className="bt-sig-ago" />}
                  </li>
                ))}
              </ul>
            </section>

            <div className="bt-stats-wrap">
              <div className="bt-stat-row">
                <div className="bt-stat-tile">
                  <span className="bt-stat-glyph" style={{ color: BT_ACCENT }}>
                    ✦
                  </span>
                  <p className="bt-stat-val">{pipeReady}</p>
                  <p className="bt-stat-label">Ready to work</p>
                  <p className="bt-stat-sub">high-fit, surfaced on Leads</p>
                </div>
                <div className="bt-stat-tile">
                  <span className="bt-stat-glyph" style={{ color: BT_ACCENT }}>
                    ◈
                  </span>
                  <p className="bt-stat-val">{runningJobs.length + failedJobs.length}</p>
                  <p className="bt-stat-label">Jobs in view</p>
                  <p className="bt-stat-sub">active or failed enrichment</p>
                </div>
                <div className="bt-stat-tile">
                  <span className="bt-stat-glyph" style={{ color: BT_ACCENT }}>
                    ◐
                  </span>
                  <p className="bt-stat-val">{healthIssues.length}</p>
                  <p className="bt-stat-label">ICPs to review</p>
                  <p className="bt-stat-sub">pipeline health attention</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
