/**
 * "My company" enrichment pipeline — for the SELLER'S OWN company profile only.
 *
 * This is NOT for prospect/target companies (those go through lib/enrichment-pipeline.ts
 * and are stored in the `companies` table). This pipeline writes to `company_analyses`.
 *
 * Three sources, run in order:
 *   1. Claude web_search  — narrative analysis (what they do, who they serve, etc.)
 *   2. Apollo org enrich  — verified firmographics (headcount, funding, HQ)   ┐ parallel
 *   3. Apify LinkedIn     — social proof (follower count, employee range, etc.) ┘ after 1+2 give us the LinkedIn URL
 */
import Anthropic from '@anthropic-ai/sdk';

const ANALYSIS_MODEL = 'claude-sonnet-4-6';
const HARVESTAPI_COMPANY_ACTOR = 'harvestapi~linkedin-company';

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function extractTextBlocks(message: { content?: unknown }): string {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .join('\n')
    .trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── 1. Claude web_search ──────────────────────────────────────────────────────

/**
 * Research a company by website URL using Claude with web search.
 * Returns structured narrative fields matching the company_analyses schema,
 * plus a best-effort LinkedIn company URL.
 */
export async function analyseCompanyWithClaude(
  website: string,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey });

  const prompt = `You are a B2B sales intelligence analyst. Research the company at ${website} using web search and return a structured JSON profile for a sales intelligence platform.

Search their website, LinkedIn company page, Crunchbase, news articles, and any other relevant sources.

Return ONLY valid JSON in this exact structure. Every array field must have 2–5 concise, factual strings (10–20 words each):

{
  "company_name": "Official company name",
  "linkedin_url": "https://www.linkedin.com/company/... or null if not found",
  "description": ["What the company does in plain terms", "..."],
  "products_services": ["Key product or service", "..."],
  "target_customers": ["Customer segment they sell to", "..."],
  "value_propositions": ["Core value proposition", "..."],
  "industries": ["Industry they operate in", "..."],
  "technologies": ["Key technology or platform they use or sell", "..."],
  "competitors": ["Named competitor", "..."],
  "unique_characteristics": ["What makes them different", "..."],
  "business_model": ["How they generate revenue", "..."],
  "operating_environment": ["Market or regulatory context they operate in", "..."],
  "market_summary": ["Summary of their market position", "..."],
  "customers_we_serve": ["Type of customer they serve", "..."],
  "why_customers_buy": ["Key reason a buyer chooses them", "..."],
  "differentiated_value": ["Specific differentiator vs alternatives", "..."],
  "status_quo": ["What buyers typically do today without this solution", "..."],
  "capabilities": ["Core capability or feature", "..."],
  "challenges_addressed": ["Pain point or problem they solve", "..."],
  "customer_benefits": ["Concrete benefit a customer gets", "..."],
  "good_fit": ["Characteristic of an ideal customer", "..."],
  "bad_fit": ["Characteristic of a poor-fit customer", "..."],
  "therapeutic_areas": ["Therapeutic area this company operates in or serves, e.g. Oncology, Rare Disease — or null if not a life sciences company"],
  "modalities": ["Drug or technology modality, e.g. Small Molecule, Biologics, Cell & Gene Therapy, ADC — or null if not applicable"],
  "development_stages": ["Clinical development stage relevant to this company, e.g. Preclinical, Phase I, Phase II, Commercial — or null if not applicable"]
}

For therapeutic_areas, modalities, and development_stages: only populate if the company is in or sells to life sciences / biopharma / medtech. Return an empty array [] if not applicable — do NOT guess or fabricate.

Company website: ${website}

For linkedin_url: search for their official LinkedIn company page and return the full URL (https://www.linkedin.com/company/...). Return null if you cannot find it with confidence.

Return ONLY the JSON object. No markdown, no explanation.`;

  const message = await client.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 8,
      } as Parameters<typeof client.messages.create>[0]['tools'][0],
    ],
  });

  const text = extractTextBlocks(message as { content?: unknown });
  const parsed = parseJson(text);

  if (!parsed || Object.keys(parsed).length === 0) {
    throw new Error(`Claude analysis returned no parseable JSON. Raw: ${text.slice(0, 400)}`);
  }

  return parsed;
}

// ── 2. Apify LinkedIn company scraper ─────────────────────────────────────────

/**
 * Scrape LinkedIn company data via Apify HarvestAPI actor.
 * Returns raw Apify payload or null if unavailable / errored.
 */
export async function scrapeLinkedInCompany(
  linkedinUrl: string,
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    console.warn('[company-enrichment] APIFY_API_KEY not set — skipping LinkedIn scrape');
    return null;
  }

  const response = await fetch(
    `https://api.apify.com/v2/acts/${HARVESTAPI_COMPANY_ACTOR}/run-sync-get-dataset-items`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companies: [linkedinUrl] }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error(
      `[company-enrichment] Apify failed (${response.status}): ${errorText.slice(0, 300)}`,
    );
    return null;
  }

  const payload = (await response.json()) as unknown;
  const raw = Array.isArray(payload) ? payload[0] : payload;
  if (!raw || typeof raw !== 'object') return null;
  return raw as Record<string, unknown>;
}

// ── 3. Extract structured firmographics from Apify raw payload ────────────────

export type ApifyFirmographics = {
  description: string | null;
  tagline: string | null;
  logo_url: string | null;
  follower_count: number | null;
  employee_count: number | null;
  employee_range: string | null;
  industry: string | null;
  founded_year: number | null;
  hq_city: string | null;
  hq_country: string | null;
  specialties: string[] | null;
  linkedin_url: string | null;
};

export function extractApifyFirmographics(
  raw: Record<string, unknown> | null,
): ApifyFirmographics {
  if (!raw) {
    return {
      description: null, tagline: null, logo_url: null, follower_count: null,
      employee_count: null, employee_range: null, industry: null, founded_year: null,
      hq_city: null, hq_country: null, specialties: null, linkedin_url: null,
    };
  }

  const locations = (
    Array.isArray(raw.locations) ? raw.locations :
    Array.isArray(raw.officeLocations) ? raw.officeLocations : []
  ) as Record<string, unknown>[];

  const hq = locations.find((l) => l?.isHeadquarter || l?.headquarter) ?? locations[0] ?? null;

  const specialties = (
    Array.isArray(raw.specialties) ? raw.specialties :
    Array.isArray(raw.specialities) ? raw.specialities : []
  ).map((s) => str(s)).filter(Boolean);

  return {
    description: str(raw.description ?? raw.overview ?? raw.about) || null,
    tagline: str(raw.tagline ?? raw.slogan) || null,
    logo_url: str(raw.logo ?? raw.logoUrl ?? raw.logoResolutionResult) || null,
    follower_count: num(raw.followerCount) ?? num(raw.followersCount),
    employee_count: num(raw.employeeCount) ?? num(raw.staffCount),
    employee_range: str(raw.employeeCountRange ?? raw.staffCountRange) || null,
    industry: str(raw.industry ?? raw.industries) || null,
    founded_year: num(raw.foundedYear) ?? num(raw.founded),
    hq_city: hq ? (str(hq.city ?? hq.cityName) || null) : null,
    hq_country: hq ? (str(hq.country ?? hq.countryName ?? hq.countryCode) || null) : null,
    specialties: specialties.length > 0 ? specialties : null,
    // raw.url is the LinkedIn page URL — not the company website
    linkedin_url: str(raw.url ?? raw.linkedinUrl) || null,
  };
}

// ── LinkedIn URL normaliser ────────────────────────────────────────────────────

export function normalizeLinkedInCompanyUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');
    if (hostname !== 'linkedin.com') return null;
    if (!path.startsWith('/company/')) return null;
    return `https://www.linkedin.com${path}`;
  } catch {
    return null;
  }
}
