import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountReason,
  BuyerFunction,
  ConfidenceLabel,
  IntentMechanism,
  NormalizedSignal,
  RawSignalEvent,
  ReadinessDimension,
  ReadinessLabel,
  SignalEvidence,
  SignalScope,
} from '@/lib/signals/readiness-types';
import type { AccountReadinessScoreResult } from '@/lib/signals/readiness-score';

type DatabaseClient = SupabaseClient<any, 'public', any>;

/**
 * Priority = fit × (0.5 + 0.5 × readiness). Hybrid model: fit acts as the
 * floor, readiness boosts on top. Returns null when either input is missing
 * so readers can fall back cleanly. Clamped to [0, 1].
 *
 * Keep this identical to the formula in app/api/accounts/route.ts and
 * app/leads/contacts/page.tsx — it's the single source of truth for the
 * Priority score stored on readiness snapshots.
 */
function computePriorityScore(
  fitScore: number | null | undefined,
  readinessScore: number | null | undefined,
): number | null {
  if (typeof fitScore !== 'number' || !Number.isFinite(fitScore)) return null;
  if (typeof readinessScore !== 'number' || !Number.isFinite(readinessScore)) return null;
  const raw = fitScore * (0.5 + 0.5 * readinessScore);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(1, raw));
}

export type ReadinessSnapshotRecord = {
  id: string;
  user_id: string;
  company_id: string;
  fit_score: number | null;
  fit_label: ReadinessLabel | null;
  overall_score: number;
  overall_label: ReadinessLabel;
  new_budget_score: number;
  new_budget_label: ReadinessLabel;
  new_budget_confidence: ConfidenceLabel;
  new_needs_score: number;
  new_needs_label: ReadinessLabel;
  new_needs_confidence: ConfidenceLabel;
  new_people_score: number;
  new_people_label: ReadinessLabel;
  new_people_confidence: ConfidenceLabel;
  new_strategy_score: number;
  new_strategy_label: ReadinessLabel;
  new_strategy_confidence: ConfidenceLabel;
  caution_score: number;
  caution_label: ReadinessLabel;
  caution_confidence: ConfidenceLabel;
  top_signal_ids: string[];
  freshness_score: number | null;
};

function scalarString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function scalarNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export async function insertSignalSourceEvent(
  supabase: DatabaseClient,
  input: {
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
  }
): Promise<RawSignalEvent> {
  const payload = {
    user_id: input.userId,
    entity_scope: input.entityScope,
    entity_company_id: input.companyId ?? null,
    entity_contact_id: input.entityScope === 'contact' ? input.contactId ?? null : null,
    source: input.source,
    source_event_type: input.sourceEventType,
    source_event_id: input.sourceEventId ?? null,
    source_url: input.sourceUrl ?? null,
    title: input.title ?? null,
    summary: input.summary ?? null,
    excerpt: input.excerpt ?? null,
    event_at: input.eventAt ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await supabase
    .from('signal_source_events')
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    userId: data.user_id,
    entityId:
      input.entityScope === 'company'
        ? scalarString(data.entity_company_id) ?? ''
        : scalarString(data.entity_contact_id) ?? '',
    entityScope: data.entity_scope,
    source: data.source,
    sourceUrl: data.source_url,
    sourceEventType: data.source_event_type,
    sourceEventId: data.source_event_id,
    title: data.title,
    summary: data.summary,
    excerpt: data.excerpt,
    eventAt: data.event_at,
    observedAt: data.observed_at,
    metadata: (data.metadata as Record<string, unknown> | null) ?? {},
  };
}

export async function insertNormalizedSignals(
  supabase: DatabaseClient,
  userId: string,
  rawEvent: RawSignalEvent,
  signals: NormalizedSignal[],
  companyId?: string | null,
  contactId?: string | null
): Promise<NormalizedSignal[]> {
  if (!signals.length) return [];

  const rows = signals.map((signal) => ({
    user_id: userId,
    source_event_id: rawEvent.id,
    signal_key: signal.signalKey,
    signal_scope: signal.scope,
    company_id: signal.scope === 'company' ? companyId ?? signal.entityId : companyId ?? null,
    contact_id: signal.scope === 'contact' ? contactId ?? signal.entityId : null,
    dimensions: signal.dimensions,
    buyer_functions: signal.buyerFunctions,
    intent_mechanisms: signal.intentMechanisms,
    default_strength: signal.defaultStrength,
    default_confidence: signal.defaultConfidence,
    event_at: signal.eventAt,
    observed_at: signal.observedAt,
    evidence_excerpt: signal.evidenceExcerpt,
  }));

  const { data, error } = await supabase
    .from('normalized_signals')
    .insert(rows)
    .select();

  if (error) throw error;

  return (data ?? []).map((row, index) => ({
    ...signals[index],
    id: row.id,
  }));
}

export async function listNormalizedSignalsForCompany(
  supabase: DatabaseClient,
  userId: string,
  companyId: string
): Promise<NormalizedSignal[]> {
  const { data, error } = await supabase
    .from('normalized_signals')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .order('observed_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    rawSignalEventId: row.source_event_id,
    signalKey: row.signal_key,
    scope: row.signal_scope,
    entityId: row.signal_scope === 'company' ? row.company_id : row.contact_id,
    dimensions: stringArray(row.dimensions) as ReadinessDimension[],
    buyerFunctions: stringArray(row.buyer_functions) as BuyerFunction[],
    intentMechanisms: stringArray(row.intent_mechanisms) as IntentMechanism[],
    defaultStrength: row.default_strength,
    defaultConfidence: row.default_confidence,
    eventAt: row.event_at,
    observedAt: row.observed_at,
    evidenceExcerpt: row.evidence_excerpt,
  }));
}

export async function listNormalizedSignalsForContact(
  supabase: DatabaseClient,
  userId: string,
  contactId: string
): Promise<NormalizedSignal[]> {
  const { data, error } = await supabase
    .from('normalized_signals')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('signal_scope', 'contact')
    .order('observed_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    rawSignalEventId: row.source_event_id,
    signalKey: row.signal_key,
    scope: row.signal_scope,
    entityId: row.contact_id,
    dimensions: stringArray(row.dimensions) as ReadinessDimension[],
    buyerFunctions: stringArray(row.buyer_functions) as BuyerFunction[],
    intentMechanisms: stringArray(row.intent_mechanisms) as IntentMechanism[],
    defaultStrength: row.default_strength,
    defaultConfidence: row.default_confidence,
    eventAt: row.event_at,
    observedAt: row.observed_at,
    evidenceExcerpt: row.evidence_excerpt,
  }));
}

export async function upsertContactReadinessSnapshot(
  supabase: DatabaseClient,
  input: {
    userId: string;
    contactId: string;
    fitScore?: number | null;
    score: AccountReadinessScoreResult;
  }
): Promise<{ id: string }> {
  const payload = {
    user_id: input.userId,
    contact_id: input.contactId,
    fit_score: input.fitScore ?? null,
    priority_score: computePriorityScore(input.fitScore ?? null, input.score.overallScore),
    overall_score: input.score.overallScore,
    overall_label: input.score.overallLabel,
    new_budget_score: input.score.dimensions.new_budget.score,
    new_budget_label: input.score.dimensions.new_budget.label,
    new_budget_confidence: input.score.dimensions.new_budget.confidenceLabel,
    new_needs_score: input.score.dimensions.new_needs.score,
    new_needs_label: input.score.dimensions.new_needs.label,
    new_needs_confidence: input.score.dimensions.new_needs.confidenceLabel,
    new_people_score: input.score.dimensions.new_people.score,
    new_people_label: input.score.dimensions.new_people.label,
    new_people_confidence: input.score.dimensions.new_people.confidenceLabel,
    new_strategy_score: input.score.dimensions.new_strategy.score,
    new_strategy_label: input.score.dimensions.new_strategy.label,
    new_strategy_confidence: input.score.dimensions.new_strategy.confidenceLabel,
    caution_score: input.score.dimensions.caution.score,
    caution_label: input.score.dimensions.caution.label,
    caution_confidence: input.score.dimensions.caution.confidenceLabel,
    top_signal_ids: input.score.topSignalIds,
    freshness_score: input.score.freshnessScore,
  };

  const { data, error } = await supabase
    .from('contact_readiness_snapshots')
    .upsert(payload, { onConflict: 'user_id,contact_id' })
    .select('id')
    .single();

  if (error) throw error;
  return data as { id: string };
}

export async function upsertAccountReadinessSnapshot(
  supabase: DatabaseClient,
  input: {
    userId: string;
    companyId: string;
    fitScore?: number | null;
    fitLabel?: ReadinessLabel | null;
    score: AccountReadinessScoreResult;
  }
): Promise<ReadinessSnapshotRecord> {
  const payload = {
    user_id: input.userId,
    company_id: input.companyId,
    fit_score: input.fitScore ?? null,
    fit_label: input.fitLabel ?? null,
    priority_score: computePriorityScore(input.fitScore ?? null, input.score.overallScore),
    overall_score: input.score.overallScore,
    overall_label: input.score.overallLabel,
    new_budget_score: input.score.dimensions.new_budget.score,
    new_budget_label: input.score.dimensions.new_budget.label,
    new_budget_confidence: input.score.dimensions.new_budget.confidenceLabel,
    new_needs_score: input.score.dimensions.new_needs.score,
    new_needs_label: input.score.dimensions.new_needs.label,
    new_needs_confidence: input.score.dimensions.new_needs.confidenceLabel,
    new_people_score: input.score.dimensions.new_people.score,
    new_people_label: input.score.dimensions.new_people.label,
    new_people_confidence: input.score.dimensions.new_people.confidenceLabel,
    new_strategy_score: input.score.dimensions.new_strategy.score,
    new_strategy_label: input.score.dimensions.new_strategy.label,
    new_strategy_confidence: input.score.dimensions.new_strategy.confidenceLabel,
    caution_score: input.score.dimensions.caution.score,
    caution_label: input.score.dimensions.caution.label,
    caution_confidence: input.score.dimensions.caution.confidenceLabel,
    top_signal_ids: input.score.topSignalIds,
    freshness_score: input.score.freshnessScore,
  };

  const { data, error } = await supabase
    .from('account_readiness_snapshots')
    .upsert(payload, { onConflict: 'user_id,company_id' })
    .select()
    .single();

  if (error) throw error;
  return data as ReadinessSnapshotRecord;
}

export async function replaceReadinessSnapshotEvidence(
  supabase: DatabaseClient,
  snapshotId: string,
  contributions: AccountReadinessScoreResult['contributions']
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('readiness_snapshot_evidence')
    .delete()
    .eq('readiness_snapshot_id', snapshotId);

  if (deleteError) throw deleteError;

  if (!contributions.length) return;

  const rows = contributions.map((contribution) => ({
    readiness_snapshot_id: snapshotId,
    normalized_signal_id: contribution.signalId,
    dimension: contribution.dimension,
    contribution: contribution.contribution,
  }));

  const { error: insertError } = await supabase
    .from('readiness_snapshot_evidence')
    .insert(rows);

  if (insertError) throw insertError;
}

export async function upsertAccountReasonSnapshot(
  supabase: DatabaseClient,
  input: {
    userId: string;
    companyId: string;
    readinessSnapshotId: string;
    reason: AccountReason;
  }
): Promise<{ id: string }> {
  const payload = {
    user_id: input.userId,
    company_id: input.companyId,
    readiness_snapshot_id: input.readinessSnapshotId,
    summary_short: input.reason.summaryShort,
    summary_long: input.reason.summaryLong,
    why_now: input.reason.whyNow,
    affected_functions: input.reason.affectedFunctions,
    suggested_angle: input.reason.suggestedAngle,
    confidence_label: input.reason.confidenceLabel,
  };

  const { data, error } = await supabase
    .from('account_reason_snapshots')
    .upsert(payload, { onConflict: 'user_id,company_id' })
    .select('id')
    .single();

  if (error) throw error;
  return { id: data.id };
}

export async function getLatestReadinessSnapshot(
  supabase: DatabaseClient,
  userId: string,
  companyId: string
): Promise<ReadinessSnapshotRecord | null> {
  const { data, error } = await supabase
    .from('account_readiness_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  return (data as ReadinessSnapshotRecord | null) ?? null;
}

export async function getLatestReasonSnapshot(
  supabase: DatabaseClient,
  userId: string,
  companyId: string
): Promise<{
  summary_short: string;
  summary_long: string;
  why_now: string;
  affected_functions: BuyerFunction[];
  suggested_angle: string;
  confidence_label: ConfidenceLabel;
} | null> {
  const { data, error } = await supabase
    .from('account_reason_snapshots')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    summary_short: data.summary_short,
    summary_long: data.summary_long,
    why_now: data.why_now,
    affected_functions: stringArray(data.affected_functions) as BuyerFunction[],
    suggested_angle: data.suggested_angle,
    confidence_label: data.confidence_label,
  };
}

export async function getSignalEvidenceByIds(
  supabase: DatabaseClient,
  userId: string,
  signalIds: string[]
): Promise<SignalEvidence[]> {
  if (!signalIds.length) return [];

  const { data, error } = await supabase
    .from('normalized_signals')
    .select('*')
    .eq('user_id', userId)
    .in('id', signalIds);

  if (error) throw error;

  const order = new Map(signalIds.map((id, index) => [id, index]));

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      signalKey: row.signal_key,
      scope: row.signal_scope,
      source: 'normalized_signal',
      sourceUrl: null,
      eventAt: row.event_at,
      excerpt: row.evidence_excerpt,
      confidenceLabel: row.default_confidence,
    }))
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
}

export async function getCompanyFitSnapshot(
  supabase: DatabaseClient,
  userId: string,
  companyId: string
): Promise<{ companyName: string; fitScore: number; fitLabel: ReadinessLabel } | null> {
  // company_fit_score is the canonical ICP-fit score (the one the UI surfaces);
  // companies.fit_score is a legacy/unused column that's 0 or null for every
  // row and used to silently zero-out priority calculations downstream.
  const { data, error } = await supabase
    .from('companies')
    .select('company_name, company_fit_score')
    .eq('user_id', userId)
    .eq('id', companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const fitScore = scalarNumber(data.company_fit_score) ?? 0;
  const fitLabel: ReadinessLabel = fitScore >= 0.7 ? 'high' : fitScore >= 0.35 ? 'medium' : 'low';

  return {
    companyName: scalarString(data.company_name) ?? 'Unknown company',
    fitScore,
    fitLabel,
  };
}
