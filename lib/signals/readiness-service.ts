import type { SupabaseClient } from '@supabase/supabase-js';
import { effectiveReadiness } from '@/lib/lead-action';
import { authoritativeAccountReadiness, computeIntrinsicPriority } from '@/lib/effective-priority';
import { orgIdForUser } from '@/lib/org-context';
import { buildAccountReadinessContext } from '@/lib/signals/readiness-context';
import { normalizeReadinessEvent } from '@/lib/signals/readiness-normalize';
import { buildAccountReason } from '@/lib/signals/readiness-reason';
import { scoreAccountReadiness } from '@/lib/signals/readiness-score';
import {
  getCompanyFitSnapshot,
  getLatestReadinessSnapshot,
  getLatestReasonSnapshot,
  getSignalEvidenceByIds,
  insertNormalizedSignals,
  insertSignalSourceEvent,
  listNormalizedSignalsForCompany,
  listNormalizedSignalsForContact,
  replaceReadinessSnapshotEvidence,
  upsertAccountReadinessSnapshot,
  upsertContactReadinessSnapshot,
  upsertAccountReasonSnapshot,
} from '@/lib/signals/readiness-store';
import type {
  AccountReadinessContext,
  BuyerFunction,
  RawSignalEvent,
  SignalKey,
  SignalScope,
} from '@/lib/signals/readiness-types';

type DatabaseClient = SupabaseClient<any, 'public', any>;

function finiteScoreNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function updateOrgCompanyReadinessMirror(
  supabase: DatabaseClient,
  userId: string,
  companyId: string,
  readinessScore: number,
): Promise<void> {
  const orgId = await orgIdForUser(supabase, userId);
  if (!orgId) return;

  const { error } = await supabase
    .from('org_companies')
    .update({ readiness_score: readinessScore, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('company_id', companyId);

  if (error) {
    console.warn('Company readiness org mirror write failed:', error.message);
  }
}

async function getCompanyFitReadinessState(
  supabase: DatabaseClient,
  userId: string,
  companyId: string,
): Promise<{ company_fit_score: number | null; readiness_score: number | null } | null> {
  let fitScore: number | null = null;
  let mirrorReadinessScore: number | null = null;

  const orgId = await orgIdForUser(supabase, userId);
  if (orgId) {
    const { data, error } = await supabase
      .from('org_companies')
      .select('company_fit_score, readiness_score')
      .eq('org_id', orgId)
      .eq('company_id', companyId)
      .maybeSingle();
    if (!error && data) {
      const row = data as { company_fit_score?: unknown; readiness_score?: unknown };
      fitScore = finiteScoreNumber(row.company_fit_score);
      mirrorReadinessScore = finiteScoreNumber(row.readiness_score);
    }
  }

  if (!orgId || fitScore == null) {
    const { data } = await supabase
      .from('user_companies')
      .select('company_fit_score, readiness_score')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .maybeSingle();
    const row = data as { company_fit_score?: unknown; readiness_score?: unknown } | null;
    fitScore = fitScore ?? finiteScoreNumber(row?.company_fit_score);
    mirrorReadinessScore = mirrorReadinessScore ?? finiteScoreNumber(row?.readiness_score);
  }

  const { data: snapshot } = await supabase
    .from('account_readiness_snapshots')
    .select('overall_score')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  const snapshotReadinessScore = finiteScoreNumber(
    (snapshot as { overall_score?: unknown } | null)?.overall_score,
  );

  if (fitScore == null && snapshotReadinessScore == null && mirrorReadinessScore == null) {
    return null;
  }

  return {
    company_fit_score: fitScore,
    readiness_score: authoritativeAccountReadiness(snapshotReadinessScore, mirrorReadinessScore),
  };
}

export type IngestSignalSourceEventInput = {
  userId: string;
  entityScope: SignalScope;
  companyId?: string | null;
  contactId?: string | null;
  source: string;
  sourceEventType: string;
  sourceEventId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  summary?: string | null;
  excerpt?: string | null;
  eventAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type IngestSignalSourceEventResult = {
  sourceEventId: string;
  normalizationQueued: boolean;
};

export type NormalizeSignalSourceEventInput = {
  userId: string;
  rawEvent: RawSignalEvent;
  signalKeys?: SignalKey[];
  buyerFunctionsOverride?: BuyerFunction[];
  companyId?: string | null;
  contactId?: string | null;
};

export type NormalizeSignalSourceEventResult = {
  sourceEventId: string;
  normalizedSignalIds: string[];
  affectedCompanyIds: string[];
};

export type RecomputeAccountReadinessInput = {
  userId: string;
  companyId: string;
  targetBuyerFunctions?: BuyerFunction[];
};

export type RecomputeAccountReadinessResult = {
  companyId: string;
  readinessSnapshotId: string;
  overallScore: number;
  overallLabel: 'low' | 'medium' | 'high';
};

export type RecomputeContactReadinessInput = {
  userId: string;
  contactId: string;
  targetBuyerFunctions?: BuyerFunction[];
};

export type RecomputeContactReadinessResult = {
  contactId: string;
  readinessSnapshotId: string;
  overallScore: number;
  overallLabel: 'low' | 'medium' | 'high';
};

export type GenerateAccountReasonInput = {
  userId: string;
  companyId: string;
  targetBuyerFunctions?: BuyerFunction[];
};

export type GenerateAccountReasonResult = {
  companyId: string;
  reasonSnapshotId: string;
};

export type BuildAccountReadinessContextInput = {
  userId: string;
  companyId: string;
  targetBuyerFunctions?: BuyerFunction[];
  recommendedContacts?: AccountReadinessContext['route']['recommendedContacts'];
  limitTopSignals?: number;
};

export async function ingestSignalSourceEvent(
  supabase: DatabaseClient,
  input: IngestSignalSourceEventInput
): Promise<IngestSignalSourceEventResult> {
  const rawEvent = await insertSignalSourceEvent(supabase, input);
  return {
    sourceEventId: rawEvent.id,
    normalizationQueued: true,
  };
}

export async function normalizeSignalSourceEvent(
  supabase: DatabaseClient,
  input: NormalizeSignalSourceEventInput
): Promise<NormalizeSignalSourceEventResult> {
  const normalized = normalizeReadinessEvent({
    rawEvent: input.rawEvent,
    signalKeys: input.signalKeys,
    buyerFunctionsOverride: input.buyerFunctionsOverride,
  });

  const inserted = await insertNormalizedSignals(
    supabase,
    input.userId,
    input.rawEvent,
    normalized,
    input.companyId,
    input.contactId
  );

  const affectedCompanyIds = [...new Set([input.companyId, input.rawEvent.entityScope === 'company' ? input.rawEvent.entityId : null].filter((value): value is string => !!value))];

  return {
    sourceEventId: input.rawEvent.id,
    normalizedSignalIds: inserted.map((signal) => signal.id),
    affectedCompanyIds,
  };
}

export async function recomputeAccountReadiness(
  supabase: DatabaseClient,
  input: RecomputeAccountReadinessInput
): Promise<RecomputeAccountReadinessResult> {
  const [signals, fitSnapshot] = await Promise.all([
    listNormalizedSignalsForCompany(supabase, input.userId, input.companyId),
    getCompanyFitSnapshot(supabase, input.userId, input.companyId),
  ]);

  const score = scoreAccountReadiness(signals, {
    targetBuyerFunctions: input.targetBuyerFunctions,
  });

  const snapshot = await upsertAccountReadinessSnapshot(supabase, {
    userId: input.userId,
    companyId: input.companyId,
    fitScore: fitSnapshot?.fitScore ?? null,
    fitLabel: fitSnapshot?.fitLabel ?? null,
    score,
  });

  await replaceReadinessSnapshotEvidence(supabase, snapshot.id, score.contributions);

  // Keep org_companies as the company-readiness truth. user_companies is still
  // mirrored below only for legacy/background compatibility while old code is
  // being retired.
  await updateOrgCompanyReadinessMirror(supabase, input.userId, input.companyId, score.overallScore);

  {
    const { error: mirrorErr } = await supabase
      .from('user_companies')
      .update({ readiness_score: score.overallScore })
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId);
    if (mirrorErr) {
      console.warn('Account readiness mirror write failed:', mirrorErr.message);
    }
  }

  return {
    companyId: input.companyId,
    readinessSnapshotId: snapshot.id,
    overallScore: score.overallScore,
    overallLabel: score.overallLabel,
  };
}

export async function recomputeContactReadiness(
  supabase: DatabaseClient,
  input: RecomputeContactReadinessInput
): Promise<RecomputeContactReadinessResult> {
  const [signals, contactFitRow] = await Promise.all([
    listNormalizedSignalsForContact(supabase, input.userId, input.contactId),
    // Pull contact fit + the contact's company_id so we can look up org-scoped
    // company fit. contacts.company_fit_score does NOT exist. Priority =
    // company_fit × contact_fit × (0.5 + 0.5 × r).
    // Best-effort: a missing row leaves priority null and the snapshot still writes.
    supabase
      .from('contacts')
      .select('contact_fit_score, company_id')
      .eq('id', input.contactId)
      .eq('user_id', input.userId)
      .maybeSingle()
      .then((res) =>
        res.error
          ? null
          : (res.data as { contact_fit_score: number | null; company_id: string | null } | null),
      ),
  ]);

  // Resolve company fit + company readiness via org_companies. Company
  // readiness feeds EFFECTIVE readiness below.
  let companyFitScore: number | null = null;
  let companyReadinessScore: number | null = null;
  if (contactFitRow?.company_id) {
    const companyState = await getCompanyFitReadinessState(supabase, input.userId, contactFitRow.company_id);
    companyFitScore = companyState?.company_fit_score ?? null;
    companyReadinessScore = companyState?.readiness_score ?? null;
  }

  const score = scoreAccountReadiness(signals, {
    targetBuyerFunctions: input.targetBuyerFunctions,
  });

  // Priority uses EFFECTIVE readiness (max of company + contact, plus the
  // both-present bump) — the same combine the action tree uses. A well-fit
  // contact at a hot account should read as high priority even with no
  // personal signal (the Althea-@-Illumina case). The snapshot's own
  // overall_score stays the contact-level readiness; only priority folds in
  // company momentum.
  const effReadiness =
    effectiveReadiness(companyReadinessScore, score.overallScore) ?? score.overallScore;

  const snapshot = await upsertContactReadinessSnapshot(supabase, {
    userId: input.userId,
    contactId: input.contactId,
    fitScore: contactFitRow?.contact_fit_score ?? null,
    companyFitScore,
    priorityReadiness: effReadiness,
    score,
  });

  // Mirror readiness_score (always) + priority_score (when fit is known) onto
  // contacts so /api/contacts can read/ORDER BY without joining the snapshot.
  // readiness_score is the canonical signal score (formerly "intent"),
  // = snapshot overall_score (CONTACT-level). priority_score folds in company
  // momentum via effReadiness. Best-effort: a mirror failure doesn't fail the
  // recompute (the snapshot is authoritative).
  const mirroredPriority = computeMirroredPriority(
    contactFitRow?.contact_fit_score ?? null,
    effReadiness,
    companyFitScore,
  );
  const contactMirror: Record<string, number | null> = {
    readiness_score: score.overallScore,
  };
  if (mirroredPriority !== undefined) contactMirror.priority_score = mirroredPriority;
  {
    const { error: mirrorErr } = await supabase
      .from('contacts')
      .update(contactMirror)
      .eq('id', input.contactId)
      .eq('user_id', input.userId);
    if (mirrorErr) {
      console.warn('Contact readiness/priority mirror write failed:', mirrorErr.message);
    }
  }

  return {
    contactId: input.contactId,
    readinessSnapshotId: snapshot.id,
    overallScore: score.overallScore,
    overallLabel: score.overallLabel,
  };
}

/** Returns null when fit is missing, undefined when neither input is usable. */
function computeMirroredPriority(
  fitScore: number | null | undefined,
  readinessScore: number | null | undefined,
  secondFitScore?: number | null | undefined,
): number | null | undefined {
  if (typeof fitScore !== 'number' || !Number.isFinite(fitScore)) {
    return readinessScore == null ? undefined : null;
  }
  return computeIntrinsicPriority({
    companyFit: secondFitScore ?? 1,
    contactFit: fitScore,
    readiness: readinessScore,
  });
}

export async function generateAccountReason(
  supabase: DatabaseClient,
  input: GenerateAccountReasonInput
): Promise<GenerateAccountReasonResult> {
  const [signals, fitSnapshot, readinessSnapshot] = await Promise.all([
    listNormalizedSignalsForCompany(supabase, input.userId, input.companyId),
    getCompanyFitSnapshot(supabase, input.userId, input.companyId),
    getLatestReadinessSnapshot(supabase, input.userId, input.companyId),
  ]);

  const score = scoreAccountReadiness(signals, {
    targetBuyerFunctions: input.targetBuyerFunctions,
  });

  const reason = buildAccountReason({
    score,
    companyName: fitSnapshot?.companyName,
    affectedFunctions: [...new Set(signals.flatMap((signal) => signal.buyerFunctions))].slice(0, 5),
  });

  const snapshotId = readinessSnapshot?.id
    ? readinessSnapshot.id
    : (
        await upsertAccountReadinessSnapshot(supabase, {
          userId: input.userId,
          companyId: input.companyId,
          fitScore: fitSnapshot?.fitScore ?? null,
          fitLabel: fitSnapshot?.fitLabel ?? null,
          score,
        })
      ).id;

  const result = await upsertAccountReasonSnapshot(supabase, {
    userId: input.userId,
    companyId: input.companyId,
    readinessSnapshotId: snapshotId,
    reason,
  });

  return {
    companyId: input.companyId,
    reasonSnapshotId: result.id,
  };
}

export async function buildPersistedAccountReadinessContext(
  supabase: DatabaseClient,
  input: BuildAccountReadinessContextInput
): Promise<AccountReadinessContext> {
  const [signals, fitSnapshot, readinessSnapshot, reasonSnapshot] = await Promise.all([
    listNormalizedSignalsForCompany(supabase, input.userId, input.companyId),
    getCompanyFitSnapshot(supabase, input.userId, input.companyId),
    getLatestReadinessSnapshot(supabase, input.userId, input.companyId),
    getLatestReasonSnapshot(supabase, input.userId, input.companyId),
  ]);

  const score = scoreAccountReadiness(signals, {
    targetBuyerFunctions: input.targetBuyerFunctions,
  });

  const topSignals = await getSignalEvidenceByIds(
    supabase,
    input.userId,
    readinessSnapshot?.top_signal_ids ?? score.topSignalIds
  );

  const context = buildAccountReadinessContext({
    accountId: input.companyId,
    companyName: fitSnapshot?.companyName ?? 'Unknown company',
    fitScore: fitSnapshot?.fitScore ?? 0,
    fitLabel: fitSnapshot?.fitLabel,
    signals,
    topSignalEvidence: topSignals,
    affectedFunctions:
      reasonSnapshot?.affected_functions ??
      [...new Set(signals.flatMap((signal) => signal.buyerFunctions))].slice(0, 5),
    recommendedContacts: input.recommendedContacts,
    targetBuyerFunctions: input.targetBuyerFunctions,
    limitTopSignals: input.limitTopSignals,
    precomputedScore: score,
  });

  if (!reasonSnapshot) {
    return context;
  }

  return {
    ...context,
    reason: {
      summaryShort: reasonSnapshot.summary_short,
      summaryLong: reasonSnapshot.summary_long,
      whyNow: reasonSnapshot.why_now,
      affectedFunctions: reasonSnapshot.affected_functions,
      suggestedAngle: reasonSnapshot.suggested_angle,
    },
  };
}
