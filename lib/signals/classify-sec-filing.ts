/**
 * Haiku classifier for SEC 8-K and 424B filings.
 *
 * Reads the primary-doc body and returns a typed classification object that
 * downstream signal emission can route on. Designed to be cheap and cached —
 * the result is stored in sec_filings_local.classification jsonb and never
 * re-computed once written.
 *
 * Cost shape:
 *   - Haiku 4.5
 *   - ~6-10K input tokens per filing (we truncate the body before sending)
 *   - ~300 output tokens (compact JSON)
 *   - Roughly $0.001-0.005 per call, pennies per day for a small book
 *
 * NOT for Form D — those have structured XML; we parse those directly.
 */
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import type { ReadinessDimension, SignalKey } from '@/lib/signals/readiness-types';

const MAX_INPUT_CHARS = 28_000; // ~7K tokens worth of body text — covers the cover page + first sections where the action lives

// ── Item-code fast paths ──────────────────────────────────────────────────────
// 8-K filings contain section headings like "Item 1.01", "Item 5.02" etc.
// We extract these from the body text to short-circuit LLM calls when the
// category can be determined structurally.

/**
 * Extract 8-K item codes (e.g. "1.01", "5.02") present in the filing body.
 * Supplements item codes already stored in sec_filings_local.items, which can
 * be incomplete for legacy rows ingested before the V2 extractor shipped.
 */
export function extractItemCodesFromText(text: string): string[] {
  const codes = new Set<string>();
  const matches = text.matchAll(/\bitem\s+(\d+\.\d+)/gi);
  for (const m of matches) codes.add(m[1]);
  return [...codes];
}

/**
 * Item codes that are NEVER actionable for our signal set.
 * If ALL items in a filing are from this set, return null immediately — no LLM call.
 */
const NEVER_ACTIONABLE_ITEM_CODES = new Set([
  '2.02', // Results of operations (earnings release) — huge volume, never a signal
  '7.01', // Regulation FD disclosure (voluntary analyst communication)
  '9.01', // Financial statements and exhibits (metadata; always accompanies other items)
  '4.01', // Change of certifying accountant
  '3.03', // Material modification to rights of security holders
  '5.03', // Amendments to articles of incorporation or bylaws
  '5.04', // Temporary suspension of trading under employee benefit plans
  '5.05', // Amendment to code of ethics
  '5.07', // Submission of matters to security holder vote
  '5.08', // Exempt solicitation
]);

/**
 * Item codes that deterministically map to a category without needing an LLM
 * call — used when no genuinely ambiguous items (1.01, 1.02, 8.01) are present
 * alongside them. Detail fields (counterparty, person name, etc.) will be empty
 * but the signal category and rationale are accurate.
 */
const DETERMINISTIC_ITEM_MAP: Readonly<
  Record<string, { category: Sec8KCategory; rationale: (entityName: string | null) => string }>
> = {
  '5.01': {
    category: 'm_and_a_target',
    rationale: (n) =>
      `${n ?? 'Company'} disclosed a change in control — they are being acquired or a controlling stake has transferred.`,
  },
  '1.03': {
    category: 'restructuring',
    rationale: (n) => `${n ?? 'Company'} filed for bankruptcy or receivership.`,
  },
  '2.01': {
    category: 'acquisition_distraction',
    rationale: (n) => `${n ?? 'Company'} completed an acquisition or disposition of assets.`,
  },
  '2.03': {
    category: 'financing',
    rationale: (n) =>
      `${n ?? 'Company'} created a direct financial obligation — debt facility, term loan, or notes issued.`,
  },
  '2.04': {
    category: 'restructuring',
    rationale: (n) =>
      `${n ?? 'Company'} disclosed a triggering event that accelerates or increases a direct financial obligation.`,
  },
  '2.05': {
    category: 'restructuring',
    rationale: (n) =>
      `${n ?? 'Company'} disclosed costs from exit or disposal activities — likely restructuring or layoffs.`,
  },
  '2.06': {
    category: 'restructuring',
    rationale: (n) => `${n ?? 'Company'} disclosed a material impairment of assets.`,
  },
  '3.01': {
    category: 'restructuring',
    rationale: (n) =>
      `${n ?? 'Company'} received a notice of failure to satisfy continued listing requirements.`,
  },
};

/**
 * Item codes where the category genuinely can't be inferred from the code alone.
 * '1.01' — material agreement entered; could be any deal type, financing, or employment.
 * '8.01' — catch-all other events; anything.
 * '1.02' is NOT here: termination of agreement is always terminated_deal — the LLM
 * extracts counterparty_type/agreement_type/termination_reason from the body.
 */
const AMBIGUOUS_ITEM_CODES = new Set(['1.01', '8.01']);

// ── Category taxonomy ──────────────────────────────────────────────────────
// Each category maps directly to a signal_key the catalog already knows about.
// 'other' means "nothing actionable" → no signal emitted, but we still cache
// the classification so we don't re-classify the same filing forever.

export type Sec8KCategory =
  | 'licensing_deal'
  | 'partnership_with_upfront_economics'
  | 'co_development_deal'
  | 'partnership_deal'
  | 'milestone_payment'
  | 'acquisition_distraction'  // they ARE acquiring someone — operational distraction
  | 'm_and_a_target'           // they are BEING acquired — caution flavour
  | 'restructuring'
  | 'leadership_churn'         // 5.02 events
  | 'financing'                // non-3.02 debt/credit/notes
  | 'terminated_deal'          // 1.02 — termination of a material definitive agreement
  | 'other';

export type Sec424BCategory =
  | 'ipo_or_follow_on'
  | 'shelf_takedown'   // ATM-style takedown off an existing shelf
  | 'other';

export type SecFilingClassification = {
  // Required for both flavours
  category: Sec8KCategory | Sec424BCategory;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;                          // single sentence, user-facing
  key_facts?: string[];                       // 2-5 short bullet-point facts
  effective_date?: string | null;             // ISO date if disclosed

  // Deal-flavour fields (licensing_deal, partnership_*, co_development_deal, m_and_a_*)
  counterparty?: string | null;
  upfront_usd?: number | null;
  milestone_max_usd?: number | null;
  royalty_terms?: string | null;
  deal_structure?: string | null;             // "exclusive license + option", "co-development + co-promotion", etc.
  territory?: string | null;                  // "worldwide", "US", "ex-US", etc.
  therapy_area?: string | null;               // "oncology", "immunology", etc.

  // Leadership change fields (5.02)
  person_name?: string | null;
  role?: string | null;                       // "CFO", "CMO", etc.
  change_type?: 'appointment' | 'departure' | 'promotion' | 'interim' | null;
  buyer_function?: string | null;             // mapped from role when possible
  circumstances?: string | null;              // "resignation", "termination", "retirement"

  // Termination fields (terminated_deal / Item 1.02)
  agreement_type?: 'license' | 'partnership' | 'collaboration' | 'service_agreement' | 'co_development' | 'other' | null;
  counterparty_type?: 'biotech' | 'pharma' | 'cro' | 'cmo' | 'academic' | 'government' | 'other' | null;
  termination_reason?: 'strategic' | 'program_failure' | 'completion' | 'cause' | 'unknown' | null;

  // 424B proceeds fields
  offering_type?: 'ipo' | 'follow_on' | 'shelf_takedown' | 'atm' | null;
  gross_proceeds_usd?: number | null;
  net_proceeds_usd?: number | null;
  price_per_share?: number | null;
  shares_offered?: number | null;
  use_of_proceeds_summary?: string | null;
};

// Map classification.category → SignalKey + dimension hints for downstream emit.
// Returning null means "do not emit a signal" (still cache the classification).
export function signalKeyForClassification(
  c: SecFilingClassification | null | undefined,
): { signalKey: SignalKey; dimensions: ReadinessDimension[] } | null {
  if (!c) return null;
  switch (c.category) {
    case 'licensing_deal':
      return { signalKey: 'licensing_deal', dimensions: ['new_strategy', 'new_budget'] };
    case 'partnership_with_upfront_economics':
      return { signalKey: 'partnership_with_upfront_economics', dimensions: ['new_budget', 'new_strategy'] };
    case 'co_development_deal':
      return { signalKey: 'co_development_deal', dimensions: ['new_strategy', 'new_needs'] };
    case 'partnership_deal':
      return { signalKey: 'partnership_deal', dimensions: ['new_strategy'] };
    case 'milestone_payment':
      return { signalKey: 'milestone_payment', dimensions: ['new_budget'] };
    case 'acquisition_distraction':
    case 'm_and_a_target':
      return { signalKey: 'ma_event', dimensions: ['new_budget', 'new_strategy', 'new_people', 'new_needs'] };
    case 'restructuring':
      return { signalKey: 'restructuring', dimensions: ['caution'] };
    case 'leadership_churn':
      return { signalKey: 'leadership_churn', dimensions: ['caution', 'new_people'] };
    case 'terminated_deal':
      return { signalKey: 'terminated_deal', dimensions: ['new_strategy', 'new_needs'] };
    case 'financing':
      return { signalKey: 'funding_round', dimensions: ['new_budget'] };
    case 'ipo_or_follow_on':
    case 'shelf_takedown':
      return { signalKey: 'ipo_or_follow_on', dimensions: ['new_budget'] };
    case 'other':
      return null;
    default:
      return null;
  }
}

function build8KPrompt(opts: {
  entityName: string | null;
  items: string[];
  filingDate: string | null;
  bodyText: string;
}): string {
  const itemList = opts.items.length > 0 ? opts.items.join(', ') : '(none extracted)';
  return `You are classifying an SEC 8-K filing for a B2B sales-intelligence platform that surfaces buying signals for biotech sales teams.

Filer: ${opts.entityName ?? 'unknown'}
Filing date: ${opts.filingDate ?? 'unknown'}
Reported items: ${itemList}

Classify the filing into EXACTLY ONE of these categories based on what the filing is fundamentally about (look at the substance, not just the item code):

- "licensing_deal" — the company licensed in or licensed out a specific asset/technology/IP, with disclosed economics
- "partnership_with_upfront_economics" — strategic partnership with upfront cash + milestone economics (broader than a pure license)
- "co_development_deal" — joint development of a product/program (often no equity, shared costs)
- "partnership_deal" — partnership/collaboration announced but no upfront economics or details
- "milestone_payment" — the company received a milestone payment from an existing partner
- "acquisition_distraction" — the company is ACQUIRING another company (they're the buyer)
- "m_and_a_target" — the company is BEING acquired (they're the seller/target)
- "restructuring" — layoffs, reorganization, program prioritization, write-downs
- "leadership_churn" — Item 5.02 — executive officer or director appointment/departure
- "financing" — non-Item-3.02 financing: credit facility, term loan, senior notes, convertible notes, debt issuance
- "terminated_deal" — the company terminated (ended or discontinued) a previously disclosed agreement, collaboration, or service contract (Item 1.02)
- "other" — anything else (real estate, employment agreements, routine matters, technical SEC items)

Return ONLY a JSON object (no prose, no markdown fences) with this shape, including only fields that apply:
{
  "category": "<one of the above>",
  "confidence": "low" | "medium" | "high",
  "rationale": "<single sentence in plain English describing what happened — this is shown to a salesperson>",
  "key_facts": ["<2-5 short bullet-point facts (≤80 chars each)>"],
  "effective_date": "<YYYY-MM-DD or null>",

  // For deal categories (licensing_deal, partnership_*, co_development_deal, milestone_payment, acquisition_*):
  "counterparty": "<other party name, or null>",
  "upfront_usd": <number in USD or null>,
  "milestone_max_usd": <number in USD or null>,
  "royalty_terms": "<short description or null>",
  "deal_structure": "<short description or null>",
  "territory": "<short description or null>",
  "therapy_area": "<short description or null>",

  // For terminated_deal (Item 1.02):
  "counterparty": "<name of the other party, or null>",
  "agreement_type": "license" | "partnership" | "collaboration" | "service_agreement" | "co_development" | "other" | null,
  "counterparty_type": "biotech" | "pharma" | "cro" | "cmo" | "academic" | "government" | "other" | null,
  "termination_reason": "strategic" | "program_failure" | "completion" | "cause" | "unknown" | null,

  // For leadership_churn (Item 5.02):
  "person_name": "<full name or null>",
  "role": "<title, e.g. 'CFO' or null>",
  "change_type": "appointment" | "departure" | "promotion" | "interim" | null,
  "buyer_function": "<one of: executive_leadership, business_development, partnerships, clinical_operations, research_and_development, regulatory_affairs, manufacturing_and_cmc, medical_affairs, commercial, sales_operations, procurement, strategy_and_corporate_development, lab_operations, technology_and_systems, ai_and_machine_learning, data_and_informatics, quality_and_compliance, marketing> or null",
  "circumstances": "<short description or null>"
}

Be conservative on dollar amounts — only extract when explicitly disclosed. Never invent numbers.
If the filing is genuinely routine or unparseable, return category="other" with rationale explaining why.

Filing body (truncated to ${MAX_INPUT_CHARS} chars):
\`\`\`
${opts.bodyText.slice(0, MAX_INPUT_CHARS)}
\`\`\``;
}

function build424BPrompt(opts: {
  entityName: string | null;
  formType: string;
  filingDate: string | null;
  bodyText: string;
}): string {
  return `You are extracting structured facts from an SEC ${opts.formType} prospectus filing (a registered offering of securities) for a B2B sales-intelligence platform.

Filer: ${opts.entityName ?? 'unknown'}
Filing date: ${opts.filingDate ?? 'unknown'}

Classify into ONE of:
- "ipo_or_follow_on" — initial or follow-on public offering of common equity
- "shelf_takedown" — at-the-market (ATM) sales or other takedowns off an existing shelf
- "other" — debt, preferred, exchange offer, or other non-equity prospectus content

Return ONLY a JSON object (no prose, no markdown):
{
  "category": "ipo_or_follow_on" | "shelf_takedown" | "other",
  "confidence": "low" | "medium" | "high",
  "rationale": "<single sentence: amount + price + use of proceeds, for a salesperson>",
  "key_facts": ["<2-4 short facts (≤80 chars each)>"],
  "effective_date": "<YYYY-MM-DD or null>",
  "offering_type": "ipo" | "follow_on" | "shelf_takedown" | "atm" | null,
  "gross_proceeds_usd": <number or null>,
  "net_proceeds_usd": <number or null>,
  "price_per_share": <number or null>,
  "shares_offered": <number or null>,
  "use_of_proceeds_summary": "<short description or null>"
}

Be conservative on dollar amounts — extract only when explicitly disclosed. Never invent numbers.

Filing body (truncated to ${MAX_INPUT_CHARS} chars):
\`\`\`
${opts.bodyText.slice(0, MAX_INPUT_CHARS)}
\`\`\``;
}

function stripHtmlToText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tolerantJsonParse(text: string): unknown {
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`classify-sec-filing: no JSON object found in model output`);
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function coerceNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,$]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceStringOrNull(value: unknown, maxLen = 500): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function coerceStringArray(value: unknown, maxItems = 8, maxLen = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function coerceEnumOrNull<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return (allowed as readonly string[]).includes(trimmed) ? (trimmed as T) : null;
}

function coerceConfidence(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

const ALLOWED_8K_CATEGORIES: ReadonlySet<Sec8KCategory> = new Set<Sec8KCategory>([
  'licensing_deal',
  'partnership_with_upfront_economics',
  'co_development_deal',
  'partnership_deal',
  'milestone_payment',
  'acquisition_distraction',
  'm_and_a_target',
  'restructuring',
  'leadership_churn',
  'financing',
  'terminated_deal',
  'other',
]);

const ALLOWED_424B_CATEGORIES: ReadonlySet<Sec424BCategory> = new Set<Sec424BCategory>([
  'ipo_or_follow_on',
  'shelf_takedown',
  'other',
]);

const ALLOWED_CHANGE_TYPES = new Set(['appointment', 'departure', 'promotion', 'interim']);
const ALLOWED_OFFERING_TYPES = new Set(['ipo', 'follow_on', 'shelf_takedown', 'atm']);

function normalize8KClassification(raw: Record<string, unknown>): SecFilingClassification {
  const rawCategory = typeof raw.category === 'string' ? raw.category : 'other';
  const category = (ALLOWED_8K_CATEGORIES.has(rawCategory as Sec8KCategory)
    ? rawCategory
    : 'other') as Sec8KCategory;
  const changeTypeValue = typeof raw.change_type === 'string' && ALLOWED_CHANGE_TYPES.has(raw.change_type)
    ? (raw.change_type as 'appointment' | 'departure' | 'promotion' | 'interim')
    : null;
  return {
    category,
    confidence: coerceConfidence(raw.confidence),
    rationale: coerceStringOrNull(raw.rationale, 600) ?? 'No rationale provided.',
    key_facts: coerceStringArray(raw.key_facts),
    effective_date: coerceStringOrNull(raw.effective_date, 20),
    counterparty: coerceStringOrNull(raw.counterparty, 200),
    upfront_usd: coerceNumberOrNull(raw.upfront_usd),
    milestone_max_usd: coerceNumberOrNull(raw.milestone_max_usd),
    royalty_terms: coerceStringOrNull(raw.royalty_terms, 300),
    deal_structure: coerceStringOrNull(raw.deal_structure, 300),
    territory: coerceStringOrNull(raw.territory, 200),
    therapy_area: coerceStringOrNull(raw.therapy_area, 200),
    person_name: coerceStringOrNull(raw.person_name, 200),
    role: coerceStringOrNull(raw.role, 100),
    change_type: changeTypeValue,
    buyer_function: coerceStringOrNull(raw.buyer_function, 60),
    circumstances: coerceStringOrNull(raw.circumstances, 200),
    agreement_type: coerceEnumOrNull(raw.agreement_type, ['license', 'partnership', 'collaboration', 'service_agreement', 'co_development', 'other'] as const),
    counterparty_type: coerceEnumOrNull(raw.counterparty_type, ['biotech', 'pharma', 'cro', 'cmo', 'academic', 'government', 'other'] as const),
    termination_reason: coerceEnumOrNull(raw.termination_reason, ['strategic', 'program_failure', 'completion', 'cause', 'unknown'] as const),
  };
}

function normalize424BClassification(raw: Record<string, unknown>): SecFilingClassification {
  const rawCategory = typeof raw.category === 'string' ? raw.category : 'other';
  const category = (ALLOWED_424B_CATEGORIES.has(rawCategory as Sec424BCategory)
    ? rawCategory
    : 'other') as Sec424BCategory;
  const offeringTypeValue = typeof raw.offering_type === 'string' && ALLOWED_OFFERING_TYPES.has(raw.offering_type)
    ? (raw.offering_type as 'ipo' | 'follow_on' | 'shelf_takedown' | 'atm')
    : null;
  return {
    category,
    confidence: coerceConfidence(raw.confidence),
    rationale: coerceStringOrNull(raw.rationale, 600) ?? 'No rationale provided.',
    key_facts: coerceStringArray(raw.key_facts),
    effective_date: coerceStringOrNull(raw.effective_date, 20),
    offering_type: offeringTypeValue,
    gross_proceeds_usd: coerceNumberOrNull(raw.gross_proceeds_usd),
    net_proceeds_usd: coerceNumberOrNull(raw.net_proceeds_usd),
    price_per_share: coerceNumberOrNull(raw.price_per_share),
    shares_offered: coerceNumberOrNull(raw.shares_offered),
    use_of_proceeds_summary: coerceStringOrNull(raw.use_of_proceeds_summary, 500),
  };
}

export type ClassifyInput = {
  formType: string;
  entityName: string | null;
  filingDate: string | null;
  items?: string[];
  primaryDocText: string;
};

export async function classifySecFiling(input: ClassifyInput): Promise<SecFilingClassification | null> {
  const cleanText = stripHtmlToText(input.primaryDocText);
  if (!cleanText || cleanText.length < 80) {
    // Empty or too-short body — no useful signal to extract.
    return null;
  }

  const is424B = /^424B/i.test(input.formType);

  // ── 8-K item-code fast paths (no LLM) ───────────────────────────────────
  if (!is424B) {
    // Merge DB-stored item codes with codes extracted directly from the body
    // text. The body extraction catches legacy rows where items weren't stored.
    const bodyItems = extractItemCodesFromText(cleanText);
    const allItems = [...new Set([...(input.items ?? []), ...bodyItems])].filter(Boolean);

    if (allItems.length > 0) {
      // Fast-path 1: every item is never-actionable → skip entirely, no LLM.
      if (allItems.every((c) => NEVER_ACTIONABLE_ITEM_CODES.has(c))) {
        return null;
      }

      // Fast-path 2: no ambiguous items present and at least one deterministic
      // item code found → return classification without LLM. Detail fields
      // (counterparty, person name, etc.) are left empty but the category,
      // confidence, and rationale are accurate.
      const hasAmbiguous = allItems.some((c) => AMBIGUOUS_ITEM_CODES.has(c));
      if (!hasAmbiguous) {
        for (const itemCode of allItems) {
          const det = DETERMINISTIC_ITEM_MAP[itemCode];
          if (det) {
            return {
              category: det.category,
              confidence: 'high',
              rationale: det.rationale(input.entityName),
              key_facts: [],
              effective_date: input.filingDate,
            };
          }
        }
      }

      // Enrich the input items for the LLM prompt with the merged set.
      input = { ...input, items: allItems };
    }
  }

  const prompt = is424B
    ? build424BPrompt({
        entityName: input.entityName,
        formType: input.formType,
        filingDate: input.filingDate,
        bodyText: cleanText,
      })
    : build8KPrompt({
        entityName: input.entityName,
        items: input.items ?? [],
        filingDate: input.filingDate,
        bodyText: cleanText,
      });

  // Provider routing lives in lib/llm-client. Defaults to OpenRouter when
  // OPENROUTER_API_KEY is set, falls back to direct Anthropic otherwise.
  const completion = await completeLlm({
    feature: 'sec_filing_classifier',
    prompt,
    maxTokens: 700,
  });

  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'sec_filing_classifier',
    route: 'lib/signals/classify-sec-filing#classifySecFiling',
    model: completion.model,
    usage: completion.usage,
    metadata: { form_type: input.formType, accession: input.entityName ? input.entityName.slice(0, 100) : null },
  });

  const parsed = tolerantJsonParse(completion.text) as Record<string, unknown>;
  return is424B ? normalize424BClassification(parsed) : normalize8KClassification(parsed);
}
