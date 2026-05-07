'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { supabase } from '@/lib/supabase';
import {
  Bot,
  Loader2,
} from 'lucide-react';
import {
  COMPANY_FIT_GAP_BELOW,
  type HealthDim,
  type PipelineDataRequestType,
} from '@/lib/pipeline-icp-health';
import { ROUTES, withQuery } from '@/lib/routes';
import { getDisplayName } from '@/lib/auth-helpers';

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
};

const hasSignals = (signals?: string[] | null) => Array.isArray(signals) && signals.length > 0;

function pct(value: unknown): number {
  const n = typeof value === 'number' ? value : value == null ? 0 : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n <= 1 ? n * 100 : n);
}

function isCoverageGap(card: IcpPipelineCard): boolean {
  return (
    card.company_count === 0 ||
    card.coverage === 'red' ||
    (card.avg_company_fit != null && card.avg_company_fit < COMPANY_FIT_GAP_BELOW)
  );
}

function dataHrefForIcp(card: IcpPipelineCard, requestType: PipelineDataRequestType): string {
  return withQuery(
    ROUTES.leads.data,
    new URLSearchParams({
      mode: 'companies',
      icpId: card.icp_id,
      requestType,
      source: 'dashboard',
    }),
  );
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
      title: `Review ${failedJobs.length} enrichment${failedJobs.length === 1 ? '' : 's'} failed`,
      detail: `${job.title}${job.subtitle ? ` at ${job.subtitle}` : ''} needs a retry or inspection.`,
      href: job.href,
      cta: 'Inspect',
    })),
    ...(coverageGap && !nextStep
      ? [{
          id: `coverage-${coverageGap.icp_id}`,
          label: '2',
          title: `Improve coverage of ${coverageGap.label}`,
          detail:
            coverageGap.company_count === 0
              ? `${coverageGap.label} has no matched companies.`
              : `${coverageGap.label} only has ${coverageGap.company_count} matched ${coverageGap.company_count === 1 ? 'company' : 'companies'}.`,
          href: dataHrefForIcp(coverageGap, 'expand_companies'),
          cta: 'Source companies',
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

  const briefing = [
    nextStep ? `setup incomplete: ${nextStep.label}` : 'setup complete',
    showImportReady ? 'new import ready for lead review' : 'no new import-ready event',
    failedJobs.length > 0 ? `${failedJobs.length} enrichment failed` : 'no enrichment failures',
    runningJobs.length > 0 ? `${runningJobs.length} enrichment running` : 'no enrichment running',
    coverageGap ? `company coverage gap: ${coverageGap.label}, ${coverageGap.company_count} companies` : 'no urgent company coverage gap detected',
    `${topLeads.length} high-fit leads available`,
    `${totalCoveredCompanies} prioritised companies`,
    hubspotSyncLog?.synced_at
      ? `HubSpot sync: ${hubspotSyncLog.contacts_synced ?? 0} synced, ${hubspotSyncLog.contacts_errors ?? 0} errors, ${hubspotSyncLog.contacts_skipped ?? 0} skipped`
      : 'no HubSpot sync summary',
  ].join('; ');
  useEffect(() => {
    if (loading || loadingDashboard || !user || agentOpener) return;
    const firstName = getDisplayName(user);
    setAgentOpener({
      text: `The dashboard just loaded. The user's first name is ${firstName}. Open with "Good morning, ${firstName}" or "Hi ${firstName}" depending on the time-of-day vibe. Do not say operational filler like "everything looks clean", "import landed", "HubSpot is tidy", or anything similar. Do not summarise the brief yet. Just ask whether they already know what they want to tackle today, or whether they would like you to suggest an easy place to begin. Keep it conversational and under 45 words. Silent context only: ${briefing}.`,
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
                Start here, choose the work, then jump into it.
              </p>
            </div>

            <div className="h-[calc(100vh-11rem)] min-h-[680px]">
              <AgentPanel
                page="dashboard"
                pageContext={{
                  dashboardBrief: briefing,
                  dashboardAgenda: agenda.map(({ title, detail, href }) => ({ title, detail, href })),
                }}
                pendingMessage={agentOpener}
                wide
                className="h-full"
              />
            </div>
          </section>

          <aside className="space-y-4 lg:pt-[12.1rem]">
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
                  {agenda.map((item) => (
                    <div key={item.id} className="px-4 py-3.5">
                      <div className="flex items-baseline gap-2">
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-400">
                          {item.label}.
                        </span>
                        <h3 className="min-w-0 text-sm font-semibold text-slate-950">{item.title}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push(item.href)}
                        className="mt-1.5 pl-5 text-left text-xs font-semibold text-arcova-teal hover:text-arcova-blue"
                      >
                        {item.cta}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

          </aside>
        </div>
      </main>
    </div>
  );
}
