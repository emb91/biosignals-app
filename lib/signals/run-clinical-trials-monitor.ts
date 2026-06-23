import { createAdminClient } from '@/lib/supabase-admin';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import {
  clinicalTrialCompanyAdmission,
  hasAdmittedClinicalTrialCompanyRole,
} from '@/lib/signals/clinical-trial-admission';
import { buildAdmissionMetadata } from '@/lib/signals/signal-admission';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { verifyNormalizedCompanyEvidence } from '@/lib/companies/match-helpers';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';

type CompanyRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
};

type ClinicalTrialsMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
  /** How many days back to look. Default 14, clamped to [1, 30]. */
  lookbackDays?: number;
};

const DEFAULT_LOOKBACK_DAYS = 14;
const MAX_LOOKBACK_DAYS = 30;

function clampLookback(value: number | undefined): number {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(1, Math.floor(v)));
}

export type ClinicalTrialsMonitorResult = {
  processed: number;
  failed: number;
  emitted_signal_types: string[];
  recomputed_companies: string[];
  failures: Array<{ company_id: string; error: string }>;
};

type CtStudy = {
  nctId: string;
  title: string | null;
  overallStatus: string | null;
  phases: string[];
  conditions: string[];
  leadSponsor: string | null;
  collaborators: string[];
  lastUpdatePostDate: string | null;
  sourceUrl: string;
  locationsCount: number | null;
  overallOfficials: Array<{ name: string; role: string; affiliation: string }>;
  mentionedCompanyMatches: unknown;
};

const SOURCE = 'clinicaltrials_gov';

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return 'Internal server error';
}

function normalizeText(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function stripPunctuation(value: string): string {
  return value.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function phaseRank(phases: string[]): number {
  const joined = phases.map((p) => normalizeText(p)).join(' ');
  if (joined.includes('phase 4')) return 5;
  if (joined.includes('phase 3')) return 4;
  if (joined.includes('phase 2')) return 3;
  if (joined.includes('phase 1')) return 2;
  if (joined.includes('early phase 1')) return 1;
  return 0;
}

function hasAny(text: string, needles: string[]): boolean {
  const v = normalizeText(text);
  return needles.some((needle) => v.includes(needle));
}

function isFailureStatus(status?: string | null): boolean {
  const s = normalizeText(status);
  return hasAny(s, ['suspended', 'terminated', 'withdrawn']);
}

function isActiveTrialStatus(status?: string | null): boolean {
  const s = normalizeText(status);
  return hasAny(s, ['recruiting', 'not yet recruiting', 'active, not recruiting', 'enrolling by invitation']);
}

function isRecruitingStatus(status?: string | null): boolean {
  const s = normalizeText(status);
  return hasAny(s, ['recruiting', 'not yet recruiting', 'enrolling by invitation']);
}

function isCompletedStatus(status?: string | null): boolean {
  const s = normalizeText(status);
  return hasAny(s, ['completed']);
}

function nameTokens(name: string): string[] {
  const stop = new Set(['md', 'phd', 'dr', 'prof', 'mr', 'ms', 'mrs', 'jr', 'sr']);
  return stripPunctuation(normalizeText(name))
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
}

function piNameMatchesContact(piName: string, contactFullName: string): boolean {
  const piTokens = nameTokens(piName);
  const contactTokens = nameTokens(contactFullName);
  if (piTokens.length < 2 || contactTokens.length < 2) return false;
  const contactSet = new Set(contactTokens);
  const matched = piTokens.filter((t) => contactSet.has(t)).length;
  return matched >= Math.min(2, piTokens.length);
}

function piAffiliationMatchesCompany(
  affiliation: string | null | undefined,
  companyName: string,
): { verified: boolean; reason: string } {
  const affiliationNorm = normalizeCompanyForMatching(affiliation ?? '');
  const companyNorm = normalizeCompanyForMatching(companyName);
  if (!affiliationNorm || !companyNorm) {
    return { verified: false, reason: 'PI affiliation or company name is missing' };
  }
  return verifyNormalizedCompanyEvidence(affiliationNorm, companyNorm);
}

async function fetchStudiesForCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyId: string,
  cutoffIso: string,
  limit = 100,
): Promise<CtStudy[]> {
  // Read from the local clinical_trials mirror. mentioned_company_ids is
  // populated at ingest by the resolver and GIN-indexed.
  // Time cutoff: signals are about recent state changes — a trial last
  // updated 6 months ago isn't useful intent intel.
  const { data, error } = await admin
    .from('clinical_trials')
    .select('nct_id, brief_title, overall_status, phases, conditions, lead_sponsor, collaborators, last_update_post_date, locations_count, overall_officials, mentioned_company_matches')
    .contains('mentioned_company_ids', [companyId])
    .gte('last_update_post_date', cutoffIso)
    .order('last_update_post_date', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(`clinical_trials query failed: ${error.message}`);

  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const nctId = typeof row.nct_id === 'string' ? row.nct_id : '';
    return {
      nctId,
      title: typeof row.brief_title === 'string' ? row.brief_title : null,
      overallStatus: typeof row.overall_status === 'string' ? row.overall_status : null,
      phases: Array.isArray(row.phases) ? (row.phases as string[]) : [],
      conditions: Array.isArray(row.conditions) ? (row.conditions as string[]) : [],
      leadSponsor: typeof row.lead_sponsor === 'string' ? row.lead_sponsor : null,
      collaborators: Array.isArray(row.collaborators) ? (row.collaborators as string[]) : [],
      lastUpdatePostDate:
        typeof row.last_update_post_date === 'string' ? row.last_update_post_date : null,
      sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
      locationsCount: typeof row.locations_count === 'number' ? row.locations_count : null,
      overallOfficials: Array.isArray(row.overall_officials)
        ? (row.overall_officials as Array<{ name: string; role: string; affiliation: string }>)
        : [],
      mentionedCompanyMatches: row.mentioned_company_matches,
    };
  })
    .filter((s): s is CtStudy => Boolean(s.nctId))
    .filter((s) => hasAdmittedClinicalTrialCompanyRole(s.mentionedCompanyMatches, companyId));
}

async function sourceEventExists(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  sourceEventId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('signal_source_events')
    .select('id')
    .eq('user_id', userId)
    .eq('source', SOURCE)
    .eq('source_event_id', sourceEventId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function previousStateForNct(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  companyId: string,
  nctId: string
): Promise<{ maxPhaseRank: number; maxLocations: number; maxConditionCount: number; priorSponsors: string[] }> {
  const { data, error } = await admin
    .from('signal_source_events')
    .select('metadata')
    .eq('user_id', userId)
    .eq('source', SOURCE)
    .eq('entity_company_id', companyId)
    .eq('metadata->>nct_id', nctId)
    .limit(200);
  if (error) throw error;
  let maxPhaseRank = 0;
  let maxLocations = 0;
  let maxConditionCount = 0;
  const sponsors = new Set<string>();
  for (const row of data ?? []) {
    const m = (row as any)?.metadata ?? {};
    const phase = typeof m.current_phase_rank === 'number' ? m.current_phase_rank : 0;
    const locations = typeof m.locations_count === 'number' ? m.locations_count : 0;
    const cond = typeof m.conditions_count === 'number' ? m.conditions_count : 0;
    const sponsor = typeof m.lead_sponsor === 'string' ? normalizeText(m.lead_sponsor) : '';
    if (phase > maxPhaseRank) maxPhaseRank = phase;
    if (locations > maxLocations) maxLocations = locations;
    if (cond > maxConditionCount) maxConditionCount = cond;
    if (sponsor) sponsors.add(sponsor);
  }
  return { maxPhaseRank, maxLocations, maxConditionCount, priorSponsors: [...sponsors] };
}

async function emitCompanySignal(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    userId: string;
    companyId: string;
    companyName: string;
    study: CtStudy;
    signalKey: SignalKey;
    sourceEventType: string;
    sourceEventId: string;
    summary: string;
    metadata: Record<string, unknown>;
  }
): Promise<boolean> {
  const admission = clinicalTrialCompanyAdmission({
    companyId: input.companyId,
    signalKey: input.signalKey,
    mentionedCompanyMatches: input.study.mentionedCompanyMatches,
  });
  if (!admission.admitted) return false;

  const metadata = {
    nct_id: input.study.nctId,
    study_title: input.study.title,
    study_status: input.study.overallStatus,
    conditions: input.study.conditions,
    phases: input.study.phases,
    lead_sponsor: input.study.leadSponsor,
    collaborators: input.study.collaborators,
    locations_count: input.study.locationsCount,
    overall_officials: input.study.overallOfficials,
    official_affiliations: input.study.overallOfficials.map((official) => official.affiliation).filter(Boolean),
    ...input.metadata,
    ...buildAdmissionMetadata(admission),
  };

  if (await sourceEventExists(admin, input.userId, input.sourceEventId)) {
    return false;
  }

  const ingest = await ingestSignalSourceEvent(admin, {
    userId: input.userId,
    entityScope: 'company',
    companyId: input.companyId,
    source: SOURCE,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    sourceUrl: input.study.sourceUrl,
    title: `${input.signalKey} detected from ClinicalTrials.gov`,
    summary: input.summary,
    excerpt: input.summary,
    eventAt: input.study.lastUpdatePostDate ?? new Date().toISOString(),
    metadata,
  });

  await normalizeSignalSourceEvent(admin, {
    userId: input.userId,
    rawEvent: {
      id: ingest.sourceEventId,
      userId: input.userId,
      entityId: input.companyId,
      entityScope: 'company',
      source: SOURCE,
      sourceUrl: input.study.sourceUrl,
      sourceEventType: input.sourceEventType,
      sourceEventId: input.sourceEventId,
      title: `${input.signalKey} detected from ClinicalTrials.gov`,
      summary: input.summary,
      excerpt: input.summary,
      eventAt: input.study.lastUpdatePostDate ?? null,
      observedAt: new Date().toISOString(),
      metadata,
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
  });

  return true;
}

async function emitPiSignalsForStudy(
  admin: ReturnType<typeof createAdminClient>,
  opts: {
    userId: string;
    companyId: string;
    companyName: string;
    study: CtStudy;
    emittedSignalTypes: Set<string>;
  }
): Promise<boolean> {
  const principals = opts.study.overallOfficials.filter(
    (o) => o.role.toUpperCase().includes('PRINCIPAL') || o.role.toUpperCase() === 'PI'
  );
  if (principals.length === 0) return false;

  const { data: contacts, error } = await admin
    .from('contacts')
    .select('id, full_name')
    .eq('user_id', opts.userId)
    .eq('company_id', opts.companyId)
    .is('archived_at', null)
    .not('full_name', 'is', null);
  if (error) throw new Error(`contacts query for PI matching: ${error.message}`);
  if (!contacts || contacts.length === 0) return false;

  const study = opts.study;
  let anyEmitted = false;

  for (const pi of principals) {
    const affiliationMatch = piAffiliationMatchesCompany(pi.affiliation, opts.companyName);
    if (!affiliationMatch.verified) continue;

    const contact = (contacts as Array<{ id: string; full_name: string | null }>).find(
      (c) => c.full_name && piNameMatchesContact(pi.name, c.full_name)
    );
    if (!contact) continue;

    const sourceEventId = `${SOURCE}:pi_new_trial:${contact.id}:${study.nctId}`;
    if (await sourceEventExists(admin, opts.userId, sourceEventId)) continue;

    const summary = `${contact.full_name} is listed as Principal Investigator on ${study.title ?? study.nctId} (${study.nctId}).`;
    const metadata = {
      nct_id: study.nctId,
      study_title: study.title,
      study_status: study.overallStatus,
      conditions: study.conditions,
      phases: study.phases,
      pi_name: pi.name,
      pi_role: pi.role,
      pi_affiliation: pi.affiliation,
      ...buildAdmissionMetadata({
        admitted: true,
        reason: 'Clinical trial PI name matched an owned contact and PI affiliation matched the tracked company.',
        confidence: 'medium',
        entityScope: 'contact',
        companyId: opts.companyId,
        contactId: contact.id,
        matchType: 'verified_clinical_pi_affiliation',
        metadata: {
          role_gate: 'passed',
          role_gate_reason: 'PI name match plus PI affiliation company verification',
          matched_source_field: 'overall_officials',
          matched_source_text: `${pi.name} / ${pi.affiliation}`,
          matched_company_name: opts.companyName,
          verification_reason: affiliationMatch.reason,
        },
      }),
    };

    const ingest = await ingestSignalSourceEvent(admin, {
      userId: opts.userId,
      entityScope: 'contact',
      companyId: opts.companyId,
      contactId: contact.id,
      source: SOURCE,
      sourceEventType: 'principal_investigator_new_trial',
      sourceEventId,
      sourceUrl: study.sourceUrl,
      title: 'Principal investigator on new clinical trial',
      summary,
      excerpt: summary,
      eventAt: study.lastUpdatePostDate ?? new Date().toISOString(),
      metadata,
    });

    await normalizeSignalSourceEvent(admin, {
      userId: opts.userId,
      rawEvent: {
        id: ingest.sourceEventId,
        userId: opts.userId,
        entityId: contact.id,
        entityScope: 'contact',
        source: SOURCE,
        sourceUrl: study.sourceUrl,
        sourceEventType: 'principal_investigator_new_trial',
        sourceEventId,
        title: 'Principal investigator on new clinical trial',
        summary,
        excerpt: summary,
        eventAt: study.lastUpdatePostDate ?? null,
        observedAt: new Date().toISOString(),
        metadata,
      },
      signalKeys: ['principal_investigator_new_trial'],
      companyId: opts.companyId,
      contactId: contact.id,
    });

    opts.emittedSignalTypes.add('principal_investigator_new_trial');
    anyEmitted = true;
  }

  return anyEmitted;
}

export async function runClinicalTrialsMonitor(
  input: ClinicalTrialsMonitorInput
): Promise<ClinicalTrialsMonitorResult> {
  const admin = createAdminClient();
  const lookbackDays = clampLookback(input.lookbackDays);
  const cutoffIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  // Ownership + archive state live in user_companies.
  const { data: linkRows, error: linkError } = await admin
    .from('user_companies')
    .select('company_id')
    .eq('user_id', input.userId)
    .is('archived_at', null);
  if (linkError) throw new Error(`user_companies query: ${linkError.message}`);
  let ownedIds = (linkRows ?? [])
    .map((r) => (r as { company_id?: unknown }).company_id)
    .filter((v): v is string => typeof v === 'string' && Boolean(v));

  const companyIds = Array.isArray(input.companyIds)
    ? input.companyIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
    : [];
  if (companyIds.length > 0) {
    const requestedSet = new Set(companyIds);
    ownedIds = ownedIds.filter((id) => requestedSet.has(id));
  } else {
    ownedIds = ownedIds.slice(0, Math.min(Math.max(input.limit ?? 25, 1), 100));
  }

  if (ownedIds.length === 0) {
    return {
      processed: 0,
      failed: 0,
      emitted_signal_types: [],
      recomputed_companies: [],
      failures: [],
    };
  }

  const { data: companies, error: companiesError } = await admin
    .from('companies')
    .select('id, company_name, domain')
    .in('id', ownedIds);
  if (companiesError) throw new Error(companiesError.message);

  let processed = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const studies = await fetchStudiesForCompany(admin, row.id, cutoffIso, 100);
      const matching = studies;
      let emittedAny = false;

      for (const study of matching) {
        const state = await previousStateForNct(admin, input.userId, row.id, study.nctId);
        const rank = phaseRank(study.phases);
        const status = normalizeText(study.overallStatus);
        const conditionsCount = study.conditions.length;
        const locationsCount = study.locationsCount ?? 0;
        const onlySignal = input.onlySignalKey;
        const shouldEmit = (signalKey: SignalKey) => !onlySignal || onlySignal === signalKey;

        const baseSummary = `ClinicalTrials.gov indicates activity for ${companyName} (${study.nctId}).`;

        if (shouldEmit('clinical_trial_registered') && isActiveTrialStatus(status) && rank > 0 && state.maxPhaseRank === 0) {
          const id = `${SOURCE}:${row.id}:${study.nctId}:clinical_trial_registered`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'clinical_trial_registered',
            sourceEventType: 'clinical_trial_registered',
            sourceEventId: id,
            summary: `${baseSummary} New active trial registration observed.`,
            metadata: { current_phase_rank: rank, previous_phase_rank: 0, conditions_count: conditionsCount },
          });
              if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('clinical_trial_registered');
          }
        }

        if (shouldEmit('clinical_trial_recruiting') && isRecruitingStatus(status)) {
          const recruitId = `${SOURCE}:${row.id}:${study.nctId}:clinical_trial_recruiting:${status}`;
          const recruitEmitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'clinical_trial_recruiting',
            sourceEventType: 'clinical_trial_recruiting',
            sourceEventId: recruitId,
            summary: `${baseSummary} Study is actively recruiting participants (${study.overallStatus ?? 'unknown'}).`,
            metadata: { current_phase_rank: rank, previous_phase_rank: state.maxPhaseRank, conditions_count: conditionsCount },
          });
          if (recruitEmitted) {
            emittedAny = true;
            emittedSignalTypes.add('clinical_trial_recruiting');
          }
        }

        if (shouldEmit('clinical_trial_completed') && isCompletedStatus(status)) {
          const completeId = `${SOURCE}:${row.id}:${study.nctId}:clinical_trial_completed:${status}`;
          const completeEmitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'clinical_trial_completed',
            sourceEventType: 'clinical_trial_completed',
            sourceEventId: completeId,
            summary: `${baseSummary} Study completion status observed (${study.overallStatus ?? 'unknown'}).`,
            metadata: { current_phase_rank: rank, previous_phase_rank: state.maxPhaseRank, conditions_count: conditionsCount },
          });
          if (completeEmitted) {
            emittedAny = true;
            emittedSignalTypes.add('clinical_trial_completed');
          }
        }

        const currentSponsor = normalizeText(study.leadSponsor);
        if (
          shouldEmit('clinical_trial_sponsor_change') &&
          currentSponsor &&
          state.priorSponsors.length > 0 &&
          !state.priorSponsors.includes(currentSponsor)
        ) {
          const previousSponsor = state.priorSponsors[0] ?? 'unknown sponsor';
          const sponsorId = `${SOURCE}:${row.id}:${study.nctId}:clinical_trial_sponsor_change:${currentSponsor}`;
          const sponsorEmitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'clinical_trial_sponsor_change',
            sourceEventType: 'clinical_trial_sponsor_change',
            sourceEventId: sponsorId,
            summary: `${baseSummary} Lead sponsor changed from ${previousSponsor} to ${study.leadSponsor ?? 'unknown sponsor'}.`,
            metadata: {
              previous_sponsors: state.priorSponsors,
              current_sponsor: study.leadSponsor,
              current_phase_rank: rank,
              previous_phase_rank: state.maxPhaseRank,
              conditions_count: conditionsCount,
            },
          });
          if (sponsorEmitted) {
            emittedAny = true;
            emittedSignalTypes.add('clinical_trial_sponsor_change');
          }
        }

        if (shouldEmit('phase_transition') && rank > state.maxPhaseRank && state.maxPhaseRank > 0) {
          const id = `${SOURCE}:${row.id}:${study.nctId}:phase_transition:${rank}`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'phase_transition',
            sourceEventType: 'phase_transition',
            sourceEventId: id,
            summary: `${baseSummary} Phase progression observed.`,
            metadata: { current_phase_rank: rank, previous_phase_rank: state.maxPhaseRank, conditions_count: conditionsCount },
          });
          if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('phase_transition');
          }
        }

        if (shouldEmit('trial_site_expansion') && locationsCount >= 5 && locationsCount > state.maxLocations) {
          const id = `${SOURCE}:${row.id}:${study.nctId}:trial_site_expansion:${locationsCount}`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'trial_site_expansion',
            sourceEventType: 'trial_site_expansion',
            sourceEventId: id,
            summary: `${baseSummary} Trial site footprint expanded.`,
            metadata: {
              current_phase_rank: rank,
              previous_phase_rank: state.maxPhaseRank,
              previous_locations_count: state.maxLocations,
              locations_count: locationsCount,
              conditions_count: conditionsCount,
            },
          });
          if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('trial_site_expansion');
          }
        }

        if (shouldEmit('indication_expansion') && conditionsCount >= 2 && conditionsCount > state.maxConditionCount) {
          const id = `${SOURCE}:${row.id}:${study.nctId}:indication_expansion:${conditionsCount}`;
          const emitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'indication_expansion',
            sourceEventType: 'indication_expansion',
            sourceEventId: id,
            summary: `${baseSummary} Expanded condition/indication scope observed.`,
            metadata: {
              current_phase_rank: rank,
              previous_phase_rank: state.maxPhaseRank,
              previous_conditions_count: state.maxConditionCount,
              conditions_count: conditionsCount,
            },
          });
          if (emitted) {
            emittedAny = true;
            emittedSignalTypes.add('indication_expansion');
          }
        }

        if (shouldEmit('trial_failure_or_halt') && isFailureStatus(status)) {
          const haltId = `${SOURCE}:${row.id}:${study.nctId}:trial_failure_or_halt:${status}`;
          const haltEmitted = await emitCompanySignal(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            signalKey: 'trial_failure_or_halt',
            sourceEventType: 'trial_failure_or_halt',
            sourceEventId: haltId,
            summary: `${baseSummary} Trial status indicates a potential halt/failure condition (${study.overallStatus ?? 'unknown'}).`,
            metadata: { current_phase_rank: rank, previous_phase_rank: state.maxPhaseRank, conditions_count: conditionsCount },
          });
          if (haltEmitted) {
            emittedAny = true;
            emittedSignalTypes.add('trial_failure_or_halt');
          }

          if (shouldEmit('program_discontinuation') && (status.includes('terminated') || status.includes('withdrawn'))) {
            const discontinueId = `${SOURCE}:${row.id}:${study.nctId}:program_discontinuation:${status}`;
            const discontinueEmitted = await emitCompanySignal(admin, {
              userId: input.userId,
              companyId: row.id,
              companyName,
              study,
              signalKey: 'program_discontinuation',
              sourceEventType: 'program_discontinuation',
              sourceEventId: discontinueId,
              summary: `${baseSummary} Study status indicates possible program discontinuation (${study.overallStatus ?? 'unknown'}).`,
              metadata: { current_phase_rank: rank, previous_phase_rank: state.maxPhaseRank, conditions_count: conditionsCount },
            });
            if (discontinueEmitted) {
              emittedAny = true;
              emittedSignalTypes.add('program_discontinuation');
            }
          }
        }

        if (!input.onlySignalKey || input.onlySignalKey === 'principal_investigator_new_trial') {
          const piEmitted = await emitPiSignalsForStudy(admin, {
            userId: input.userId,
            companyId: row.id,
            companyName,
            study,
            emittedSignalTypes,
          });
          if (piEmitted) emittedAny = true;
        }
      }

      if (emittedAny) {
        await recomputeAccountReadiness(admin, {
          userId: input.userId,
          companyId: row.id,
        });
        await generateAccountReason(admin, {
          userId: input.userId,
          companyId: row.id,
        });
        recomputedCompanyIds.add(row.id);
      }

      processed += 1;
    } catch (error) {
      failed += 1;
      failures.push({ company_id: row.id, error: messageFromUnknown(error) });
    }
  }

  return {
    processed,
    failed,
    emitted_signal_types: [...emittedSignalTypes],
    recomputed_companies: [...recomputedCompanyIds],
    failures,
  };
}
