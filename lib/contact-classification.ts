import Anthropic from '@anthropic-ai/sdk';
import { BUSINESS_AREA_OPTIONS, SENIORITY_LEVEL_OPTIONS } from '@/lib/arcova-taxonomy';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 10;

export type ClassificationInput = {
  full_name?: string | null;
  job_title?: string | null;
  headline?: string | null;
  company_name?: string | null;
};

export type ClassificationResult = {
  job_title_standardised: string | null;
  seniority_level: string | null;
  business_area: string | null;
};

async function classifyBatch(inputs: ClassificationInput[]): Promise<ClassificationResult[]> {
  const prompt = `You classify contacts at life sciences and biopharma companies.

Return ONLY valid JSON as an array with exactly ${inputs.length} objects in order.

For each contact:
- standardize the job title into clean, full words
- choose seniority_level as exactly one of: ${SENIORITY_LEVEL_OPTIONS.join(', ')}
- choose business_area as exactly one of: ${BUSINESS_AREA_OPTIONS.join(', ')}
- use headline as extra context when title is ambiguous
- if you are unsure, still choose the best matching taxonomy option

Contacts:
${inputs
  .map(
    (input, index) => `Contact ${index + 1}
Name: ${input.full_name || 'Unknown'}
Job title: ${input.job_title || 'Unknown'}
Headline: ${input.headline || 'Unknown'}
Company: ${input.company_name || 'Unknown'}`
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

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
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

export async function classifyContacts(inputs: ClassificationInput[]): Promise<ClassificationResult[]> {
  const results: ClassificationResult[] = [];
  for (let index = 0; index < inputs.length; index += BATCH_SIZE) {
    const batch = inputs.slice(index, index + BATCH_SIZE);
    const batchResults = await classifyBatch(batch);
    results.push(...batchResults);
  }
  return results;
}
