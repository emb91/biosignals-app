import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import {
  normalizeFormDScreenResult,
  type SecFormDScreenResult,
} from './sec-form-d-screen-result';

export type { SecFormDScreenResult } from './sec-form-d-screen-result';

type ScreenInput = {
  trackedCompanyName: string;
  filingEntityName: string | null;
  formType: string;
  filingDate: string | null;
  entityType: string | null;
  industryGroupType: string | null;
  totalOfferingAmount: number | string | null;
  totalAmountSold: number | string | null;
  dateOfFirstSale: string | null;
};

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('sec-form-d-screener: no JSON object found in model output');
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function formatValue(value: number | string | null): string {
  if (value === null || value === undefined || value === '') return 'unknown';
  return String(value);
}

function buildPrompt(input: ScreenInput): string {
  return `You are screening an SEC Form D filing before it becomes a sales signal.

Tracked company in Arcova: "${input.trackedCompanyName}"
SEC filing issuer: "${input.filingEntityName ?? 'unknown'}"
Form type: ${input.formType}
Filing date: ${input.filingDate ?? 'unknown'}
Entity type: ${input.entityType ?? 'unknown'}
Industry group: ${input.industryGroupType ?? 'unknown'}
Total offering amount: ${formatValue(input.totalOfferingAmount)}
Total amount sold: ${formatValue(input.totalAmountSold)}
Date of first sale: ${input.dateOfFirstSale ?? 'unknown'}

Decide whether this filing should become a "funding round" signal for the tracked company.

Return "accept" ONLY when:
- the SEC filing issuer is the same real-world operating company as the tracked company, or an obvious financing subsidiary/SPV of that same operating company; AND
- the filing indicates operating-company financing that would be useful as a buying signal.

Return "reject" when:
- the issuer is a different entity from the tracked company;
- the issuer is a pooled investment fund, hedge fund, private equity fund, venture fund, real estate fund, SPV for an unrelated issuer, adviser, or manager;
- the filing is only cumulative fund sales / assets raised by an investment vehicle;
- the evidence is too weak to safely attach the signal to the tracked company.

Return "uncertain" only when the facts are genuinely ambiguous but not clearly wrong.

Return ONLY JSON:
{
  "decision": "accept" | "reject" | "uncertain",
  "same_entity": "yes" | "no" | "uncertain",
  "operating_company_financing": "yes" | "no" | "uncertain",
  "reason": "<one concise sentence>"
}`;
}

export async function screenFormDFundingSignal(input: ScreenInput): Promise<SecFormDScreenResult> {
  const completion = await completeLlm({
    feature: 'sec_form_d_screener',
    prompt: buildPrompt(input),
    maxTokens: 260,
    temperature: 0,
  });

  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'sec_form_d_screener',
    route: 'lib/signals/sec-form-d-screener#screenFormDFundingSignal',
    model: completion.model,
    usage: completion.usage,
    metadata: {
      tracked_company_name: input.trackedCompanyName.slice(0, 160),
      filing_entity_name: input.filingEntityName?.slice(0, 160) ?? null,
      form_type: input.formType,
      industry_group_type: input.industryGroupType,
    },
  });

  return normalizeFormDScreenResult(parseJsonObject(completion.text));
}
