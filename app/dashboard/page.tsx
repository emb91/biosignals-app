'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import {
  COMPANY_FIT_GAP_BELOW,
  isWeakDim,
  type HealthDim,
  type PipelineDataRequestType,
} from '@/lib/pipeline-icp-health';
import { ROUTES, withQuery } from '@/lib/routes';

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

type TopLead = {
  id: string;
  name: string;
  priorityScore: number;
  updatedAt: string;
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
  icon: typeof AlertTriangle;
  tone: 'urgent' | 'next' | 'steady';
};

const hasSignals = (signals?: string[] | null) => Array.isArray(signals) && signals.length > 0;

const formatTimeAgo = (isoTimestamp?: string | null) => {
  if (!isoTimestamp) return 'just now';
  const then = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(then)) return 'just now';
  const diff = Math.max(0, Date.now() - then);

  const minutes = Math.floor(diff / (1000 * 60));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  const months = Math.floor(days / 30);
  return `${months} mo ago`;
};

function pct(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n <= 1 ? n * 100 : n);
}

function fitLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unknown';
  return `${Math.round(value * 100)}%`;
}

function isCoverageGap(card: IcpPipelineCard): boolean {
  return (
    card.company_count === 0 ||
    card.coverage === 'red' ||
    (card.avg_company_fit != null && card.avg_company_fit < COMPANY_FIT_GAP_BELOW)
  );
}

function dataHrefForIcp(card: IcpPipelineCard, requestType: PipelineDataRequestType): string {
  const mode = requestType === 'expand_companies' ? 'companies' : 'contacts_for_icp';
  return withQuery(
    ROUTES.leads.data,
    new URLSearchParams({
      mode,
      icpId: card.icp_id,
      requestType,
      source: 'dashboard',
    }),
  );
}

function toneClasses(tone: AgendaItem['tone']) {
  if (tone === 'urgent') {
    return 'bg-rose-50 text-rose-700 ring-rose-100';
  }
  if (tone === 'next') {
    return 'bg-amber-50 text-amber-700 ring-amber-100';
  }
  return 'bg-arcova-teal/10 text-arcova-teal ring-arcova-teal/15';
}

export default function DashboardPage() {
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
  const [agentOpener, setAgentOpener] = useState<{ text: string; nonce: number; isHidden: true } | undefined>();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

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
    const fetchDashboardData = async () => {
      if (!user) return;

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
                updatedAt:
                  typeof lead.updated_at === 'string'
                    ? lead.updated_at
                    : typeof lead.created_at === 'string'
                      ? lead.created_at
                      : new Date().toISOString(),
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

        const profileComplete = Boolean(profileData);
        const companiesComplete = icps.length > 0;
        const contactsComplete = contacts.length > 0;
        const importComplete = Boolean(importData);
        const signalsComplete =
          icps.some((icp) => hasSignals(icp.signals)) || contacts.some((contact) => hasSignals(contact.signals));

        setSteps([
          { id: 'profile', label: 'company profile', completed: profileComplete, actionPath: profileComplete ? ROUTES.setup.company : '/arcova-setup' },
          { id: 'companies', label: 'ICPs', completed: companiesComplete, actionPath: ROUTES.setup.icps },
          { id: 'personas', label: 'buying teams', completed: contactsComplete, actionPath: ROUTES.setup.personas },
          { id: 'import', label: 'contact import', completed: importComplete, actionPath: ROUTES.import },
          { id: 'signals', label: 'signals setup', completed: signalsComplete, actionPath: ROUTES.setup.icps },
        ]);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
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

  const completedSteps = steps.filter((step) => step.completed).length;
  const nextStep = steps.find((step) => !step.completed) ?? null;
  const runningJobs = enrichmentJobs.filter((job) => job.status === 'running');
  const failedJobs = enrichmentJobs.filter((job) => job.status === 'failed');
  const totalCoveredCompanies =
    icpCoverageRows.reduce((sum, row) => sum + row.company_count, 0) + icpCoverageUncategorized;
  const coverageGap = icpHealthCards.find(isCoverageGap) ?? null;
  const weakContactIcp = icpHealthCards.find((card) => card.company_count > 0 && isWeakDim(card.contact_fit)) ?? null;
  const syncProblemCount = (hubspotSyncLog?.contacts_errors ?? 0) + (hubspotSyncLog?.contacts_skipped ?? 0);

  const agenda: AgendaItem[] = [
    ...(nextStep
      ? [{
          id: `setup-${nextStep.id}`,
          label: '1',
          title: `Finish ${nextStep.label}`,
          detail: 'The rest of the product depends on this being complete.',
          href: nextStep.actionPath,
          cta: 'Continue',
          icon: Clock3,
          tone: 'urgent' as const,
        }]
      : []),
    ...(showImportReady
      ? [{
          id: 'import-ready',
          label: nextStep ? '2' : '1',
          title: 'Review the new lead scoring',
          detail: 'The import has finished, so Leads can now show what is Ready, Monitor, Source, or Deprioritised.',
          href: ROUTES.leads.contacts,
          cta: 'Open leads',
          icon: Zap,
          tone: 'next' as const,
        }]
      : []),
    ...failedJobs.slice(0, 2).map((job, index) => ({
      id: job.id,
      label: String(index + 1 + (nextStep ? 1 : 0) + (showImportReady ? 1 : 0)),
      title: `${job.kind === 'icp' ? 'ICP' : 'Contact'} enrichment failed`,
      detail: `${job.title}${job.subtitle ? ` at ${job.subtitle}` : ''} needs a retry or inspection.`,
      href: job.href,
      cta: 'Inspect',
      icon: AlertTriangle,
      tone: 'urgent' as const,
    })),
    ...(coverageGap && !nextStep
      ? [{
          id: `coverage-${coverageGap.icp_id}`,
          label: '2',
          title: 'Fill a company coverage gap',
          detail:
            coverageGap.company_count === 0
              ? `${coverageGap.label} has no matched companies.`
              : `${coverageGap.label} only has ${coverageGap.company_count} matched ${coverageGap.company_count === 1 ? 'company' : 'companies'}.`,
          href: dataHrefForIcp(coverageGap, 'expand_companies'),
          cta: 'Source companies',
          icon: Target,
          tone: 'next' as const,
        }]
      : []),
    ...(weakContactIcp && !nextStep
      ? [{
          id: `contacts-${weakContactIcp.icp_id}`,
          label: '3',
          title: 'Improve contact quality',
          detail: `${weakContactIcp.label} average contact fit is ${fitLabel(weakContactIcp.avg_contact_fit)}.`,
          href: ROUTES.leads.health,
          cta: 'Open health',
          icon: Users,
          tone: 'next' as const,
        }]
      : []),
    ...(topLeads.length > 0
      ? [{
          id: 'top-leads',
          label: '4',
          title: 'Work the best leads',
          detail: `${topLeads.length} high-fit contacts are ready to review.`,
          href: ROUTES.leads.contacts,
          cta: 'Review',
          icon: Users,
          tone: 'steady' as const,
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
          icon: Database,
          tone: 'next' as const,
        }]
      : []),
  ].slice(0, 5).map((item, index) => ({ ...item, label: String(index + 1) }));

  const briefing = [
    nextStep ? `setup incomplete: ${nextStep.label}` : 'setup complete',
    showImportReady ? 'new import ready for lead review' : 'no new import-ready event',
    failedJobs.length > 0 ? `${failedJobs.length} enrichment failed` : 'no enrichment failures',
    runningJobs.length > 0 ? `${runningJobs.length} enrichment running` : 'no enrichment running',
    coverageGap ? `company coverage gap: ${coverageGap.label}, ${coverageGap.company_count} companies` : 'no urgent company coverage gap detected',
    weakContactIcp ? `contact quality gap: ${weakContactIcp.label}, avg contact fit ${fitLabel(weakContactIcp.avg_contact_fit)}` : 'no urgent contact quality gap detected',
    `${topLeads.length} high-fit leads available`,
    `${totalCoveredCompanies} prioritised companies`,
    hubspotSyncLog?.synced_at
      ? `HubSpot sync: ${hubspotSyncLog.contacts_synced ?? 0} synced, ${hubspotSyncLog.contacts_errors ?? 0} errors, ${hubspotSyncLog.contacts_skipped ?? 0} skipped`
      : 'no HubSpot sync summary',
  ].join('; ');

  useEffect(() => {
    if (loading || loadingDashboard || !user || agentOpener) return;
    setAgentOpener({
      text: `The dashboard just loaded. Act like an executive assistant giving a morning GTM briefing. Use this brief: ${briefing}. Reel off the top 2-4 things to do today in priority order, give the user clear options like "we can start with 1, 2, or 3", and end by inviting them to choose what to work on first. Keep it warm, crisp, and under 110 words.`,
      nonce: Date.now(),
      isHidden: true,
    });
  }, [agentOpener, briefing, loading, loadingDashboard, user]);

  if (loading || loadingDashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-slate-50">
      <AppSidebar />

      <main className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef6f7_100%)] px-4 py-5 sm:px-6">
        <div className="mx-auto grid min-h-full w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="flex min-h-0 flex-col gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-arcova-teal">
                <Bot className="h-3.5 w-3.5" />
                Daily briefing
              </div>
              <h1 className="mt-2 text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                What should we do today?
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Start here, choose the work, then jump into the right part of the app.
              </p>
            </div>

            <div className="h-[min(72vh,760px)] min-h-[560px]">
              <AgentPanel
                page="dashboard"
                pageContext={{
                  dashboardBrief: briefing,
                  dashboardAgenda: agenda.map(({ title, detail, href }) => ({ title, detail, href })),
                }}
                pendingMessage={agentOpener}
                wide
              />
            </div>
          </section>

          <aside className="space-y-4">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3.5">
                <h2 className="text-sm font-semibold text-slate-950">Today&apos;s options</h2>
                <p className="mt-0.5 text-xs text-slate-500">Pick one here or tell the agent what to tackle first.</p>
              </div>

              {agenda.length === 0 ? (
                <div className="px-4 py-8 text-sm leading-6 text-slate-500">
                  Nothing urgent is blocking the workspace. Ask the agent what to review next, or start with Leads.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {agenda.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => router.push(item.href)}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50"
                      >
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ring-1 ${toneClasses(item.tone)}`}>
                          {item.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <p className="truncate text-sm font-semibold text-slate-950">{item.title}</p>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p>
                          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-arcova-teal">
                            {item.cta}
                            <ArrowRight className="h-3 w-3" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-950">Quick read</h2>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Setup</span>
                  <span className="font-semibold text-slate-950">{completedSteps}/{steps.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Prioritised companies</span>
                  <span className="font-semibold tabular-nums text-slate-950">{totalCoveredCompanies.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">High-fit leads</span>
                  <span className="font-semibold tabular-nums text-slate-950">{topLeads.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Running enrichments</span>
                  <span className="font-semibold tabular-nums text-slate-950">{runningJobs.length}</span>
                </div>
              </div>
            </section>

            {topLeads.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-950">Best leads</h2>
                  <button
                    type="button"
                    onClick={() => router.push(ROUTES.leads.contacts)}
                    className="text-xs font-semibold text-arcova-teal hover:text-arcova-blue"
                  >
                    All leads
                  </button>
                </div>
                <div className="mt-3 divide-y divide-slate-100">
                  {topLeads.slice(0, 3).map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      onClick={() => router.push(lead.href)}
                      className="flex w-full items-center justify-between gap-3 py-2.5 text-left first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{lead.name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{formatTimeAgo(lead.updatedAt)}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-arcova-teal/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-arcova-teal">
                        {lead.priorityScore}%
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
