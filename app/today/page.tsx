'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { AgentPanel } from '@/components/AgentPanel';
import { supabase } from '@/lib/supabase';
import { ArrowRight, Check, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import './briefing-today.css';
import { ROUTES, withQuery } from '@/lib/routes';
import { fetchTodayPriorities } from '@/lib/today-priorities-client';
import type { TodayPriority } from '@/lib/priorities/types';
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

type LiveSignal = {
  id: string;
  signalKey: string;
  companyName: string | null;
  companyDomain: string | null;
  contactName: string | null;
  sourceTitle: string | null;
  sourceSummary: string | null;
  sourceUrl: string | null;
  sourceMetadata: Record<string, unknown>;
  observedAt: string;
  eventAt: string | null;
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

/** One individual event within a grouped signal row (e.g. one paper, one patent). */
type SignalSubItem = {
  id: string;
  title: string | null;
  url: string | null;
  what: string | null;
  ago: string;
};

/** One collapsed row = one (company, signal type) combination. */
type SignalGroupRow = {
  key: string;
  glyph: string;
  company: string;
  label: string;
  count: number;
  ago: string;
  /** Lead pill = summary count, rest = breakdown. Hiring expansion only. */
  pills?: string[];
  items: SignalSubItem[];
};

function signalGlyph(key: string): string {
  if (key.includes('patent') || key === 'assignee_portfolio_acceleration') return '◎';
  if (key.includes('publication') || key === 'new_paper_published') return '◈';
  if (key.includes('clinical') || key.includes('trial') || key.includes('indication') || key.includes('fda') || key.includes('program_discontinuation')) return '⬡';
  if (key.includes('hiring') || key === 'hiring_expansion' || key === 'job_surge') return '✦';
  if (key.includes('grant') || key === 'funding_round' || key === 'series_announcement' || key === 'acquisition' || key === 'partnership_announcement') return '◆';
  if (key.includes('crm') || key.includes('opportunity') || key === 'new_to_role' || key === 'title_change' || key === 'new_internal_role') return '◇';
  return '·';
}

const SIGNAL_LABELS: Record<string, string> = {
  // Hiring
  hiring_expansion:          'Hiring expansion',
  job_surge:                 'Hiring surge',
  research_hiring:           'Research hiring',
  cmc_hiring:                'CMC hiring',
  data_informatics_hiring:   'Data & informatics hiring',
  medical_hiring:            'Medical affairs hiring',
  quality_hiring:            'Quality hiring',
  executive_hiring:          'Executive hiring',
  clinical_ops_hiring:       'Clinical ops hiring',
  bd_hiring:                 'BD hiring',
  regulatory_hiring:         'Regulatory hiring',
  // Research
  assignee_portfolio_acceleration: 'Patent portfolio surge',
  patent_filed_or_granted:         'Patent filed',
  patent_application_published:    'Patent application',
  patent_granted:                  'Patent granted',
  new_therapeutic_area_patent:     'New TA patent',
  publication:                     'Publication',
  publication_surge:               'Publication surge',
  nih_grant_awarded:               'NIH grant awarded',
  grant_award:                     'Grant awarded',
  // Pipeline
  clinical_trial_recruiting:   'Trial recruiting',
  clinical_trial_registered:   'Trial registered',
  clinical_trial_phase_start:  'Trial phase start',
  clinical_trial_completion:   'Trial completed',
  clinical_trial_completed:    'Trial completed',
  clinical_trial_enrollment:   'Trial enrollment update',
  trial_site_expansion:        'Trial site expansion',
  trial_failure_or_halt:       'Trial halted',
  program_discontinuation:     'Programme discontinued',
  indication_expansion:        'Indication expansion',
  fda_submission:              'FDA submission',
  fda_approval:                'FDA approval',
  // Research extras
  new_paper_published:         'New publication',
  funding_round:               'Funding round',
  series_announcement:         'Series funding',
  acquisition:                 'Acquisition',
  partnership_announcement:    'Partnership',
  // People
  new_to_role:                 'New to role',
  title_change:                'Title change',
  new_internal_role:           'Internal promotion',
  new_contact_added_in_crm:    'Contact added',
  open_opportunity_in_crm:     'Deal in pipeline',
};

function signalLabel(key: string): string {
  return SIGNAL_LABELS[key] ?? key.replace(/_/g, ' ');
}

/** Maps hiring sub-category keys to short display labels for pills */
const HIRING_CATEGORY_LABELS: Record<string, string> = {
  research_hiring: 'R&D / discovery',
  cmc_hiring: 'CMC / process dev',
  data_informatics_hiring: 'data & informatics',
  quality_hiring: 'quality / GMP',
  executive_hiring: 'exec / VP',
  clinical_ops_hiring: 'clinical ops',
  medical_hiring: 'medical affairs',
  bd_hiring: 'BD',
};

const INDIVIDUAL_HIRING_KEYS = new Set([
  'research_hiring', 'cmc_hiring', 'data_informatics_hiring', 'quality_hiring',
  'executive_hiring', 'clinical_ops_hiring', 'medical_hiring', 'bd_hiring',
]);

type SignalFamilyDef = {
  key: string;
  eyebrow: string;
  title: string;
};

const SIGNAL_FAMILIES: SignalFamilyDef[] = [
  { key: 'hiring',   eyebrow: 'Talent',   title: 'Hiring'   },
  { key: 'research', eyebrow: 'Science',  title: 'Research' },
  { key: 'pipeline', eyebrow: 'Clinical', title: 'Pipeline' },
  { key: 'funding',  eyebrow: 'Market',   title: 'Funding'  },
  { key: 'people',   eyebrow: 'Moves',    title: 'People'   },
];

/** Age gate per family. Signals older than this are excluded from the today view. */
const FAMILY_MAX_AGE_MS: Record<string, number> = {
  hiring:   14 * 86_400_000,
  people:   14 * 86_400_000,
  research: 30 * 86_400_000,
  pipeline: 30 * 86_400_000,
  funding:  30 * 86_400_000,
};

const SIGNAL_KEY_TO_FAMILY: Record<string, string> = {
  // Hiring — LinkedIn Jobs + derived aggregates
  hiring_expansion:                'hiring',
  job_surge:                       'hiring',
  research_hiring:                 'hiring',
  cmc_hiring:                      'hiring',
  data_informatics_hiring:         'hiring',
  quality_hiring:                  'hiring',
  executive_hiring:                'hiring',
  clinical_ops_hiring:             'hiring',
  medical_hiring:                  'hiring',
  bd_hiring:                       'hiring',
  regulatory_hiring:               'hiring',
  // Research — PatentsView, PubMed, NIH
  assignee_portfolio_acceleration: 'research',
  patent_filed_or_granted:         'research',
  patent_application_published:    'research',
  patent_granted:                  'research',
  new_therapeutic_area_patent:     'research',
  publication:                     'research',
  publication_surge:               'research',
  new_paper_published:             'research',
  // Funding — grants, rounds, deals
  nih_grant_awarded:               'funding',
  grant_award:                     'funding',
  funding_round:                   'funding',
  series_announcement:             'funding',
  acquisition:                     'funding',
  partnership_announcement:        'funding',
  // Pipeline — ClinicalTrials.gov, FDA
  clinical_trial_recruiting:       'pipeline',
  clinical_trial_registered:       'pipeline',
  clinical_trial_completed:        'pipeline',
  clinical_trial_phase_start:      'pipeline',
  clinical_trial_completion:       'pipeline',
  clinical_trial_enrollment:       'pipeline',
  trial_site_expansion:            'pipeline',
  trial_failure_or_halt:           'pipeline',
  program_discontinuation:         'pipeline',
  indication_expansion:            'pipeline',
  fda_submission:                  'pipeline',
  fda_approval:                    'pipeline',
  // People — LinkedIn moves, HubSpot CRM
  new_to_role:                     'people',
  title_change:                    'people',
  new_internal_role:               'people',
  new_contact_added_in_crm:        'people',
  open_opportunity_in_crm:         'people',
};

function relativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const t = Date.parse(isoStr);
  if (!Number.isFinite(t)) return '';
  const diffDays = Math.floor((Date.now() - t) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Signals whose sourceTitle is a real document title (paper name, patent title, deal name)
 * that should be shown as-is. Everything else gets a friendly generated label.
 */
const DOCUMENT_TITLE_KEYS = new Set([
  'publication', 'publication_surge', 'new_paper_published',
  'patent_filed_or_granted', 'patent_application_published', 'patent_granted', 'new_therapeutic_area_patent',
  'assignee_portfolio_acceleration',
  'fda_approval', 'fda_submission',
  'funding_round', 'series_announcement', 'acquisition',
  'clinical_trial_recruiting', 'clinical_trial_registered', 'clinical_trial_phase_start',
  'clinical_trial_completion', 'clinical_trial_completed', 'trial_site_expansion',
  'trial_failure_or_halt', 'program_discontinuation', 'indication_expansion',
  // grant_award / nih_grant_awarded excluded: their title is a DB artifact;
  // the summary field carries the useful text (award amount, agency, grant number)
]);

/** Patterns in titles/summaries that indicate internal tooling provenance — hide from users. */
const INTERNAL_PROVENANCE = /\b(apify|manual[_ ]test|test[_ ]emission|admin[_ ]signals|hubspot[_ ]contact|linkedin[_ ]scrape)\b/i;
/** DB-generated event titles like "hiring_expansion detected at Revvity" */
const DB_EVENT_TITLE = /^[\w_]+\s+(detected|found|updated|created|added|changed|entered|identified)\b/i;

function cleanSubItemTitle(
  signalKey: string,
  title: string | null,
  summary: string | null,
  contactName?: string | null,
): string | null {
  // Sanitiser: null-out any string that looks like internal tooling text
  const safe = (s: string | null | undefined): string | null => {
    if (!s) return null;
    if (INTERNAL_PROVENANCE.test(s)) return null;
    if (DB_EVENT_TITLE.test(s)) return null;
    return s;
  };

  // Aggregate hiring signals: pills carry all the info; never show a sub-item title
  // (checked first so the summary "X has 47 open roles..." doesn't sneak through)
  if (signalKey === 'hiring_expansion' || signalKey === 'job_surge') return null;

  // Document-titled signals get their actual source title (PubMed, USPTO, ClinicalTrials, etc.)
  // For grants we skip this — title is a DB artifact; summary has the good text
  if (DOCUMENT_TITLE_KEYS.has(signalKey)) {
    return safe(title) ?? safe(summary);
  }

  // For grants: summary is "SBIR award to X: $1.4M from NIDA..." — the useful field
  if (signalKey === 'grant_award' || signalKey === 'nih_grant_awarded') {
    return safe(summary) ?? safe(title);
  }

  // All other operational signals: try data fields first, then a friendly fallback
  const fromData = safe(summary) ?? safe(title);
  if (fromData) return fromData;

  switch (signalKey) {
    case 'hiring_expansion':
    case 'job_surge':               return null; // (already handled above, belt-and-suspenders)
    case 'open_opportunity_in_crm': return 'Deal entered active stage';
    case 'new_contact_added_in_crm': return contactName ? `${contactName} added` : 'Contact added';
    case 'new_to_role':             return contactName ? `${contactName} — new role` : 'New role';
    case 'title_change':            return contactName ? `${contactName} — title changed` : 'Title changed';
    case 'new_internal_role':       return contactName ? `${contactName} — promotion` : 'Internal promotion';
    case 'trial_site_expansion':    return 'Site expansion';
    case 'indication_expansion':    return 'Indication expansion';
    case 'clinical_trial_phase_start':
    case 'clinical_trial_recruiting': return 'Phase started';
    case 'clinical_trial_completion':
    case 'clinical_trial_completed': return 'Phase completed';
    case 'clinical_trial_enrollment': return 'Enrollment update';
    default: return null;
  }
}

/** Strip internal scraper URLs — only show real source URLs to users. */
function cleanSubItemUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.includes('apify.com') || url.includes('api.apify.com')) return null;
  return url;
}

export default function BriefingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [topLeads, setTopLeads] = useState<TopLead[]>([]);
  const [repliedCount, setRepliedCount] = useState<number>(0);
  const [firstRepliedName, setFirstRepliedName] = useState<string | null>(null);
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
  const [expandedSignalRows, setExpandedSignalRows] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState(() => new Date());
  // Cross-page priorities aggregated server-side. Each source (icp-audit today,
  // enrichment-failures / pipeline-health / etc. tomorrow) returns at most one grouped
  // TodayPriority row. /today is a dumb consumer — never knows what's in the list.
  const [aggregatedPriorities, setAggregatedPriorities] = useState<TodayPriority[]>([]);
  const [liveSignals, setLiveSignals] = useState<LiveSignal[]>([]);

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
          repliedRes,
          liveSignalsRes,
        ] = await Promise.all([
          supabase.from('user_company').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          fetch(ROUTES.api.icps),
          fetch('/api/contacts'),
          supabase.from('raw_uploads').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          fetch('/api/leads?pageSize=5&page=1'),
          fetch('/api/hubspot/sync-log'),
          fetch('/api/accounts/icp-coverage'),
          fetch('/api/pipeline/icp-cards'),
          fetch('/api/import-ready'),
          fetch('/api/outreach/replied'),
          fetch('/api/signals/feed?pageSize=50&page=1&skipPatentCollapse=1'),
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
                href: withQuery(ROUTES.contacts, `lead=${encodeURIComponent(id)}`),
              };
            }),
          );
        }

        if (syncLogRes.ok) {
          const syncJson = await syncLogRes.json() as { data: typeof hubspotSyncLog };
          setHubspotSyncLog(syncJson.data);
        }

        if (repliedRes.ok) {
          const repliedJson = (await repliedRes.json()) as {
            count?: number;
            sequences?: Array<{ contact_name?: string; contact_id?: string }>;
          };
          setRepliedCount(repliedJson.count ?? 0);
          const first = repliedJson.sequences?.[0];
          setFirstRepliedName(first?.contact_name ?? null);
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

        if (liveSignalsRes.ok) {
          const sigJson = (await liveSignalsRes.json()) as { data?: Array<Record<string, unknown>> };
          setLiveSignals(
            (sigJson.data ?? []).map((s) => ({
              id: String(s.id ?? ''),
              signalKey: String(s.signalKey ?? ''),
              companyName: typeof s.companyName === 'string' ? s.companyName : null,
              companyDomain: typeof s.companyDomain === 'string' ? s.companyDomain : null,
              contactName: typeof s.contactName === 'string' ? s.contactName : null,
              sourceTitle: typeof s.sourceTitle === 'string' ? s.sourceTitle : null,
              sourceSummary: typeof s.sourceSummary === 'string' ? s.sourceSummary : null,
              sourceUrl: typeof s.sourceUrl === 'string' ? s.sourceUrl : null,
              sourceMetadata: (s.sourceMetadata && typeof s.sourceMetadata === 'object' && !Array.isArray(s.sourceMetadata))
                ? (s.sourceMetadata as Record<string, unknown>)
                : {},
              observedAt: String(s.observedAt ?? ''),
              eventAt: typeof s.eventAt === 'string' ? s.eventAt : null,
            }))
          );
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
      } finally {
        setLoadingDashboard(false);
      }
    };

    void fetchDashboardData();
  }, [user]);

  useEffect(() => {
    void fetchEnrichmentJobs();
  }, [fetchEnrichmentJobs]);

  // Fetch the cross-page priorities aggregate (cached, sessionStorage). Every source on
  // the server runs in parallel; we just render what comes back.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const priorities = await fetchTodayPriorities();
      if (!cancelled) setAggregatedPriorities(priorities);
    })();
    return () => { cancelled = true; };
  }, [user]);

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

  const signalGroups = useMemo((): Array<{ family: SignalFamilyDef; rows: SignalGroupRow[] }> => {
    const now = Date.now();
    const familyMap = new Map<string, Map<string, SignalGroupRow>>();

    for (const s of liveSignals) {
      const meta = s.sourceMetadata as Record<string, unknown>;
      const familyKey = SIGNAL_KEY_TO_FAMILY[s.signalKey] ?? 'funding';

      // Age gate: skip signals outside the family's window
      const maxAgeMs = FAMILY_MAX_AGE_MS[familyKey] ?? 30 * 86_400_000;
      const sigDate = Date.parse(s.eventAt ?? s.observedAt) || 0;
      if (now - sigDate > maxAgeMs) continue;

      if (!familyMap.has(familyKey)) familyMap.set(familyKey, new Map());
      const family = familyMap.get(familyKey)!;

      const company = s.companyName ?? s.companyDomain ?? 'Unknown';
      const rowKey = `${company}||${s.signalKey}`;

      // Aggregate hiring signals: pills already tell the whole story; a single
      // job posting URL out of 40+ roles would be misleading — suppress it.
      const isHiringAggregate = s.signalKey === 'hiring_expansion' || s.signalKey === 'job_surge';

      // Build sub-item with sanitised title + URL
      const subItem: SignalSubItem = {
        id: s.id,
        title: cleanSubItemTitle(s.signalKey, s.sourceTitle, s.sourceSummary, s.contactName),
        url: isHiringAggregate ? null : cleanSubItemUrl(s.sourceUrl),
        what: null,
        ago: relativeTime(s.eventAt ?? s.observedAt),
      };

      if (!family.has(rowKey)) {
        // Row-level pills for aggregate hiring signals
        let pills: string[] | undefined;
        if (s.signalKey === 'hiring_expansion') {
          const total = typeof meta.total_postings === 'number' ? meta.total_postings : null;
          const categories = meta.categories && typeof meta.categories === 'object'
            ? (meta.categories as Record<string, number>) : null;
          pills = [];
          if (total !== null) pills.push(`${total} open roles`);
          let categorisedSum = 0;
          if (categories) {
            for (const [key, count] of Object.entries(categories)) {
              const lbl = HIRING_CATEGORY_LABELS[key];
              if (lbl) {
                pills.push(count > 1 ? `${lbl} · ${count}` : lbl);
                categorisedSum += count;
              }
            }
          }
          // Show unclassified remainder so the headline total adds up
          const other = total !== null ? total - categorisedSum : 0;
          if (other > 0) pills.push(`+ ${other} general roles`);
        } else if (s.signalKey === 'job_surge') {
          const count = typeof meta.total_postings === 'number' ? meta.total_postings : null;
          pills = count !== null ? [`${count} open roles`] : undefined;
        } else if (INDIVIDUAL_HIRING_KEYS.has(s.signalKey)) {
          const count = typeof meta.count === 'number' ? meta.count : null;
          pills = count !== null ? [`${count} role${count !== 1 ? 's' : ''}`] : undefined;
        }

        family.set(rowKey, {
          key: rowKey,
          glyph: signalGlyph(s.signalKey),
          company,
          label: signalLabel(s.signalKey),
          count: 1,
          ago: relativeTime(s.eventAt ?? s.observedAt),
          pills,
          items: [subItem],
        });
      } else {
        const row = family.get(rowKey)!;
        row.count++;
        row.items.push(subItem);
      }
    }

    // Always return all 5 families — empty tiles show a quiet-state message
    return SIGNAL_FAMILIES.map((f) => ({
      family: f,
      rows: familyMap.has(f.key) ? [...familyMap.get(f.key)!.values()] : [],
    }));
  }, [liveSignals]);

  const toggleSignalRow = (key: string) => {
    setExpandedSignalRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const agenda: AgendaItem[] = [
    // Replies are the highest-leverage thing on the page when present —
    // a contact wrote back, the rep needs to reply before anything else.
    ...(repliedCount > 0
      ? [{
          id: 'needs-reply',
          label: '',
          title: 'Reply to engaged contacts',
          detail:
            repliedCount === 1 && firstRepliedName
              ? `${firstRepliedName} replied to a sequence — take it human from here.`
              : `${repliedCount} contact${repliedCount === 1 ? '' : 's'} replied to a sequence. Take it human from here.`,
          href: withQuery(ROUTES.outreach, 'status=replied'),
          cta: 'Open replies',
        }]
      : []),
    ...(nextStep
      ? [{
          id: `setup-${nextStep.id}`,
          label: '',
          title: `Finish ${nextStep.label}`,
          detail: 'The rest of the product depends on this being complete.',
          href: nextStep.actionPath,
          cta: 'Continue',
        }]
      : []),
    // Cross-page aggregator priorities. Placed near the top so a new source can't get
    // chopped off behind the long tail of hand-rolled items. One entry per source per
    // groupKey; the source itself decides what to surface (icp-audit, future ones).
    ...aggregatedPriorities.map((p, idx) => ({
      id: `agg-${p.source}-${p.groupKey}-${idx}`,
      label: '',
      title: p.title,
      detail: p.detail,
      href: p.href,
      cta: p.cta,
    })),
    ...(showImportReady
      ? [{
          id: 'import-ready',
          label: nextStep ? '2' : '1',
          title: 'Review new contacts',
          detail: 'The import has finished, so Leads can now show what is Ready, Monitor, Source, or Deprioritised.',
          href: withQuery(ROUTES.contacts, 'agentTask=new_contacts'),
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
          href: withQuery(ROUTES.contacts, 'agentTask=best_leads'),
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
  ].map((item, index) => ({ ...item, label: String(index + 1) }));

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

      <main className="briefing-today relative min-h-0 flex-1 overflow-y-auto bg-transparent">
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
                  <span>Agent · {agentBusy ? 'thinking' : 'ready'}</span>
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

            </div>

            {signalGroups.map((group) => (
              <section key={group.family.key} className="bt-bento bt-signals-tile">
                <header className="bt-tile-head">
                  <div>
                    <p className="bt-tile-eyebrow">{group.family.eyebrow}</p>
                    <h2 className="bt-tile-title">{group.family.title}</h2>
                  </div>
                  {group.rows.length > 0 && (
                    <span className="bt-tile-live">
                      <span className="bt-live-dot" style={{ background: BT_ACCENT }} />
                      {group.rows.length === 1 ? '1 account' : `${group.rows.length} accounts`}
                    </span>
                  )}
                </header>
                {group.rows.length === 0 ? (
                  <p className="bt-sig-quiet">
                    No {group.family.title.toLowerCase()} signals in the last {(group.family.key === 'hiring' || group.family.key === 'people') ? '14' : '30'} days
                  </p>
                ) : (
                  <ul className="bt-sig-list">
                    {group.rows.map((row, i) => {
                      const isOpen = expandedSignalRows.has(row.key);
                      // Only expandable if there's at least one sub-item with content
                      const expandableItems = row.items.filter(item => item.title || item.url);
                      const isExpandable = expandableItems.length > 0;
                      const RowEl = isExpandable ? 'button' : 'div';
                      return (
                        <li key={row.key} className="bt-sig-group-item" style={{ animationDelay: `${i * 40}ms` }}>
                          {/* Collapsed row — always visible */}
                          <RowEl
                            {...(isExpandable ? { type: 'button' as const, onClick: () => toggleSignalRow(row.key), 'aria-expanded': isOpen } : {})}
                            className={cn('bt-sig-row bt-sig-row--group', isOpen && 'is-open', !isExpandable && 'bt-sig-row--static')}
                          >
                            <span className="bt-sig-glyph" style={{ color: BT_ACCENT }}>{row.glyph}</span>
                            <span className="bt-sig-body">
                              <span className="bt-sig-line">
                                <strong>{row.company}</strong>
                                {` · ${row.label}`}
                                {row.count > 1 && (
                                  <span className="bt-sig-count">{row.count}</span>
                                )}
                              </span>
                              {row.pills && row.pills.length > 0 && (
                                <span className="bt-sig-pills">
                                  {row.pills.map((pill, j) => (
                                    <span key={j} className={cn('bt-sig-pill', j === 0 && 'bt-sig-pill--lead')}>
                                      {pill}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                            <span className="bt-sig-ago">{row.ago}</span>
                            {isExpandable && (
                              <ChevronRight className="bt-sig-chevron h-3 w-3" strokeWidth={2.2} />
                            )}
                          </RowEl>

                          {/* Expanded sub-items */}
                          {isOpen && isExpandable && (
                            <ul className="bt-sig-sub-list">
                              {expandableItems.map((item) => {
                                const label = item.title ?? item.what;
                                if (!label && !item.url) return null;
                                return (
                                  <li key={item.id} className="bt-sig-sub-item">
                                    {item.url ? (
                                      <a
                                        href={item.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="bt-sig-sub-link"
                                      >
                                        {label ?? item.url}
                                        <ExternalLink className="bt-sig-sub-ext h-2.5 w-2.5" strokeWidth={2} />
                                      </a>
                                    ) : (
                                      <span className="bt-sig-sub-text">{label}</span>
                                    )}
                                    {item.ago && <span className="bt-sig-sub-ago">{item.ago}</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}

          </div>
        </div>
      </main>
    </div>
  );
}
