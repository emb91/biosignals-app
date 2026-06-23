/**
 * Contact fit scoring — LLM-based.
 *
 * Uses Claude Haiku to reason about how well a contact matches a buyer persona.
 * Supports batching: up to BATCH_SIZE contacts are scored in a single API call
 * to keep latency and cost low.
 *
 * Returns a score 0–100 alongside Claude's reasoning, which fields matched,
 * and any gaps identified.
 */

import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const BATCH_SIZE = 10; // contacts scored per API call

// ─── Types ────────────────────────────────────────────────────────────────────

export type PersonaRow = {
  id?: string;
  name?: string | null;
  job_titles?: string[] | null;
  seniority_levels?: string[] | null;
  functions?: string[] | null; // stored as JSON strings: '{"name":"BD","weight":1.0}'
};

export type ContactLike = {
  full_name?: string | null;
  job_title?: string | null;
  job_title_standardised?: string | null;
  headline?: string | null;        // LinkedIn headline — extra context for scoring
  seniority_level?: string | null;
  business_area?: string | null;
  company_name?: string | null;
};

export type FitScoreResult = {
  score: number;           // 0–100
  score_normalised: number; // 0–1 for DB storage
  reasoning: string;
  matched_on: string[];
  gaps: string;
  persona_id: string | null;
  persona_name: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse persona.functions which stores JSON strings like '{"name":"BD","weight":1.0}' */
const parseFunctionNames = (functions: string[] | null | undefined): string[] => {
  if (!functions) return [];
  return functions.map((f) => {
    try {
      const parsed = JSON.parse(f);
      return typeof parsed?.name === 'string' ? parsed.name : f;
    } catch {
      return typeof f === 'string' ? f : '';
    }
  }).filter(Boolean);
};

const formatPersonaForPrompt = (persona: PersonaRow): string => {
  const functions = parseFunctionNames(persona.functions);
  return [
    `Persona id: ${persona.id || 'unknown'}`,
    `Persona name: ${persona.name || 'Unnamed'}`,
    `Target business areas / teams: ${functions.length ? functions.join(', ') : 'Not specified'}`,
    `Target seniority levels: ${persona.seniority_levels?.length ? persona.seniority_levels.join(', ') : 'Not specified'}`,
    `Target job title keywords: ${persona.job_titles?.length ? persona.job_titles.join(', ') : 'Not specified'}`,
  ].join('\n');
};

const formatContactForPrompt = (contact: ContactLike, index: number): string => {
  const lines = [
    `Contact ${index + 1}:`,
    `  Name: ${contact.full_name || 'Unknown'}`,
    `  Job title: ${contact.job_title_standardised || contact.job_title || 'Unknown'}`,
  ];
  if (contact.headline) lines.push(`  LinkedIn headline: ${contact.headline}`);
  lines.push(
    `  Seniority: ${contact.seniority_level || 'Unknown'}`,
    `  Business area / department: ${contact.business_area || 'Unknown'}`,
    `  Company: ${contact.company_name || 'Unknown'}`,
  );
  return lines.join('\n');
};

// ─── Core scoring ─────────────────────────────────────────────────────────────

/**
 * Score a batch of contacts against the best-matching persona.
 * Returns one FitScoreResult per contact.
 */
async function scoreBatch(
  contacts: ContactLike[],
  personas: PersonaRow[]
): Promise<FitScoreResult[]> {
  const personaBlock = personas.map(formatPersonaForPrompt).join('\n\n---\n\n');
  const contactBlock = contacts.map((c, i) => formatContactForPrompt(c, i)).join('\n\n');

  const prompt = `You are scoring B2B sales leads for a life sciences company.
Your job is to thoughtfully assess how well each contact matches the buyer persona(s) below.

Life sciences titles vary widely. Reason through equivalences:
- "Chief Scientific Officer", "Head of Scientific Affairs", "VP of R&D" are all C-suite science leadership
- "VP External Partnerships", "Head of Alliance Management", "Director of Business Development", and "Director of Public Private Partnerships" all indicate partnerships / BD authority
- "Translational Sciences Lead" may be the right contact at a clinical-stage biotech even without a BD title
- "Commercial Supply Chain" should not automatically be treated as CMC/manufacturing. It can match Manufacturing & CMC only when the role implies product supply, technical operations, manufacturing operations, process development, or CMC ownership.
- Seniority signals budget influence — a Director at a 20-person biotech may carry VP-equivalent authority
- Use the job title and headline as primary evidence. The normalized business_area is helpful but may be wrong; override it when the title clearly maps to a different life-sciences function.

BUYER PERSONA(S):
${personaBlock}

CONTACTS TO SCORE:
${contactBlock}

For each contact, determine which persona they best match (if multiple personas exist), then score their fit against it.

Return ONLY a valid JSON array with exactly ${contacts.length} objects, one per contact, in order:
[
  {
    "contact_index": 0,
    "score": <integer 0-100>,
    "reasoning": "<2-3 sentences explaining the score thoughtfully>",
    "matched_on": [<array of strings: which of "seniority", "function", "title" matched>],
    "gaps": "<what is missing, uncertain, or mismatched — empty string if strong match>",
    "best_persona_id": "<persona id from the prompt>",
    "best_persona_name": "<name of the persona this contact best matches>"
  }
]`;

  const completion = await completeLlm({
    feature: 'intent_scoring',
    prompt,
    maxTokens: 2048,
  });
  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'contact_fit_scoring',
    route: 'lib/scoring#scoreBatch',
    model: completion.model,
    usage: completion.usage,
    metadata: {
      batch_size: contacts.length,
      persona_count: personas.length,
    },
  });

  const text = completion.text;

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Could not parse scoring response: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]) as Array<{
    contact_index: number;
    score: number;
    reasoning: string;
    matched_on: string[];
    gaps: string;
    best_persona_id?: string | null;
    best_persona_name: string;
  }>;

  return parsed.map((item) => {
    const matchedPersona =
      personas.find((p) => p.id && p.id === item.best_persona_id) ??
      personas.find((p) => p.name === item.best_persona_name) ??
      personas[0];
    const score = Math.max(0, Math.min(100, Math.round(item.score)));
    return {
      score,
      score_normalised: score / 100,
      reasoning: item.reasoning || '',
      matched_on: item.matched_on || [],
      gaps: item.gaps || '',
      persona_id: matchedPersona?.id ?? null,
      persona_name: matchedPersona?.name ?? null,
    };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Score a single contact against all personas.
 * Returns the best fit result across all personas.
 */
export async function scoreContact(
  contact: ContactLike,
  personas: PersonaRow[]
): Promise<FitScoreResult> {
  if (!personas || personas.length === 0) {
    return {
      score: 0,
      score_normalised: 0,
      reasoning: 'No persona profiles defined.',
      matched_on: [],
      gaps: 'No personas to score against.',
      persona_id: null,
      persona_name: null,
    };
  }

  const results = await scoreBatch([contact], personas);
  return results[0];
}

/**
 * Score multiple contacts against all personas in batches.
 * Returns one FitScoreResult per contact, in the same order.
 */
export async function scoreContacts(
  contacts: ContactLike[],
  personas: PersonaRow[]
): Promise<FitScoreResult[]> {
  if (!personas || personas.length === 0) {
    return contacts.map(() => ({
      score: 0,
      score_normalised: 0,
      reasoning: 'No persona profiles defined.',
      matched_on: [],
      gaps: 'No personas to score against.',
      persona_id: null,
      persona_name: null,
    }));
  }

  const results: FitScoreResult[] = [];

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const batchResults = await scoreBatch(batch, personas);
    results.push(...batchResults);
  }

  return results;
}
