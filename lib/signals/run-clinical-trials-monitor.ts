import { createAdminClient } from '@/lib/supabase-admin';
import { ensureCompanyAliases } from '@/lib/signals/company-aliases';
import { buildCompanyQueryVariants, normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';

type CompanyRow = {
  id: string;
  user_id: string;
  company_name: string | null;
  domain: string | null;
  aliases: string[] | null;
};

type ClinicalTrialsMonitorInput = {
  userId: string;
  companyIds?: string[];
  limit?: number;
  onlySignalKey?: SignalKey;
};

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

function companyTokens(name: string): string[] {
  const stop = new Set([
    'inc',
    'incorporated',
    'corp',
    'corporation',
    'co',
    'company',
    'ltd',
    'limited',
    'llc',
    'plc',
    'gmbh',
    'therapeutics',
    'biosciences',
    'biotech',
    'bio',
  ]);
  return stripPunctuation(normalizeText(name))
    .split(' ')
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function looksLikeCompanyStudy(companyName: string, study: CtStudy): boolean {
  const tokens = companyTokens(companyName);
  if (!tokens.length) return false;
  const haystack = normalizeText(
    [
      study.leadSponsor,
      ...study.collaborators,
      study.title,
    ]
      .filter(Boolean)
      .join(' ')
  );
  if (!haystack) return false;
  const matched = tokens.filter((token) => haystack.includes(token));
  return matched.length >= Math.min(2, tokens.length);
}

function isHighConfidenceSponsorMatch(companyName: string, study: CtStudy): boolean {
  const sponsor = normalizeText(study.leadSponsor);
  if (!sponsor) return false;

  const company = stripPunctuation(normalizeText(companyName));
  const sponsorNorm = stripPunctuation(sponsor);
  if (!company || !sponsorNorm) return false;

  // Strong signal: one normalized name contains the other.
  if (company.includes(sponsorNorm) || sponsorNorm.includes(company)) return true;

  // Fallback: high overlap on meaningful tokens.
  const companySet = new Set(companyTokens(companyName));
  const sponsorTokens = stripPunctuation(sponsor).split(' ').filter((t) => t.length >= 3);
  const overlap = sponsorTokens.filter((t) => companySet.has(t)).length;
  return overlap >= Math.min(2, companySet.size);
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

function escapePostgrestPattern(term: string): string {
  return term.replace(/[,()]/g, ' ').trim();
}

async function fetchStudiesForCompany(
  admin: ReturnType<typeof createAdminClient>,
  companyName: string,
  aliases: string[],
  limit = 100,
): Promise<CtStudy[]> {
  // Read from the local clinical_trials mirror (populated by syncCtDelta).
  // ILIKE-OR across normalized variants on lead_sponsor_normalized.
  // Trigram index makes this fast even at 500K+ rows.
  const terms = [...new Set(
    buildCompanyQueryVariants(companyName, aliases)
      .map((v) => normalizeCompanyForMatching(v))
      .filter((v) => v.length >= 4),
  )];
  if (terms.length === 0) return [];

  const orClause = terms
    .map((t) => `lead_sponsor_normalized.ilike.%${escapePostgrestPattern(t)}%`)
    .join(',');
  const { data, error } = await admin
    .from('clinical_trials')
    .select('nct_id, brief_title, overall_status, phases, conditions, lead_sponsor, collaborators, last_update_post_date, locations_count')
    .or(orClause)
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
    };
  }).filter((s): s is CtStudy => Boolean(s.nctId));
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
    metadata: {
      nct_id: input.study.nctId,
      study_title: input.study.title,
      study_status: input.study.overallStatus,
      conditions: input.study.conditions,
      phases: input.study.phases,
      lead_sponsor: input.study.leadSponsor,
      locations_count: input.study.locationsCount,
      ...input.metadata,
    },
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
      metadata: {
        nct_id: input.study.nctId,
        study_title: input.study.title,
        study_status: input.study.overallStatus,
        conditions: input.study.conditions,
        phases: input.study.phases,
        lead_sponsor: input.study.leadSponsor,
        locations_count: input.study.locationsCount,
        ...input.metadata,
      },
    },
    signalKeys: [input.signalKey],
    companyId: input.companyId,
  });

  return true;
}

export async function runClinicalTrialsMonitor(
  input: ClinicalTrialsMonitorInput
): Promise<ClinicalTrialsMonitorResult> {
  const admin = createAdminClient();

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
    .select('id, user_id, company_name, domain, aliases')
    .in('id', ownedIds);
  if (companiesError) throw new Error(companiesError.message);

  // Lazy-populate aliases for any company missing them. ensureCompanyAliases
  // is a no-op when aliases are already populated and fresh (<180 days).
  const companyAliasMap = new Map<string, string[]>();
  for (const row of (companies ?? []) as CompanyRow[]) {
    const name = row.company_name?.trim();
    if (!name) continue;
    let aliases = row.aliases ?? [];
    if (aliases.length === 0) {
      try {
        const result = await ensureCompanyAliases(admin, row.id);
        aliases = result.aliases;
      } catch (error) {
        console.error(`[clinical-trials] ensureCompanyAliases failed for ${row.id}:`, error);
      }
    }
    companyAliasMap.set(row.id, aliases);
  }

  let processed = 0;
  let failed = 0;
  const emittedSignalTypes = new Set<string>();
  const recomputedCompanyIds = new Set<string>();
  const failures: Array<{ company_id: string; error: string }> = [];

  for (const row of (companies ?? []) as CompanyRow[]) {
    const companyName = row.company_name?.trim();
    if (!companyName) continue;

    try {
      const studies = await fetchStudiesForCompany(admin, companyName, companyAliasMap.get(row.id) ?? [], 100);
      const matching = studies.filter((study) => {
        if (!looksLikeCompanyStudy(companyName, study)) return false;
        if (input.onlySignalKey === 'clinical_trial_registered') {
          return isHighConfidenceSponsorMatch(companyName, study);
        }
        return true;
      });
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
