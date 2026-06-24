import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

export type TriageGroup = 'high' | 'medium' | 'low';

export type TriageInput = {
  id: string;
  job_title?: string | null;
  company_name?: string | null;
  email?: string | null;
};

/**
 * Coarse, pre-enrichment description of who the team wants to reach. Triage only
 * sees a contact's title + company name + email domain, so this is what lets the
 * classifier judge "does this look like our ICP?" instead of a generic
 * "is this vaguely biotech?". Built from the org's ICP(s) + buyer persona(s) in
 * lib/import-queue.ts; all fields optional so a sparse ICP still helps a little.
 */
export type TriageIcpContext = {
  summary?: string | null;
  companyTypes?: string[];
  therapeuticAreas?: string[];
  modalities?: string[];
  developmentStages?: string[];
  /** For platform/vendor ICPs: the kinds of customers our targets sell to. */
  targetCustomers?: string[];
  buyerTypes?: string[];
  exampleCompanies?: string[];
  /** Buyer persona signal — ideal job functions / titles / seniority. */
  buyerRoles?: string[];
};

export const TRIAGE_VERSION = 'triage_v2';
const TRIAGE_ICP_VERSION = 'triage_icp_v1';

const GENERIC_SYSTEM_PROMPT = `You are classifying biotech/pharma contacts for a CRO sales tool.

Classify each contact as:
- "high": decision-maker at a biotech/pharma/CDMO/CRO company in a relevant role (CMC, manufacturing, clinical operations, regulatory affairs, R&D leadership, business development, procurement)
- "medium": possibly relevant — ambiguous role or company, or a relevant role at an adjacent life-sciences company
- "low": not relevant — clearly outside life sciences (tech, finance, consumer goods, retail, etc.) or a very junior/irrelevant role

When uncertain, prefer "medium" over "low". Only classify as "low" when clearly irrelevant.`;

function formatIcpBlock(icp: TriageIcpContext): string | null {
  const lines: string[] = [];
  const add = (label: string, value?: string[] | null) => {
    const items = (value ?? []).map((v) => v?.trim()).filter(Boolean);
    if (items.length) lines.push(`- ${label}: ${items.join(', ')}`);
  };
  if (icp.summary?.trim()) lines.push(`- Summary: ${icp.summary.trim()}`);
  add('Target company types', icp.companyTypes);
  add('Therapeutic areas', icp.therapeuticAreas);
  add('Modalities / platforms', icp.modalities);
  add('Development stages', icp.developmentStages);
  add('Customers our targets sell to', icp.targetCustomers);
  add('Buyer types', icp.buyerTypes);
  add('Ideal buyer roles', icp.buyerRoles);
  add('Example good-fit companies', icp.exampleCompanies);
  return lines.length ? lines.join('\n') : null;
}

function icpSystemPrompt(icpBlock: string): string {
  return `You are triaging inbound sales leads BEFORE any data enrichment. For each lead you ONLY see its job title, company name, and email domain — use your own knowledge of what these companies actually do to judge fit. Make a fast, coarse call on how well each lead matches the team's Ideal Customer Profile (ICP).

THE TEAM'S ICP:
${icpBlock}

Company fit is the PRIMARY signal. Classify each lead:
- "high": the company clearly fits the ICP (right sector / company type / focus). A senior or decision-making contact strengthens this, but a perfect-fit company is still "high" even if the exact title is not one of the listed buyer roles.
- "medium": the company is a partial, adjacent, or uncertain match (you cannot tell from the name), OR it fits the ICP but the contact's role looks junior or unrelated.
- "low": the company clearly does NOT fit the ICP — wrong sector or company type (e.g. a medical-device company for a drug-developer ICP, or a competitor/vendor that sells what we sell rather than buys it) — or the contact's role is clearly irrelevant.

Judge the COMPANY against the ICP first; the role only nudges between high and medium, or marks "low" when clearly irrelevant. You cannot know a company precisely from its name, so when it plausibly fits the ICP lean "high"; when it is clearly outside the ICP use "low"; only when genuinely unsure use "medium".`;
}

/**
 * Batch-triage contacts before Apollo/Apify enrichment.
 *
 * When an ICP context is supplied, the classifier scores each row AGAINST that
 * ICP (a pharma company ranks high for a pharma ICP, a medtech device shop ranks
 * low) — triage is meant to be ICP-aware, not a generic biotech filter. With no
 * ICP it falls back to the generic life-sciences relevance prompt.
 *
 * Returns a map of input id → triage result. Fails closed (defaults to "low")
 * so an LLM outage never silently proceeds into enrichment.
 */
export async function triageContacts(
  contacts: TriageInput[],
  options?: { icp?: TriageIcpContext | null },
): Promise<Map<string, { group: TriageGroup; version: string }>> {
  if (contacts.length === 0) return new Map();

  const icpBlock = options?.icp ? formatIcpBlock(options.icp) : null;
  const systemPrompt = icpBlock ? icpSystemPrompt(icpBlock) : GENERIC_SYSTEM_PROMPT;
  const version = icpBlock ? TRIAGE_ICP_VERSION : TRIAGE_VERSION;

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
        system: systemPrompt,
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
          icp_aware: Boolean(icpBlock),
        },
      });

      // Models sometimes wrap the array in a ```json code fence or add prose,
      // especially with a richer system prompt — extract the first JSON array so
      // a well-formed answer isn't discarded into the fail-closed "low" default.
      const text = completion.text.trim();
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      const parsed = JSON.parse(arrayMatch ? arrayMatch[0] : text) as unknown[];

      batch.forEach((c, idx) => {
        const raw = parsed[idx];
        const group: TriageGroup =
          raw === 'high' ? 'high' : raw === 'medium' ? 'medium' : 'low';
        results.set(c.id, { group, version });
      });
    } catch (err) {
      console.error('[triage] batch failed, defaulting to low:', err);
      batch.forEach((c) => results.set(c.id, { group: 'low', version }));
    }
  }

  return results;
}
