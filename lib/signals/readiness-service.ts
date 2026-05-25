import type { SupabaseClient } from '@supabase/supabase-js';
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
    // Pull contact fit so the snapshot can store priority = fit × (0.5 + 0.5 × readiness).
    // Best-effort: a missing row leaves priority null and the snapshot still writes.
    supabase
      .from('contacts')
      .select('contact_fit_score')
      .eq('id', input.contactId)
      .eq('user_id', input.userId)
      .maybeSingle()
      .then((res) => (res.error ? null : (res.data as { contact_fit_score: number | null } | null))),
  ]);

  const score = scoreAccountReadiness(signals, {
    targetBuyerFunctions: input.targetBuyerFunctions,
  });

  const snapshot = await upsertContactReadinessSnapshot(supabase, {
    userId: input.userId,
    contactId: input.contactId,
    fitScore: contactFitRow?.contact_fit_score ?? null,
    score,
  });

  // Mirror priority_score onto contacts so /api/leads can ORDER BY it without
  // joining the snapshot table. Best-effort: ignored if the column is missing
  // (older deploys) so a partial migration state doesn't break recompute.
  const mirroredPriority = computeMirroredPriority(
    contactFitRow?.contact_fit_score ?? null,
    score.overallScore,
  );
  if (mirroredPriority !== undefined) {
    const { error: mirrorErr } = await supabase
      .from('contacts')
      .update({ priority_score: mirroredPriority })
      .eq('id', input.contactId)
      .eq('user_id', input.userId);
    if (mirrorErr) {
      // Don't fail the readiness recompute for the mirror write — the snapshot
      // is authoritative. Just log.
      console.warn('Contact priority_score mirror write failed:', mirrorErr.message);
    }
  }

  return {
    contactId: input.contactId,
    readinessSnapshotId: snapshot.id,
    overallScore: score.overallScore,
    overallLabel: score.overallLabel,
  };
}

/** Mirror of computePriorityScore in readiness-store. Kept local to avoid a
 *  cross-module export for a 3-line helper. Returns null when fit is missing,
 *  undefined when neither input is usable (skip the mirror write). */
function computeMirroredPriority(
  fitScore: number | null | undefined,
  readinessScore: number | null | undefined,
): number | null | undefined {
  if (typeof fitScore !== 'number' || !Number.isFinite(fitScore)) {
    return readinessScore == null ? undefined : null;
  }
  if (typeof readinessScore !== 'number' || !Number.isFinite(readinessScore)) return null;
  const raw = fitScore * (0.5 + 0.5 * readinessScore);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(1, raw));
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
      confidenceLabel: reasonSnapshot.confidence_label,
    },
  };
}

