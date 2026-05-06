'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { supabase } from '@/lib/supabase';
import { getSignalDisplayName } from '@/lib/signal-display-names';
type SetupStep = {
  id: 'profile' | 'companies' | 'personas' | 'import' | 'signals';
  label: string;
  completed: boolean;
  actionPath: string;
};

type IcpRecord = {
  id: string;
  name: string | null;
  company_type?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
  company_sizes?: string[] | null;
  funding_stages?: string[] | null;
  example_companies?: string[] | null;
  signals?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ContactRecord = {
  id: string;
  name: string;
  icp_id?: string | null;
  signals?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
};

type SignalEvent = {
  id: string;
  label: string;
  signalType: string;
  timestamp: string;
  href: string;
};

type TopLead = {
  id: string;
  name: string;
  priorityScore: number;
  latestSignalType: string;
  latestSignalAt: string;
  href: string;
};

type FollowUpReminder = {
  id: string;
  contactName: string;
  companyName: string;
  updatedAt: string;
};

type IcpCoverageRow = {
  icp_id: string;
  label: string;
  company_count: number;
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
  last_error: string | null;
};

const TEAL = '#1D9E75';
const MILLIS_IN_DAY = 1000 * 60 * 60 * 24;

const hasSignals = (signals?: string[] | null) => Array.isArray(signals) && signals.length > 0;

const formatTimeAgo = (isoTimestamp?: string | null) => {
  if (!isoTimestamp) return 'just now';
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diff = Math.max(0, now - then);

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

const daysSince = (isoTimestamp?: string | null) => {
  if (!isoTimestamp) return 999;
  return Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / MILLIS_IN_DAY);
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [newSignals, setNewSignals] = useState<SignalEvent[]>([]);
  const [topLeads, setTopLeads] = useState<TopLead[]>([]);
  const [followUpReminders, setFollowUpReminders] = useState<FollowUpReminder[]>([]);
  const [showImportReadyBanner, setShowImportReadyBanner] = useState(false);
  const [enrichmentJobs, setEnrichmentJobs] = useState<EnrichmentJob[]>([]);
  const [hasRunningEnrichmentJobs, setHasRunningEnrichmentJobs] = useState(false);
  const [hubspotSyncLog, setHubspotSyncLog] = useState<{
    synced_at: string;
    contacts_synced: number;
    contacts_errors: number;
    contacts_skipped: number;
    skipped_contacts: { name: string; company: string | null; reason: string }[];
  } | null>(null);
  const [syncLogExpanded, setSyncLogExpanded] = useState(false);
  const [icpCoverageRows, setIcpCoverageRows] = useState<IcpCoverageRow[]>([]);
  const [icpCoverageUncategorized, setIcpCoverageUncategorized] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const fetchEnrichmentJobs = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/enrichment-jobs/active');
      if (!response.ok) return;

      const result = await response.json() as {
        data?: EnrichmentJob[];
        hasRunning?: boolean;
      };

      setEnrichmentJobs(result.data ?? []);
      setHasRunningEnrichmentJobs(Boolean(result.hasRunning));
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
          personasBootstrap,
          { data: importData, error: importError },
          signalEventsHttp,
          topLeadsRes,
          syncLogRes,
          icpCoverageRes,
        ] = await Promise.all([
          supabase.from('user_company').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          fetch('/api/company-criteria'),
          fetch('/api/contacts'),
          supabase.from('raw_uploads').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          fetch('/api/signal-events?recent=1&limit=12'),
          fetch('/api/leads?pageSize=5&page=1'),
          fetch('/api/hubspot/sync-log'),
          fetch('/api/accounts/icp-coverage'),
        ]);

        if (syncLogRes.ok) {
          const syncJson = await syncLogRes.json() as { data: typeof hubspotSyncLog };
          setHubspotSyncLog(syncJson.data);
        }

        if (icpCoverageRes.ok) {
          const covJson = (await icpCoverageRes.json()) as {
            rows?: IcpCoverageRow[];
            uncategorized_company_count?: number;
          };
          setIcpCoverageRows(Array.isArray(covJson.rows) ? covJson.rows : []);
          setIcpCoverageUncategorized(
            typeof covJson.uncategorized_company_count === 'number' ? covJson.uncategorized_company_count : 0,
          );
        } else {
          setIcpCoverageRows([]);
          setIcpCoverageUncategorized(0);
        }

        if (profileError) throw profileError;
        if (importError) throw importError;

        const icpsJson = icpsBootstrap.ok ? await icpsBootstrap.json() : {};
        const personaJson = personasBootstrap.ok ? await personasBootstrap.json() : {};

        const icps = ((icpsJson as { data?: IcpRecord[] }).data ?? []) as IcpRecord[];
        const contacts = ((personaJson as { data?: ContactRecord[] }).data ?? []) as ContactRecord[];

        let recentEventsPayload: SignalEvent[] = [];
        if (signalEventsHttp.ok) {
          const recentJson = (await signalEventsHttp.json()) as { data?: Array<Record<string, unknown>> };
          recentEventsPayload = (recentJson.data ?? []).slice(0, 5).map((row, idx) => ({
            id: String(row.id ?? `evt-${idx}`),
            label:
              typeof row.title === 'string' && row.title.trim()
                ? row.title.trim()
                : row.signal_scope === 'contact'
                  ? 'Buyer signal'
                  : 'Account signal',
            signalType: getSignalDisplayName(String(row.signal_type ?? '')),
            timestamp: String(row.detected_at ?? row.created_at ?? new Date().toISOString()),
            href: '/results',
          }));
        }

        const lastSignInAt = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
        const signalEventsFiltered = recentEventsPayload.filter((item) => {
          const ts = new Date(item.timestamp).getTime();
          return ts > lastSignInAt && Number.isFinite(ts);
        });

        let nextTopLeads: TopLead[] = [];
        if (topLeadsRes.ok) {
          const tlJson = (await topLeadsRes.json()) as { data?: Array<Record<string, unknown>> };
          nextTopLeads = (tlJson.data ?? []).slice(0, 5).map((leadRow) => {
            const pct = (v: unknown) => {
              const n = typeof v === 'number' ? v : v == null ? 0 : Number(v);
              if (!Number.isFinite(n)) return 0;
              return Math.round((n <= 1 ? n * 100 : n));
            };
            const name =
              (typeof leadRow.full_name === 'string' && leadRow.full_name.trim()
                ? leadRow.full_name
                : `${leadRow.first_name || ''} ${leadRow.last_name || ''}`).trim() || 'Imported contact';

            const leadIdVal = typeof leadRow.id === 'string' ? leadRow.id : '';
            return {
              id: leadIdVal,
              name,
              priorityScore: pct(leadRow.overall_fit_score),
              latestSignalType: 'Intent & fit tuned',
              latestSignalAt:
                typeof leadRow.updated_at === 'string'
                  ? leadRow.updated_at
                  : typeof leadRow.created_at === 'string'
                    ? leadRow.created_at
                    : new Date().toISOString(),
              href: `/results?lead=${encodeURIComponent(leadIdVal)}`,
            };
          });
        }

        const profileComplete = !!profileData;
        const companiesComplete = icps.length > 0;
        const personasComplete = contacts.length > 0;
        const importComplete = !!importData;
        const signalsComplete = icps.some((icp) => hasSignals(icp.signals)) || contacts.some((contact) => hasSignals(contact.signals));

        const checklistSteps: SetupStep[] = [
          { id: 'profile', label: 'My company', completed: profileComplete, actionPath: profileComplete ? '/my-profile' : '/arcova-setup' },
          { id: 'companies', label: 'Target Companies', completed: companiesComplete, actionPath: '/company-criteria' },
          { id: 'personas', label: 'Teams', completed: personasComplete, actionPath: '/personas' },
          { id: 'import', label: 'Upload your CSV', completed: importComplete, actionPath: '/import' },
          { id: 'signals', label: 'Signals', completed: signalsComplete, actionPath: '/company-criteria' },
        ];
        setSteps(checklistSteps);

        const blendedFeed =
          signalEventsFiltered.length > 0 ? signalEventsFiltered : recentEventsPayload;
        blendedFeed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setNewSignals(blendedFeed.slice(0, 5));
        setTopLeads(nextTopLeads);

        const reminders = contacts
          .filter((contact) => {
            const status = (contact.status || '').toLowerCase();
            return status === 'follow up' && daysSince(contact.updated_at) > 7;
          })
          .slice(0, 3)
          .map((contact) => {
            const company = icps.find((icp) => icp.id === contact.icp_id);
            return {
              id: contact.id,
              contactName: contact.name || 'Unnamed contact',
              companyName: company?.name || 'Unknown company',
              updatedAt: contact.updated_at || new Date().toISOString(),
            };
          });

        setFollowUpReminders(reminders);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setIsLoadingDashboard(false);
      }
    };

    fetchDashboardData();
  }, [user]);

  useEffect(() => {
    fetchEnrichmentJobs();
  }, [fetchEnrichmentJobs]);

  useEffect(() => {
    if (!hasRunningEnrichmentJobs) return;

    const interval = setInterval(() => {
      fetchEnrichmentJobs();
    }, 15000);

    return () => clearInterval(interval);
  }, [fetchEnrichmentJobs, hasRunningEnrichmentJobs]);

  useEffect(() => {
    const loadImportReadyStatus = async () => {
      if (!user) return;
      try {
        const response = await fetch('/api/import-ready');
        if (!response.ok) return;
        const result = await response.json();
        setShowImportReadyBanner(Boolean(result.ready));
      } catch (error) {
        console.error('Error loading import-ready status:', error);
      }
    };

    loadImportReadyStatus();
  }, [user]);

  if (loading || isLoadingDashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) return null;

  const completedSteps = steps.filter((step) => step.completed).length;
  const isLiveMode = completedSteps === steps.length && steps.length > 0;
  const runningEnrichmentCount = enrichmentJobs.filter((job) => job.status === 'running').length;
  const failedEnrichmentCount = enrichmentJobs.filter((job) => job.status === 'failed').length;
  const hasIcpCoverageData = icpCoverageRows.length > 0 || icpCoverageUncategorized > 0;

  const icpCoverageSection = (
    <div className="rounded-lg border border-gray-200 p-6 bg-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">ICP coverage</h2>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            Each line is how many distinct companies have prioritized leads (Monitor or Reach out), counted under the
            ICP matched on the company record.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/accounts')}
          className="shrink-0 text-sm font-medium hover:opacity-80 sm:mt-0.5"
          style={{ color: TEAL }}
        >
          View accounts →
        </button>
      </div>
      {!hasIcpCoverageData ? (
        <p className="mt-4 text-sm text-gray-500">
          No coverage yet. When you mark leads as Monitor or Reach out, companies will appear here by matched ICP.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2">
            {icpCoverageRows.map((row) => (
              <li key={row.icp_id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 text-gray-700 break-words leading-snug" title={row.label}>
                  {row.label}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                  {row.company_count.toLocaleString()}{' '}
                  <span className="font-normal text-gray-500">
                    compan{row.company_count === 1 ? 'y' : 'ies'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {icpCoverageUncategorized > 0 && (
            <p className="mt-4 text-xs text-gray-500 border-t border-gray-100 pt-3">
              {icpCoverageUncategorized.toLocaleString()} other{' '}
              {icpCoverageUncategorized === 1 ? 'company' : 'companies'} with prioritized leads but no matched ICP on
              the company.
            </p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      <AppSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              {showImportReadyBanner && (
                <div className="mb-6 rounded-lg border border-arcova-teal/30 bg-arcova-teal/10 p-4 flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-gray-900">Your contacts are ready - view your leads.</p>
                  <button
                    onClick={() => router.push('/results')}
                    className="text-sm font-semibold text-arcova-teal hover:opacity-80"
                  >
                    View leads
                  </button>
                </div>
              )}

              {enrichmentJobs.length > 0 && (
                <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {runningEnrichmentCount > 0 ? 'Enrichment in progress' : 'Enrichment needs attention'}
                      </h2>
                      <p className="mt-1 text-sm text-gray-500">
                        {runningEnrichmentCount > 0
                          ? "You don't need to wait on these pages."
                          : `${failedEnrichmentCount} enrichment${failedEnrichmentCount === 1 ? '' : 's'} failed.`}
                      </p>
                    </div>
                    {runningEnrichmentCount > 0 && (
                      <span className="rounded-full bg-arcova-teal/10 px-2.5 py-1 text-xs font-semibold text-arcova-teal">
                        {runningEnrichmentCount} running
                      </span>
                    )}
                  </div>

                  <div className="mt-4 divide-y divide-gray-100">
                    {enrichmentJobs.slice(0, 5).map((job) => (
                      <div key={job.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                job.status === 'running'
                                  ? 'bg-arcova-teal/10 text-arcova-teal'
                                  : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {job.status === 'running' ? 'Running' : 'Failed'}
                            </span>
                            <p className="truncate text-sm font-semibold text-gray-900">{job.title}</p>
                          </div>
                          <p className="mt-1 truncate text-xs text-gray-500">
                            {job.kind === 'icp' ? 'ICP' : 'Lead'}
                            {job.subtitle ? ` · ${job.subtitle}` : ''}
                            {' · '}
                            {formatTimeAgo(job.started_at || job.finished_at)}
                          </p>
                          {job.status === 'failed' && job.last_error && (
                            <p className="mt-1 truncate text-xs text-rose-600">{job.last_error}</p>
                          )}
                        </div>
                        <button
                          onClick={() => router.push(job.href)}
                          className="shrink-0 text-sm font-medium hover:opacity-80"
                          style={{ color: TEAL }}
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hubspotSyncLog && (
                <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 shrink-0 text-[#ff7a59]" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.164 7.932V5.085a2.198 2.198 0 0 0 1.268-1.978V3.06A2.199 2.199 0 0 0 17.235.862h-.047a2.199 2.199 0 0 0-2.197 2.197v.047a2.199 2.199 0 0 0 1.268 1.978v2.847a6.232 6.232 0 0 0-2.962 1.302L5.028 3.617a2.44 2.44 0 0 0 .072-.573A2.455 2.455 0 1 0 2.645 5.5a2.43 2.43 0 0 0 1.194-.315l8.122 4.707a6.248 6.248 0 0 0 0 4.208L4.123 18.5a2.432 2.432 0 0 0-1.478-.498 2.455 2.455 0 1 0 2.455 2.455 2.43 2.43 0 0 0-.388-1.337l7.91-4.583a6.266 6.266 0 0 0 8.976-5.628 6.25 6.25 0 0 0-3.434-5.977zm-1.023 9.565a3.59 3.59 0 1 1 0-7.181 3.59 3.59 0 0 1 0 7.181z"/>
                      </svg>
                      <div>
                        <h2 className="text-base font-semibold text-gray-900">Last HubSpot sync</h2>
                        <p className="text-xs text-gray-500 mt-0.5">{formatTimeAgo(hubspotSyncLog.synced_at)}</p>
                      </div>
                    </div>
                    <button onClick={() => router.push('/results')} className="shrink-0 text-sm font-medium hover:opacity-80" style={{ color: TEAL }}>
                      Go to leads
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-sm text-gray-600">
                    <span><span className="font-semibold text-gray-900">{hubspotSyncLog.contacts_synced}</span> synced</span>
                    {hubspotSyncLog.contacts_errors > 0 && (
                      <span><span className="font-semibold text-rose-600">{hubspotSyncLog.contacts_errors}</span> errors</span>
                    )}
                    {hubspotSyncLog.contacts_skipped > 0 && (
                      <button
                        onClick={() => setSyncLogExpanded((v) => !v)}
                        className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
                      >
                        <svg className={`w-3 h-3 transition-transform ${syncLogExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        <span><span className="font-semibold">{hubspotSyncLog.contacts_skipped}</span> skipped</span>
                      </button>
                    )}
                  </div>
                  {syncLogExpanded && hubspotSyncLog.skipped_contacts.length > 0 && (
                    <ul className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                      {hubspotSyncLog.skipped_contacts.map((c, i) => (
                        <li key={i} className="text-xs text-gray-600">
                          <span className="font-medium text-gray-800">{c.name}</span>
                          {c.company && <span className="text-gray-400"> · {c.company}</span>}
                          <span className="ml-1.5 text-amber-600">— {c.reason.toLowerCase()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {!isLiveMode ? (
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">Welcome to Arcova</h1>
                  <p className="text-lg text-gray-600 mt-2">Complete your setup to start seeing leads.</p>

                  <div className="mt-6 mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-700">{completedSteps} of {steps.length} steps complete</p>
                    </div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${steps.length > 0 ? (completedSteps / steps.length) * 100 : 0}%`, backgroundColor: TEAL }}
                      />
                    </div>
                  </div>

                  {hasIcpCoverageData && <div className="mb-8">{icpCoverageSection}</div>}

                  <div className="space-y-4">
                    {steps.map((step) => (
                      <div
                        key={step.id}
                        className={`rounded-lg border p-4 flex items-center justify-between ${
                          step.completed ? 'bg-gray-50 border-gray-200 opacity-80' : 'bg-white border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {step.completed ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white" style={{ backgroundColor: TEAL }}>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-gray-300 text-gray-400">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                              </svg>
                            </span>
                          )}
                          <p className={`text-base ${step.completed ? 'text-gray-600' : 'text-gray-900 font-semibold'}`}>{step.label}</p>
                        </div>

                        {step.completed ? (
                          <span className="text-sm text-gray-500">Completed</span>
                        ) : (
                          <button
                            onClick={() => router.push(step.actionPath)}
                            className="text-sm font-semibold px-3 py-1.5 rounded-md text-white hover:opacity-90 transition-opacity"
                            style={{ backgroundColor: TEAL }}
                          >
                            Set up →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">Here&apos;s what&apos;s happened since you last logged in.</h1>
                  </div>

                  {icpCoverageSection}

                  <div className="rounded-lg border border-gray-200 p-6 bg-white">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">New signals</h2>

                    {newSignals.length === 0 ? (
                      <p className="text-sm text-gray-500">No new signals since your last visit. Check back tomorrow.</p>
                    ) : (
                      <div className="space-y-3">
                        {newSignals.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                            <div className="min-w-0">
                              <button
                                onClick={() => router.push(item.href)}
                                className="font-semibold text-gray-900 hover:underline truncate"
                              >
                                {item.label}
                              </button>
                              <span className="text-gray-500"> {' - '} {item.signalType}</span>
                            </div>
                            <p className="text-gray-500 whitespace-nowrap">{formatTimeAgo(item.timestamp)}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={() => router.push('/customer-signals')}
                        className="text-sm font-medium hover:opacity-80"
                        style={{ color: TEAL }}
                      >
                        See all signals →
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-6 bg-white">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Top leads right now</h2>

                    {topLeads.length === 0 ? (
                      <p className="text-sm text-gray-500">No ranked leads yet. Complete more setup details to improve scoring.</p>
                    ) : (
                      <div className="space-y-3">
                        {topLeads.map((lead) => (
                          <div key={lead.id} className="flex items-center justify-between gap-4 text-sm">
                            <div className="min-w-0">
                              <button onClick={() => router.push(lead.href)} className="font-semibold text-gray-900 hover:underline truncate">
                                {lead.name}
                              </button>
                              <p className="text-gray-500 truncate">
                                {lead.latestSignalType} · {formatTimeAgo(lead.latestSignalAt)}
                              </p>
                            </div>
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold text-white" style={{ backgroundColor: TEAL }}>
                              {lead.priorityScore}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={() => router.push('/results')}
                        className="text-sm font-medium hover:opacity-80"
                        style={{ color: TEAL }}
                      >
                        See all leads →
                      </button>
                    </div>
                  </div>

                  {followUpReminders.length > 0 && (
                    <div className="rounded-lg border border-gray-200 p-6 bg-white">
                      <h2 className="text-xl font-semibold text-gray-900 mb-4">Follow up reminders</h2>
                      <div className="space-y-3">
                        {followUpReminders.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-4 text-sm">
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-900 truncate">{item.contactName}</p>
                              <p className="text-gray-500 truncate">{item.companyName}</p>
                            </div>
                            <p className="text-gray-500 whitespace-nowrap">Last updated {daysSince(item.updatedAt)} days ago</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={() => router.push('/results')}
                          className="text-sm font-medium hover:opacity-80"
                          style={{ color: TEAL }}
                        >
                          See all contacts →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
