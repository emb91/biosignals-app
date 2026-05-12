import { READINESS_SIGNAL_CATALOG_BY_KEY } from '@/lib/signals/readiness-catalog';
import type {
  BuyerFunction,
  NormalizedSignal,
  RawSignalEvent,
  SignalKey,
} from '@/lib/signals/readiness-types';

const LEGACY_SIGNAL_KEY_MAP: Partial<Record<string, SignalKey>> = {
  new_funding: 'funding_round',
  ipo: 'ipo_or_follow_on',
  partnership_deal: 'partnership_deal',
  ma: 'ma_event',
  clinical_trial: 'clinical_trial_registered',
  cmc_hire: 'cmc_hiring',
  clinical_ops_hire: 'clinical_ops_hiring',
  bd_hire: 'bd_hiring',
  regulatory_hire: 'regulatory_hiring',
  new_paper_published: 'new_paper_published',
};

const DIRECT_SIGNAL_KEYS = new Set(Object.keys(READINESS_SIGNAL_CATALOG_BY_KEY) as SignalKey[]);

export type NormalizeReadinessEventInput = {
  rawEvent: RawSignalEvent;
  signalKeys?: SignalKey[];
  buyerFunctionsOverride?: BuyerFunction[];
  evidenceExcerpt?: string | null;
};

export function mapSourceEventTypeToSignalKeys(sourceEventType: string): SignalKey[] {
  const trimmed = sourceEventType.trim();
  if (!trimmed) return [];

  if (DIRECT_SIGNAL_KEYS.has(trimmed as SignalKey)) {
    return [trimmed as SignalKey];
  }

  const mapped = LEGACY_SIGNAL_KEY_MAP[trimmed];
  return mapped ? [mapped] : [];
}

function deriveEntityId(event: RawSignalEvent): string {
  return event.entityId;
}

function deriveBuyerFunctions(
  signalKey: SignalKey,
  buyerFunctionsOverride?: BuyerFunction[]
): BuyerFunction[] {
  if (buyerFunctionsOverride?.length) return buyerFunctionsOverride;
  return READINESS_SIGNAL_CATALOG_BY_KEY[signalKey].buyerFunctions;
}

export function normalizeReadinessEvent(
  input: NormalizeReadinessEventInput
): NormalizedSignal[] {
  const signalKeys = input.signalKeys?.length
    ? input.signalKeys
    : mapSourceEventTypeToSignalKeys(input.rawEvent.sourceEventType);

  return signalKeys.map((signalKey, index) => {
    const catalogEntry = READINESS_SIGNAL_CATALOG_BY_KEY[signalKey];

    return {
      id: `${input.rawEvent.id}:${signalKey}:${index}`,
      rawSignalEventId: input.rawEvent.id,
      signalKey,
      scope: catalogEntry.scope,
      entityId: deriveEntityId(input.rawEvent),
      dimensions: [...catalogEntry.dimensions],
      buyerFunctions: deriveBuyerFunctions(signalKey, input.buyerFunctionsOverride),
      intentMechanisms: [...catalogEntry.intentMechanisms],
      defaultStrength: catalogEntry.defaultStrength,
      defaultConfidence: catalogEntry.defaultConfidence,
      eventAt: input.rawEvent.eventAt,
      observedAt: input.rawEvent.observedAt,
      evidenceExcerpt: input.evidenceExcerpt ?? input.rawEvent.excerpt,
    };
  });
}
