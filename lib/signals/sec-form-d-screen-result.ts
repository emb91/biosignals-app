export type SecFormDScreenDecision = 'accept' | 'reject' | 'uncertain';

export type SecFormDScreenResult = {
  decision: SecFormDScreenDecision;
  same_entity: 'yes' | 'no' | 'uncertain';
  operating_company_financing: 'yes' | 'no' | 'uncertain';
  reason: string;
};

function coerceString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function coerceTernary(value: unknown): 'yes' | 'no' | 'uncertain' {
  const text = coerceString(value, 30).toLowerCase();
  return text === 'yes' || text === 'no' || text === 'uncertain' ? text : 'uncertain';
}

function coerceDecision(value: unknown): SecFormDScreenDecision {
  const text = coerceString(value, 30).toLowerCase();
  return text === 'accept' || text === 'reject' || text === 'uncertain' ? text : 'uncertain';
}

export function normalizeFormDScreenResult(raw: unknown): SecFormDScreenResult {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const sameEntity = coerceTernary(obj.same_entity);
  const operatingCompanyFinancing = coerceTernary(obj.operating_company_financing);
  const rawDecision = coerceDecision(obj.decision);
  const decision =
    rawDecision === 'accept' && sameEntity === 'yes' && operatingCompanyFinancing === 'yes'
      ? 'accept'
      : rawDecision === 'reject' || sameEntity === 'no' || operatingCompanyFinancing === 'no'
        ? 'reject'
        : 'uncertain';

  return {
    decision,
    same_entity: sameEntity,
    operating_company_financing: operatingCompanyFinancing,
    reason: coerceString(obj.reason, 600) || 'No screening reason provided.',
  };
}
