/**
 * Company monitor — funding module.
 *
 * Resolves a company's current funding stage to our taxonomy by:
 * 1. Mapping Apollo's funding_stage directly if it cleanly matches
 * 2. Falling back to a Claude web search (press releases, news) if Apollo
 *    returned "Venture (Round not Specified)", null, or a non-matching value
 *
 * Designed to be one module in the broader company-monitor pipeline alongside
 * future modules for clinical trials, EDGAR filings, and NIH grants.
 */

import Anthropic from '@anthropic-ai/sdk';
import { FUNDING_STAGE_OPTIONS, type FundingStage } from '@/lib/arcova-taxonomy';

export type { FundingStage };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FundingInput = {
  company_name: string;
  domain?: string | null;
  apollo_funding_stage?: string | null;   // raw Apollo value, may be vague
  apollo_total_funding_usd?: number | null;
  apollo_latest_funding_date?: string | null;
};

export type FundingResult = {
  funding_stage: FundingStage | null;     // normalised to our taxonomy
  funding_status_label: string | null;    // display-ready non-taxonomy result when needed
  total_funding_usd: number | null;
  latest_funding_date: string | null;
  source: 'apollo' | 'web_search' | null; // where the result came from
  confidence: 'high' | 'medium' | 'low';
  raw_finding: string | null;             // what the search or Apollo actually said
  checked_at: string;                     // ISO timestamp
};

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseOptionalDate(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseOptionalStatusLabel(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ─── Apollo direct mapping ────────────────────────────────────────────────────

/**
 * Map Apollo's funding_stage strings to our taxonomy where unambiguous.
 * Returns null if the Apollo value is vague or missing.
 */
function mapApolloFundingStage(raw: string | null | undefined): FundingStage | null {
  if (!raw) return null;
  const normalised = raw.toLowerCase().trim();

  if (normalised.includes('pre-seed') || normalised.includes('pre seed')) return 'Pre-seed';
  if (normalised === 'seed' || normalised.includes('angel')) return 'Seed';
  if (normalised === 'series a') return 'Series A';
  if (normalised === 'series b') return 'Series B';
  if (normalised === 'series c') return 'Series C';
  if (normalised.match(/series [d-z]/i) || normalised.includes('series d+') || normalised.includes('growth')) return 'Series D+';
  if (normalised.includes('ipo') || normalised.includes('post-ipo') || normalised.includes('public')) return 'Public';
  if (normalised.includes('grant')) return 'Grant-funded';
  if (normalised.includes('non-profit') || normalised.includes('nonprofit') || normalised.includes('donation') || normalised.includes('charity') || normalised.includes('foundation')) return 'Non-profit';

  // "Venture (Round not Specified)" and anything else → needs web search
  return null;
}

// ─── Web search ───────────────────────────────────────────────────────────────

async function searchFundingStage(input: FundingInput): Promise<FundingResult> {
  const checkedAt = new Date().toISOString();
  const companyRef = input.domain
    ? `${input.company_name} (${input.domain})`
    : input.company_name;

  const fundingContext = input.apollo_total_funding_usd
    ? `Apollo has recorded total funding of $${(input.apollo_total_funding_usd / 1_000_000).toFixed(1)}M but the round type is unspecified.`
    : 'No funding amount on record.';

  const prompt = `You are researching the funding status of a life sciences / biopharma company to classify it for a CRM.

Company: ${companyRef}
${fundingContext}

Your task:
1. Search for recent funding news, press releases, or investor announcements for this company.
2. Determine the most recent funding round or public status.
3. Classify into exactly one of: ${FUNDING_STAGE_OPTIONS.join(', ')}
   - Use "Public" if the company is listed on a stock exchange
   - Use "Grant-funded" if the company is primarily funded by government or academic grants with no VC rounds
   - Use "Non-profit" if the company is a registered non-profit, charity, foundation, or donation/community-funded organisation with no equity structure
   - Use null if you genuinely cannot determine the funding stage

Search for "[company name] funding round", "[company name] raises", and "[company name] investor" to find the most recent information.

Return ONLY valid JSON:
{
  "funding_stage": "<one of the taxonomy options or null>",
  "funding_status_label": "<short display label like 'Venture capital fund', 'Venture - Series Unknown', 'Private company', or null>",
  "total_funding_usd": <number or null>,
  "latest_funding_date": "<YYYY-MM-DD or null>",
  "confidence": "<high|medium|low>",
  "raw_finding": "<one sentence summary of what you found>"
}

Rules for funding_status_label:
- If funding_stage is one of the taxonomy values, funding_status_label may repeat that value
- If funding_stage is null but you can still determine a useful non-taxonomy status, return a short label taken from the evidence
- Prefer source language like "Venture capital fund" or "Venture - Series Unknown" over invented paraphrases
- Return null only if you genuinely cannot determine any useful funding status`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
      } as Parameters<typeof client.messages.create>[0]['tools'] extends Array<infer T> ? T : never,
    ],
  });

  // Extract final text block
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      funding_stage: null,
      funding_status_label: null,
      total_funding_usd: null,
      latest_funding_date: null,
      source: 'web_search',
      confidence: 'low',
      raw_finding: text.slice(0, 300) || null,
      checked_at: checkedAt,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    funding_stage?: string | null;
    funding_status_label?: string | null;
    total_funding_usd?: number | string | null;
    latest_funding_date?: string | null;
    confidence?: string;
    raw_finding?: string | null;
  };

  const stage = FUNDING_STAGE_OPTIONS.includes(parsed.funding_stage as FundingStage)
    ? (parsed.funding_stage as FundingStage)
    : null;

  return {
    funding_stage: stage,
    funding_status_label:
      parseOptionalStatusLabel(parsed.funding_status_label) ??
      stage,
    total_funding_usd: parseOptionalNumber(parsed.total_funding_usd),
    latest_funding_date: parseOptionalDate(parsed.latest_funding_date),
    source: 'web_search',
    confidence: (parsed.confidence as FundingResult['confidence']) || 'low',
    raw_finding: parsed.raw_finding || null,
    checked_at: checkedAt,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve funding stage for a company.
 * Uses Apollo data if it cleanly maps; falls back to web search otherwise.
 */
export async function resolveFundingStage(input: FundingInput): Promise<FundingResult> {
  const checkedAt = new Date().toISOString();

  // Try Apollo first — fast, free, no search needed
  const apolloMapped = mapApolloFundingStage(input.apollo_funding_stage);
  if (apolloMapped) {
    return {
      funding_stage: apolloMapped,
      funding_status_label: apolloMapped,
      total_funding_usd: input.apollo_total_funding_usd ?? null,
      latest_funding_date: input.apollo_latest_funding_date ?? null,
      source: 'apollo',
      confidence: 'high',
      raw_finding: input.apollo_funding_stage || null,
      checked_at: checkedAt,
    };
  }

  // Fall back to web search
  return searchFundingStage(input);
}
