'use client';

import AppSidebar from '@/components/AppSidebar';
import { READINESS_SIGNAL_CATALOG } from '@/lib/signals/readiness-catalog';
import type { ReadinessDimension, SignalCatalogEntry, SignalKey } from '@/lib/signals/readiness-types';
import { isAdminEmail } from '@/lib/admin-access';
import { useAuth } from '@/context/AuthContext';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'arcova_admin_signals_todo_v1';
const AUTO_COMPLETED_SIGNALS = new Set<SignalKey>([
  'funding_round',
  'grant_award',
  'ipo_or_follow_on',
  'distressed_financing',
  'clinical_trial_registered',
  'phase_transition',
  'trial_failure_or_halt',
  'open_opportunity_in_crm',
  'new_contact_added_in_crm',
  'title_change',
  'recently_promoted',
  'new_internal_role',
  'recently_changed_company',
  'closed_lost_in_crm',
]);

type SignalFamily =
  | 'external_company_change'
  | 'external_contact_change'
  | 'first_party_engagement'
  | 'crm_deal_activity'
  | 'crm_contact_change'
  | 'crm_relationship_state'
  | 'suppression_signals';

const DIMENSION_META: Record<ReadinessDimension, { label: string; description: string; userFacingLabel: string }> = {
  new_budget: {
    label: 'New budget',
    description: 'Signals that suggest fresh spend capacity or stronger budget availability.',
    userFacingLabel: 'Fresh budget signals',
  },
  new_needs: {
    label: 'New needs',
    description: 'Signals that suggest new operational, clinical, regulatory, or scale burden.',
    userFacingLabel: 'Operational need signals',
  },
  new_people: {
    label: 'New people',
    description: 'Signals that suggest a new owner, buyer, champion, or team buildout.',
    userFacingLabel: 'New decision-maker signals',
  },
  new_strategy: {
    label: 'New strategy',
    description: 'Signals that suggest a meaningful shift in direction, scope, or posture.',
    userFacingLabel: 'Strategic change signals',
  },
  caution: {
    label: 'Caution',
    description: 'Signals that suppress or qualify outreach timing.',
    userFacingLabel: 'Timing risk',
  },
};

const DIMENSION_ORDER: ReadinessDimension[] = [
  'new_budget',
  'new_needs',
  'new_people',
  'new_strategy',
  'caution',
];

const FAMILY_META: Record<SignalFamily, { label: string; description: string }> = {
  external_company_change: {
    label: 'External company change',
    description: 'Market-observed company events like funding, clinical progression, expansion, and partnerships.',
  },
  external_contact_change: {
    label: 'External contact change',
    description: 'Org movement and people change from external enrichment like hires, promotions, company moves, and role changes.',
  },
  first_party_engagement: {
    label: 'First-party engagement',
    description: 'Engagement you directly observe such as replies, visits, event attendance, and inbound hand-raises.',
  },
  crm_deal_activity: {
    label: 'CRM deal activity',
    description: 'Buying-process evidence from HubSpot/CRM like opportunities, budget notes, and deal progression.',
  },
  crm_contact_change: {
    label: 'CRM contact change',
    description: 'HubSpot people and stakeholder changes like new contacts, promotions, title changes, and changed company context.',
  },
  crm_relationship_state: {
    label: 'CRM relationship state',
    description: 'Account relationship context like lapsed customers, prior opportunities, or route-quality changes.',
  },
  suppression_signals: {
    label: 'Suppression signals',
    description: 'Negative timing signals that should cap or qualify outreach urgency.',
  },
};

const FAMILY_ORDER: SignalFamily[] = [
  'external_company_change',
  'external_contact_change',
  'first_party_engagement',
  'crm_deal_activity',
  'crm_contact_change',
  'crm_relationship_state',
  'suppression_signals',
];

const SIGNAL_FAMILY_MAP: Record<SignalKey, SignalFamily[]> = {
  funding_round: ['external_company_change'],
  grant_award: ['external_company_change'],
  ipo_or_follow_on: ['external_company_change'],
  milestone_payment: ['external_company_change'],
  partnership_with_upfront_economics: ['external_company_change'],
  ma_event: ['external_company_change', 'suppression_signals'],
  demo_requested: ['first_party_engagement'],
  inbound_enquiry: ['first_party_engagement'],
  open_opportunity_in_crm: ['crm_deal_activity'],
  new_contact_added_in_crm: ['crm_contact_change'],
  closed_lost_in_crm: ['crm_deal_activity', 'suppression_signals'],
  clinical_trial_registered: ['external_company_change'],
  clinical_trial_recruiting: ['external_company_change'],
  clinical_trial_completed: ['external_company_change'],
  clinical_trial_sponsor_change: ['external_company_change'],
  phase_transition: ['external_company_change'],
  trial_site_expansion: ['external_company_change'],
  indication_expansion: ['external_company_change'],
  breakthrough_designation: ['external_company_change'],
  fast_track_designation: ['external_company_change'],
  priority_review: ['external_company_change'],
  orphan_designation: ['external_company_change'],
  complete_response_letter: ['suppression_signals'],
  fda_approval: ['external_company_change'],
  new_facility: ['external_company_change'],
  facility_expansion: ['external_company_change'],
  cmc_scale_up: ['external_company_change'],
  cdmo_partnership: ['external_company_change'],
  quality_compliance_buildout: ['external_company_change'],
  visited_your_website: ['first_party_engagement'],
  attended_your_webinar_or_event: ['first_party_engagement'],
  downloaded_your_content: ['first_party_engagement'],
  responded_to_previous_outreach: ['first_party_engagement'],
  cmc_hiring: ['external_company_change'],
  clinical_ops_hiring: ['external_company_change'],
  regulatory_hiring: ['external_company_change'],
  bd_hiring: ['external_company_change'],
  commercial_hiring: ['external_company_change'],
  job_surge: ['external_company_change'],
  new_to_role: ['external_contact_change', 'crm_contact_change'],
  recently_promoted: ['external_contact_change', 'crm_contact_change'],
  recently_changed_company: ['external_contact_change', 'crm_contact_change'],
  new_internal_role: ['external_contact_change', 'crm_contact_change'],
  title_change: ['external_contact_change', 'crm_contact_change'],
  board_or_advisory_role: ['external_contact_change'],
  partnership_deal: ['external_company_change'],
  licensing_deal: ['external_company_change'],
  co_development_deal: ['external_company_change'],
  regional_expansion: ['external_company_change'],
  commercialization_move: ['external_company_change'],
  platform_repositioning: ['external_company_change'],
  conference_presentation: ['external_company_change'],
  conference_speaker: ['external_contact_change'],
  publication: ['external_company_change'],
  new_paper_published: ['external_contact_change'],
  patent_filed_or_granted: ['external_company_change'],
  patent_application_published: ['external_company_change'],
  patent_granted: ['external_company_change'],
  new_therapeutic_area_patent: ['external_company_change'],
  assignee_portfolio_acceleration: ['external_company_change'],
  layoffs: ['suppression_signals'],
  trial_failure_or_halt: ['suppression_signals'],
  program_discontinuation: ['suppression_signals'],
  restructuring: ['suppression_signals'],
  distressed_financing: ['suppression_signals'],
  acquisition_distraction: ['suppression_signals'],
  leadership_churn: ['external_contact_change', 'suppression_signals'],
  lapsed_customer: ['crm_relationship_state', 'suppression_signals'],
};

type ChecklistState = Partial<Record<SignalKey, boolean>>;

function titleCaseSignalKey(signalKey: SignalKey): string {
  return signalKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function loadChecklistState(): ChecklistState {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as ChecklistState;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function saveChecklistState(state: ChecklistState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function isSignalCompleted(signalKey: SignalKey, checks: ChecklistState): boolean {
  return AUTO_COMPLETED_SIGNALS.has(signalKey) || Boolean(checks[signalKey]);
}

function scopeLabel(entry: SignalCatalogEntry): string {
  return entry.scope === 'company' ? 'Company' : 'Contact';
}

function familyLabels(signalKey: SignalKey): string {
  return (SIGNAL_FAMILY_MAP[signalKey] ?? []).map((family) => FAMILY_META[family].label).join(', ');
}

export default function AdminSignalsTodoPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [checks, setChecks] = useState<ChecklistState>({});
  const isAdminUser = isAdminEmail(user?.email);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  useEffect(() => {
    if (!user) return;
    setChecks(loadChecklistState());
  }, [user]);

  const groupedSignals = useMemo(
    () =>
      Object.fromEntries(
        DIMENSION_ORDER.map((dimension) => [
          dimension,
          READINESS_SIGNAL_CATALOG.filter((entry) => entry.dimensions.includes(dimension)),
        ])
      ) as Record<ReadinessDimension, SignalCatalogEntry[]>,
    []
  );

  const groupedSignalsByDimensionAndFamily = useMemo(
    () =>
      Object.fromEntries(
        DIMENSION_ORDER.map((dimension) => {
          const entries = groupedSignals[dimension];
          return [
            dimension,
            Object.fromEntries(
              FAMILY_ORDER.map((family) => [
                family,
                entries.filter((entry) => (SIGNAL_FAMILY_MAP[entry.signalKey] ?? []).includes(family)),
              ])
            ) as Record<SignalFamily, SignalCatalogEntry[]>,
          ];
        })
      ) as Record<ReadinessDimension, Record<SignalFamily, SignalCatalogEntry[]>>,
    [groupedSignals]
  );

  const familyCounts = useMemo(
    () =>
      Object.fromEntries(
        FAMILY_ORDER.map((family) => [
          family,
          READINESS_SIGNAL_CATALOG.filter((entry) => (SIGNAL_FAMILY_MAP[entry.signalKey] ?? []).includes(family)),
        ])
      ) as Record<SignalFamily, SignalCatalogEntry[]>,
    []
  );

  const uniqueSignalCount = READINESS_SIGNAL_CATALOG.length;
  const completedSignalCount = READINESS_SIGNAL_CATALOG.filter((entry) => isSignalCompleted(entry.signalKey, checks)).length;

  function toggleSignal(signalKey: SignalKey) {
    setChecks((current) => {
      const next = { ...current, [signalKey]: !current[signalKey] };
      saveChecklistState(next);
      return next;
    });
  }

  function resetChecks() {
    setChecks({});
    saveChecklistState({});
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!isAdminUser) {
    return (
      <div className="flex h-screen bg-transparent">
        <AppSidebar />
        <main className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            This page is restricted to admin users.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <main className="arcova-scroll-surface min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">Signals TODO</h1>
              <p className="mt-2 max-w-4xl text-sm text-slate-500">
                Internal rollout tracker for which normalized signals we are actually capturing, grouped by the newer
                readiness model. Signals still roll up into each readiness dimension, but this view now also shows the
                signal families underneath them so first-party, CRM, external, and suppression coverage stay visible.
              </p>
            </div>
            <button
              type="button"
              onClick={resetChecks}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset checks
            </button>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium text-slate-950">Signal → readiness → UI flow</h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-4">
              <FlowCard
                title="1. Detect"
                detail="Capture raw events from public sources, HubSpot/CRM, and first-party engagement."
              />
              <FlowCard
                title="2. Normalize"
                detail="Map those events into canonical Arcova signal keys and assign them to signal families."
              />
              <FlowCard
                title="3. Infer readiness"
                detail="Roll signals into new budget, new needs, new people, new strategy, and caution."
              />
              <FlowCard
                title="4. Show users"
                detail="Lead with one overall readiness verdict, then show top drivers, reason, and evidence underneath."
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900">What the user should see</div>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  <li>Readiness: High / Medium / Low</li>
                  <li>Top drivers: 2-3 active readiness dimensions</li>
                  <li>Reason: short explanation of what changed and why now</li>
                  <li>Evidence: concrete supporting signals underneath</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-sm font-medium text-slate-900">What stays internal</div>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  <li>Dimension-level scores for all 5 readiness dimensions</li>
                  <li>Signal family classification</li>
                  <li>Confidence, recency, momentum, and relevance lenses</li>
                  <li>Compound logic and caution suppression</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <SummaryCard
              title="Signals done"
              value={`${completedSignalCount}/${uniqueSignalCount}`}
              detail={`${Math.round((completedSignalCount / uniqueSignalCount) * 100) || 0}% complete`}
            />
            {DIMENSION_ORDER.map((dimension) => {
              const signals = groupedSignals[dimension];
              const done = signals.filter((entry) => isSignalCompleted(entry.signalKey, checks)).length;
              return (
                <SummaryCard
                  key={dimension}
                  title={DIMENSION_META[dimension].label}
                  value={`${done}/${signals.length}`}
                  detail={DIMENSION_META[dimension].userFacingLabel}
                />
              );
            })}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-medium text-slate-950">Signal families</h2>
                <p className="mt-1 text-sm text-slate-500">
                  These are the middle layer we were missing earlier. They help us keep external, CRM, and first-party
                  signals visible before they compress into readiness.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {FAMILY_ORDER.map((family) => {
                const signals = familyCounts[family];
                const done = signals.filter((entry) => isSignalCompleted(entry.signalKey, checks)).length;
                return (
                  <div key={family} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="text-sm font-medium text-slate-900">{FAMILY_META[family].label}</div>
                    <div className="mt-1 text-xs text-slate-500">{FAMILY_META[family].description}</div>
                    <div className="mt-3 text-sm text-slate-700">{done} of {signals.length} checked</div>
                  </div>
                );
              })}
            </div>
          </section>

          {DIMENSION_ORDER.map((dimension) => {
            const signals = groupedSignals[dimension];
            const familyGroups = groupedSignalsByDimensionAndFamily[dimension];
            return (
              <section key={dimension} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-slate-950">{DIMENSION_META[dimension].label}</h2>
                    <p className="mt-1 text-sm text-slate-500">{DIMENSION_META[dimension].description}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      User-facing phrasing: {DIMENSION_META[dimension].userFacingLabel}
                    </p>
                  </div>
                  <div className="text-sm text-slate-500">
                    {signals.filter((entry) => isSignalCompleted(entry.signalKey, checks)).length} of {signals.length} checked
                  </div>
                </div>

                <div className="mt-4 space-y-5">
                  {FAMILY_ORDER.map((family) => {
                    const familySignals = familyGroups[family];
                    if (familySignals.length === 0) return null;
                    return (
                      <div key={`${dimension}:${family}`} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <h3 className="text-sm font-medium text-slate-900">{FAMILY_META[family].label}</h3>
                            <p className="text-xs text-slate-500">{FAMILY_META[family].description}</p>
                          </div>
                          <div className="text-xs text-slate-500">
                            {familySignals.filter((entry) => isSignalCompleted(entry.signalKey, checks)).length} of {familySignals.length} checked
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead className="text-slate-500">
                              <tr>
                                <th className="px-3 py-2 font-medium">Done</th>
                                <th className="px-3 py-2 font-medium">Signal</th>
                                <th className="px-3 py-2 font-medium">Scope</th>
                                <th className="px-3 py-2 font-medium">Families</th>
                                <th className="px-3 py-2 font-medium">Strength</th>
                                <th className="px-3 py-2 font-medium">Confidence</th>
                                <th className="px-3 py-2 font-medium">Decay</th>
                                <th className="px-3 py-2 font-medium">Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {familySignals.map((entry) => {
                                const checked = isSignalCompleted(entry.signalKey, checks);
                                const autoCompleted = AUTO_COMPLETED_SIGNALS.has(entry.signalKey);
                                return (
                                  <tr key={`${dimension}:${family}:${entry.signalKey}`} className="border-t border-slate-100">
                                    <td className="px-3 py-3 align-top">
                                      <button
                                        type="button"
                                        onClick={() => toggleSignal(entry.signalKey)}
                                        disabled={autoCompleted}
                                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
                                          checked
                                            ? 'border-arcova-teal bg-arcova-teal text-white'
                                            : 'border-slate-300 bg-white text-transparent hover:border-slate-400'
                                        } ${autoCompleted ? 'cursor-default opacity-100' : ''}`}
                                        aria-pressed={checked}
                                        aria-label={`Mark ${entry.signalKey} as ${checked ? 'not done' : 'done'}`}
                                      >
                                        <Check className="h-4 w-4" />
                                      </button>
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      <div className="font-medium text-slate-950">{titleCaseSignalKey(entry.signalKey)}</div>
                                      <div className="mt-1 font-mono text-xs text-slate-500">{entry.signalKey}</div>
                                      {autoCompleted ? (
                                        <div className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                          Shipped
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="px-3 py-3 align-top text-slate-600">{scopeLabel(entry)}</td>
                                    <td className="px-3 py-3 align-top text-slate-600">{familyLabels(entry.signalKey)}</td>
                                    <td className="px-3 py-3 align-top text-slate-600">{entry.defaultStrength}</td>
                                    <td className="px-3 py-3 align-top text-slate-600">{entry.defaultConfidence}</td>
                                    <td className="px-3 py-3 align-top text-slate-600">{entry.decayDays}d</td>
                                    <td className="px-3 py-3 align-top text-slate-600">{entry.notes ?? '—'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function FlowCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <div className="text-sm font-medium text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-600">{detail}</div>
    </div>
  );
}
