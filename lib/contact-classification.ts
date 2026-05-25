import { BUSINESS_AREA_OPTIONS, SENIORITY_LEVEL_OPTIONS } from '@/lib/arcova-taxonomy';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const BATCH_SIZE = 10;

export type ClassificationInput = {
  full_name?: string | null;
  job_title?: string | null;
  headline?: string | null;
  company_name?: string | null;
  previous_titles?: string[] | null; // senior titles from employment history for seniority context
};

export type ClassificationResult = {
  job_title_standardised: string | null;
  seniority_level: string | null;
  business_area: string | null;
};

type UsageContext = {
  userId?: string | null;
  userEmail?: string | null;
};

async function classifyBatch(
  inputs: ClassificationInput[],
  usageContext?: UsageContext,
): Promise<ClassificationResult[]> {
  const prompt = `You classify contacts at life sciences and biopharma companies.

Return ONLY valid JSON as an array with exactly ${inputs.length} objects in order.

For each contact:
- standardize the job title into clean, full words (e.g. "VP, BD APAC" → "VP Business Development APAC")
- choose seniority_level as exactly one of: ${SENIORITY_LEVEL_OPTIONS.join(', ')} — seniority should almost always map to one of these; use null only if completely impossible to determine
  - use previous roles as seniority context but exercise judgement: a career VP who is now a "Sr. Specialist" could have taken a step down (e.g. after a layoff) or could be in a senior individual contributor role at a large company — consider both possibilities and pick the most likely level given the trajectory
  - do not blindly inherit the prior title's level, but do not ignore it either — a step from VP/Senior Director to a "Sr." specialist role most likely lands at Director or Head of / Senior Manager, not Manager or Individual Contributor
- choose business_area as the best matching option from: ${BUSINESS_AREA_OPTIONS.join(', ')} — if the team/function does not clearly map to any of these, use null rather than forcing a poor fit
- use headline as extra context when title is ambiguous

Contacts:
${inputs
  .map(
    (input, index) => {
      const lines = [
        `Contact ${index + 1}`,
        `Name: ${input.full_name || 'Unknown'}`,
        `Job title: ${input.job_title || 'Unknown'}`,
        `Headline: ${input.headline || 'Unknown'}`,
        `Company: ${input.company_name || 'Unknown'}`,
      ];
      if (input.previous_titles?.length) {
        lines.push(`Previous roles: ${input.previous_titles.join(', ')}`);
      }
      return lines.join('\n');
    }
  )
  .join('\n\n')}

JSON shape:
[
  {
    "job_title_standardised": "Chief Scientific Officer",
    "seniority_level": "C-Level",
    "business_area": "Research & Development"
  }
]`;

  const completion = await completeLlm({
    feature: 'contact_classification',
    prompt,
    maxTokens: 1600,
  });

  await recordLlmUsageEvent({
    userId: usageContext?.userId ?? null,
    userEmail: usageContext?.userEmail ?? null,
    provider: completion.provider,
    feature: 'contact_classification',
    route: 'lib/contact-classification#classifyBatch',
    model: completion.model,
    usage: completion.usage,
  });

  const text = completion.text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not parse classification response: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult[];
  return parsed.map((item) => ({
    job_title_standardised: item.job_title_standardised || null,
    seniority_level: SENIORITY_LEVEL_OPTIONS.includes(item.seniority_level as never)
      ? item.seniority_level
      : null,
    business_area: BUSINESS_AREA_OPTIONS.includes(item.business_area as never)
      ? item.business_area
      : null,
  }));
}

export async function classifyContacts(
  inputs: ClassificationInput[],
  usageContext?: UsageContext,
): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  for (let index = 0; index < inputs.length; index += BATCH_SIZE) {
    const batch = inputs.slice(index, index + BATCH_SIZE);
    const batchResults = await classifyBatch(batch, usageContext);
    results.push(...batchResults);
  }
  return results;
}
