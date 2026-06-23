import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

export type TriageGroup = 'high' | 'medium' | 'low';

export type TriageInput = {
  id: string;
  job_title?: string | null;
  company_name?: string | null;
  email?: string | null;
};

export const TRIAGE_VERSION = 'triage_v2';

const SYSTEM_PROMPT = `You are classifying biotech/pharma contacts for a CRO sales tool.

Classify each contact as:
- "high": decision-maker at a biotech/pharma/CDMO/CRO company in a relevant role (CMC, manufacturing, clinical operations, regulatory affairs, R&D leadership, business development, procurement)
- "medium": possibly relevant — ambiguous role or company, or a relevant role at an adjacent life-sciences company
- "low": not relevant — clearly outside life sciences (tech, finance, consumer goods, retail, etc.) or a very junior/irrelevant role

When uncertain, prefer "medium" over "low". Only classify as "low" when clearly irrelevant.`;

/**
 * Batch-triage contacts before Apollo/Apify enrichment.
 * Returns a map of input id → triage result. Fails closed (defaults to "low")
 * so an LLM outage never silently proceeds into enrichment.
 */
export async function triageContacts(
  contacts: TriageInput[],
): Promise<Map<string, { group: TriageGroup; version: string }>> {
  if (contacts.length === 0) return new Map();

  const results = new Map<string, { group: TriageGroup; version: string }>();

  const BATCH_SIZE = 50;
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);

    const lines = batch
      .map(
        (c, idx) =>
          `${idx + 1}. title="${c.job_title ?? ''}" company="${c.company_name ?? ''}" domain="${(c.email ?? '').split('@')[1] ?? ''}"`,
      )
      .join('\n');

    const prompt = `Classify each contact as "high", "medium", or "low".\n\n${lines}\n\nRespond with ONLY a JSON array in the same order, e.g. ["high","medium","low"]. No explanation.`;

    try {
      const completion = await completeLlm({
        feature: 'contact_classification',
        system: SYSTEM_PROMPT,
        prompt,
        maxTokens: 256,
      });

      await recordLlmUsageEvent({
        provider: completion.provider,
        feature: 'import_triage',
        route: 'lib/triage#triageContacts',
        model: completion.model,
        usage: completion.usage,
        metadata: {
          batch_size: batch.length,
        },
      });

      const text = completion.text.trim();
      const parsed = JSON.parse(text) as unknown[];

      batch.forEach((c, idx) => {
        const raw = parsed[idx];
        const group: TriageGroup =
          raw === 'high' ? 'high' : raw === 'medium' ? 'medium' : 'low';
        results.set(c.id, { group, version: TRIAGE_VERSION });
      });
    } catch (err) {
      console.error('[triage] batch failed, defaulting to low:', err);
      batch.forEach((c) => results.set(c.id, { group: 'low', version: TRIAGE_VERSION }));
    }
  }

  return results;
}
