import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAccountReadinessContext } from '@/lib/signals/readiness-context';
import { normalizeReadinessEvent } from '@/lib/signals/readiness-normalize';
import { buildAccountReason } from '@/lib/signals/readiness-reason';
import { scoreAccountReadiness } from '@/lib/signals/readiness-score';
import { effectiveReadiness } from '@/lib/lead-action';
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
  /**
   * Cascade to this company's contacts when its readiness changes. Contact
   * priority folds in company readiness (effectiveReadiness), so a company whose
   * readiness moves must re-rank its contacts. Default true. Bulk recompute-all
   * paths that loop contacts themselves pass false to avoid double work.
   */
  cascadeContacts?: boolean;
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

  // Capture the previous company readiness BEFORE the mirror write, so the
  // cascade below only fires when readiness actually moved (keeps routine
  // monitor sweeps that find nothing new from re-scoring every contact).
  const cascadeContacts = input.cascadeContacts !== false;
  let previousReadiness: number | null = null;
  if (cascadeContacts) {
    const { data: prev } = await supabase
      .from('user_companies')
      .select('readiness_score')
      .eq('company_id', input.companyId)
      .eq('user_id', input.userId)
      .maybeSingle();
    previousReadiness = (prev as { readiness_score?: number | null } | null)?.readiness_score ?? null;
  }

  const snapshot = await upsertAccountReadinessSnapshot(supabase, {
    userId: input.userId,
    companyId: input.companyId,
    fitScore: fitSnapshot?.fitScore ?? null,
    fitLabel: fitSnapshot?.fitLabel ?? null,
    score,
  });

  await replaceReadinessSnapshotEvidence(supabase, snapshot.id, score.contributions);

  // Mirror readiness_score onto user_companies so accounts_view (which exposes
  // uc.readiness_score) stays accurate without joining the snapshot.
  // readiness_score is the canonical signal score (formerly "intent"),
  // = snapshot overall_score. NOTE: user_companies.priority_score is a STORED
  // GENERATED column (company_fit_score × (0.5 + 0.5 × readiness_score)) — do
  // NOT write it here; Postgres recomputes it automatically when readiness_score
  // changes. (Writing it errors: "can only be updated to DEFAULT".)
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

  // Cascade: contact priority = fit × (0.5 + 0.5 × effectiveReadiness(company,
  // contact)). When this company's readiness changes, its contacts' priorities
  // are stale until they recompute, so refresh them here. Only when it actually
  // moved, and only when the caller didn't opt out (bulk recompute-all loops
  // contacts itself). recomputeContactReadiness does NOT call back into account
  // readiness, so there's no recursion.
  if (cascadeContacts) {
    const moved =
      previousReadiness == null || Math.abs(previousReadiness - score.overallScore) > 0.001;
    if (moved) {
      const { data: contactRows } = await supabase
        .from('contacts')
        .select('id')
        .eq('user_id', input.userId)
        .eq('company_id', input.companyId)
        .is('archived_at', null);
      for (const row of (contactRows ?? []) as Array<{ id: string }>) {
        try {
          await recomputeContactReadiness(supabase, {
            userId: input.userId,
            contactId: row.id,
            targetBuyerFunctions: input.targetBuyerFunctions,
          });
        } catch (cascadeErr) {
          console.warn(
            'Contact priority cascade failed for',
            row.id,
            cascadeErr instanceof Error ? cascadeErr.message : cascadeErr,
          );
        }
      }
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
    // Pull contact fit + company so the snapshot can store priority. Best-effort:
    // a missing row leaves priority null and the snapshot still writes.
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

  const score = scoreAccountReadiness(signals, {
    targetBuyerFunctions: input.targetBuyerFunctions,
  });

  // Contact-LEVEL signals are rare, so a contact's own readiness is usually ~0.
  // Fold in the COMPANY's readiness so a well-fit contact at an active account
  // isn't stranded at floor priority just because we haven't captured a personal
  // signal. effectiveReadiness = max(company, contact) + small bump if both —
  // the same logic the outreach action gate uses, so priority and action agree.
  // NOTE: readiness_score itself stays the contact's OWN signal score below; only
  // PRIORITY uses the effective value. (The action gate re-derives effective from
  // company + contact readiness, so storing effective in readiness_score would
  // double-count company momentum.)
  let companyReadiness: number | null = null;
  if (contactFitRow?.company_id) {
    const { data: uc } = await supabase
      .from('user_companies')
      .select('readiness_score')
      .eq('user_id', input.userId)
      .eq('company_id', contactFitRow.company_id)
      .maybeSingle();
    companyReadiness = (uc as { readiness_score?: number | null } | null)?.readiness_score ?? null;
  }
  const effectiveContactReadiness = effectiveReadiness(companyReadiness, score.overallScore);

  const snapshot = await upsertContactReadinessSnapshot(supabase, {
    userId: input.userId,
    contactId: input.contactId,
    fitScore: contactFitRow?.contact_fit_score ?? null,
    score,
  });

  // Mirror readiness_score (always) + priority_score (when fit is known) onto
  // contacts so /api/leads can read/ORDER BY without joining the snapshot.
  // readiness_score is the canonical signal score (formerly "intent"),
  // = snapshot overall_score. Best-effort: a mirror failure doesn't fail the
  // recompute (the snapshot is authoritative).
  const mirroredPriority = computeMirroredPriority(
    contactFitRow?.contact_fit_score ?? null,
    effectiveContactReadiness ?? score.overallScore,
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
    },
  };
}

