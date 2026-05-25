/**
 * Haiku classifier for biotech / pharma press releases.
 *
 * Returns a structured object with category, rationale, candidate companies
 * mentioned, and category-specific facts. Designed to route a single press
 * release into the appropriate readiness signal (conference_presentation,
 * licensing_deal, leadership_churn, layoffs, etc.) — or "other" / "off_topic"
 * when nothing actionable applies.
 *
 * Cost shape: Haiku 4.5, ~2-4K input tokens (title + summary, full body if
 * available), ~400 output tokens. ~$0.001-0.003 per call. Cached forever in
 * press_release_articles.classification jsonb — never re-classified.
 */
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const MAX_INPUT_CHARS = 12_000;

export type PressReleaseCategory =
  | 'conference_presentation'
  | 'licensing_deal'
  | 'partnership_with_upfront_economics'
  | 'co_development_deal'
  | 'partnership_deal'
  | 'milestone_payment'
  | 'leadership_churn'
  | 'layoffs'
  | 'new_facility'
  | 'facility_expansion'
  | 'restructuring'
  | 'm_and_a_buyer'        // they're acquiring someone (acquisition_distraction signal)
  | 'm_and_a_target'       // they're being acquired (caution signal)
  | 'commercialization_move'
  | 'fda_approval'
  | 'phase_transition'
  | 'funding_round'
  | 'grant_award'
  | 'ipo_or_follow_on'
  | 'trial_failure_or_halt'
  | 'program_discontinuation'
  | 'other';                // nothing actionable — don't emit

const ALLOWED_CATEGORIES: ReadonlySet<PressReleaseCategory> = new Set<PressReleaseCategory>([
  'conference_presentation',
  'licensing_deal',
  'partnership_with_upfront_economics',
  'co_development_deal',
  'partnership_deal',
  'milestone_payment',
  'leadership_churn',
  'layoffs',
  'new_facility',
  'facility_expansion',
  'restructuring',
  'm_and_a_buyer',
  'm_and_a_target',
  'commercialization_move',
  'fda_approval',
  'phase_transition',
  'funding_round',
  'grant_award',
  'ipo_or_follow_on',
  'trial_failure_or_halt',
  'program_discontinuation',
  'other',
]);

export type PressReleaseClassification = {
  category: PressReleaseCategory;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;                             // single-sentence sales-facing summary
  key_facts?: string[];                          // 2-5 short factual bullets
  primary_company: string | null;                // the "subject" of the release
  candidate_companies: string[];                 // all companies named (incl. counterparties)
  effective_date?: string | null;

  // Deal-flavour fields
  counterparty?: string | null;
  upfront_usd?: number | null;
  milestone_max_usd?: number | null;
  deal_structure?: string | null;
  therapy_area?: string | null;
  territory?: string | null;

  // Conference-flavour fields
  conference_name?: string | null;
  conference_start_date?: string | null;
  conference_end_date?: string | null;
  session_title?: string | null;
  speaker_name?: string | null;
  speaker_title?: string | null;

  // Leadership-flavour fields
  person_name?: string | null;
  role?: string | null;
  change_type?: 'appointment' | 'departure' | 'promotion' | 'interim' | null;

  // Layoffs / restructuring
  headcount_change?: number | null;
  workforce_pct?: number | null;

  // Facility flavour
  facility_location?: string | null;
  facility_purpose?: string | null;

  // Generic
  product_name?: string | null;
  indication?: string | null;
};

function buildPrompt(opts: { title: string; summary: string; body?: string | null }): string {
  const body = (opts.body ?? opts.summary ?? '').slice(0, MAX_INPUT_CHARS);
  return `You are classifying a biotech / pharma press release for a B2B sales-intelligence platform that surfaces buying signals.

Title: ${opts.title}

Body (truncated):
\`\`\`
${body}
\`\`\`

Classify into EXACTLY ONE of these categories based on what the release is fundamentally about:

- "conference_presentation" — company will present, speak, or display data at a named medical/scientific/investor conference
- "licensing_deal" — explicit licensing of a specific asset / technology / IP
- "partnership_with_upfront_economics" — strategic partnership with disclosed upfront + milestone economics
- "co_development_deal" — joint development of a product or program (often no equity)
- "partnership_deal" — partnership/collaboration announced without disclosed economics
- "milestone_payment" — company received a milestone payment from an existing partner
- "leadership_churn" — exec officer or director appointment / departure / interim
- "layoffs" — workforce reduction announced
- "new_facility" — new GMP / manufacturing / lab / R&D facility opening
- "facility_expansion" — expansion of an existing site
- "restructuring" — strategic reorganisation, pipeline reprioritisation, write-down
- "m_and_a_buyer" — this company is ACQUIRING another (they're the buyer)
- "m_and_a_target" — this company is BEING acquired (they're the seller / target)
- "commercialization_move" — launch, label expansion, geographic launch, distribution agreement
- "fda_approval" — FDA approval / clearance / authorisation announced
- "phase_transition" — clinical program advancing to a new phase
- "funding_round" — equity financing (private placement, Series A/B/C, PIPE)
- "grant_award" — non-dilutive grant / SBIR / BARDA contract
- "ipo_or_follow_on" — initial public offering or follow-on equity issuance
- "trial_failure_or_halt" — clinical trial failed primary endpoint, halted, or terminated
- "program_discontinuation" — company explicitly winding down a program
- "other" — anything else (routine quarterly earnings, broad market commentary, non-substantive)

Return ONLY a JSON object (no markdown, no prose) with this shape, including only fields that apply:

{
  "category": "<one of the above>",
  "confidence": "low" | "medium" | "high",
  "rationale": "<single sentence, sales-facing>",
  "key_facts": ["<short fact 1>", "<short fact 2>"],
  "effective_date": "<YYYY-MM-DD or null>",

  "primary_company": "<the main company the release is about>",
  "candidate_companies": ["<all distinct company names mentioned>"],

  // deal-flavour:
  "counterparty": "<other party name or null>",
  "upfront_usd": <number in USD or null>,
  "milestone_max_usd": <number in USD or null>,
  "deal_structure": "<short description or null>",
  "therapy_area": "<short description or null>",
  "territory": "<short description or null>",

  // conference-flavour:
  "conference_name": "<conference name or null>",
  "conference_start_date": "<YYYY-MM-DD or null>",
  "conference_end_date": "<YYYY-MM-DD or null>",
  "session_title": "<session/abstract title or null>",
  "speaker_name": "<presenter name or null>",
  "speaker_title": "<presenter title or null>",

  // leadership-flavour:
  "person_name": "<full name or null>",
  "role": "<title (e.g. 'CFO') or null>",
  "change_type": "appointment" | "departure" | "promotion" | "interim" | null,

  // layoffs / restructuring:
  "headcount_change": <number (positive = additions, negative = cuts) or null>,
  "workforce_pct": <number 0-100 or null>,

  // facility:
  "facility_location": "<city/region or null>",
  "facility_purpose": "<short description or null>",

  // generic:
  "product_name": "<lead product or null>",
  "indication": "<therapeutic indication or null>"
}

Rules:
- Be CONSERVATIVE on dollar amounts — only extract when explicitly disclosed in the text. Never invent.
- candidate_companies should include every distinct company name mentioned (filer + counterparties + partners).
- primary_company is the subject of the release (usually the issuer).
- If genuinely "other", set category="other" and skip the optional fields.`;
}

function extractTextBlocks(message: { content?: unknown }): string {
  const blocks = Array.isArray(message?.content) ? (message.content as unknown[]) : [];
  return blocks
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .join('\n')
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function coerceString(value: unknown, maxLen = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function coerceNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,$%]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceConfidence(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function coerceStringArray(value: unknown, maxItems = 12, maxLen = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function coerceChangeType(value: unknown): 'appointment' | 'departure' | 'promotion' | 'interim' | null {
  if (value === 'appointment' || value === 'departure' || value === 'promotion' || value === 'interim') return value;
  return null;
}

function coerceCategory(value: unknown): PressReleaseCategory {
  if (typeof value === 'string' && ALLOWED_CATEGORIES.has(value as PressReleaseCategory)) {
    return value as PressReleaseCategory;
  }
  return 'other';
}

function coerceIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export type ClassifyPressReleaseInput = {
  title: string;
  summary: string;
  body?: string | null;
};

export async function classifyPressRelease(
  input: ClassifyPressReleaseInput,
): Promise<PressReleaseClassification | null> {
  const cleanTitle = (input.title || '').slice(0, 500);
  const cleanSummary = (input.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanTitle && !cleanSummary) return null;

  // Provider routing lives in lib/llm-client. Defaults to OpenRouter when
  // OPENROUTER_API_KEY is set, falls back to direct Anthropic otherwise.
  // Both providers default to Claude Haiku 4.5 — same model quality on both
  // routes; OpenRouter gives us multi-provider failover when Anthropic
  // credits run out.
  const completion = await completeLlm({
    feature: 'press_release_classifier',
    prompt: buildPrompt({ title: cleanTitle, summary: cleanSummary, body: input.body }),
    maxTokens: 800,
  });

  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'press_release_classifier',
    route: 'lib/signals/classify-press-release#classifyPressRelease',
    model: completion.model,
    usage: completion.usage,
    metadata: { title: cleanTitle.slice(0, 200) },
  });

  const parsed = parseJsonObject(completion.text);
  if (!parsed) return null;

  return {
    category: coerceCategory(parsed.category),
    confidence: coerceConfidence(parsed.confidence),
    rationale: coerceString(parsed.rationale, 600) ?? 'No rationale provided.',
    key_facts: coerceStringArray(parsed.key_facts, 6, 200),
    effective_date: coerceIsoDate(parsed.effective_date),
    primary_company: coerceString(parsed.primary_company, 200),
    candidate_companies: coerceStringArray(parsed.candidate_companies, 12, 200),
    counterparty: coerceString(parsed.counterparty, 200),
    upfront_usd: coerceNumberOrNull(parsed.upfront_usd),
    milestone_max_usd: coerceNumberOrNull(parsed.milestone_max_usd),
    deal_structure: coerceString(parsed.deal_structure, 300),
    therapy_area: coerceString(parsed.therapy_area, 200),
    territory: coerceString(parsed.territory, 200),
    conference_name: coerceString(parsed.conference_name, 300),
    conference_start_date: coerceIsoDate(parsed.conference_start_date),
    conference_end_date: coerceIsoDate(parsed.conference_end_date),
    session_title: coerceString(parsed.session_title, 400),
    speaker_name: coerceString(parsed.speaker_name, 200),
    speaker_title: coerceString(parsed.speaker_title, 200),
    person_name: coerceString(parsed.person_name, 200),
    role: coerceString(parsed.role, 100),
    change_type: coerceChangeType(parsed.change_type),
    headcount_change: coerceNumberOrNull(parsed.headcount_change),
    workforce_pct: coerceNumberOrNull(parsed.workforce_pct),
    facility_location: coerceString(parsed.facility_location, 200),
    facility_purpose: coerceString(parsed.facility_purpose, 300),
    product_name: coerceString(parsed.product_name, 200),
    indication: coerceString(parsed.indication, 200),
  };
}

/**
 * Maps a classification.category to the catalog signal it should emit. Returns
 * null for categories we don't surface as readiness signals (e.g., "other").
 */
import type { SignalKey } from '@/lib/signals/readiness-types';

export function signalKeyForPressRelease(c: PressReleaseClassification | null): SignalKey | null {
  if (!c) return null;
  switch (c.category) {
    case 'conference_presentation':
      return 'conference_presentation';
    case 'licensing_deal':
      return 'licensing_deal';
    case 'partnership_with_upfront_economics':
      return 'partnership_with_upfront_economics';
    case 'co_development_deal':
      return 'co_development_deal';
    case 'partnership_deal':
      return 'partnership_deal';
    case 'milestone_payment':
      return 'milestone_payment';
    case 'leadership_churn':
      return 'leadership_churn';
    case 'layoffs':
      return 'layoffs';
    case 'new_facility':
      return 'new_facility';
    case 'facility_expansion':
      return 'facility_expansion';
    case 'restructuring':
      return 'restructuring';
    case 'm_and_a_buyer':
    case 'm_and_a_target':
      return 'acquisition_distraction';
    case 'commercialization_move':
      return 'commercialization_move';
    case 'fda_approval':
      return 'fda_approval';
    case 'phase_transition':
      return 'phase_transition';
    case 'funding_round':
      return 'funding_round';
    case 'grant_award':
      return 'grant_award';
    case 'ipo_or_follow_on':
      return 'ipo_or_follow_on';
    case 'trial_failure_or_halt':
      return 'trial_failure_or_halt';
    case 'program_discontinuation':
      return 'program_discontinuation';
    case 'other':
    default:
      return null;
  }
}
