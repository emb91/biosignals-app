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
  "products": ["Named product (e.g. Guardant360 CDx, Salesforce CRM)", "..."],
  "services": ["Service offering (e.g. contract research, GMP manufacturing, clinical trials)", "..."],
  "target_customers": ["Short 1–4 word segment label, e.g. Health Systems, Biopharma Companies, Lab Directors, Oncology Teams — NO full sentences"],
  "value_propositions": ["Core value proposition", "..."],
  "industries": ["Industry they operate in", "..."],
  "technologies": ["Key technology or platform they use or sell", "..."],
  "competitors_enriched": [{"name": "Competitor name", "url": "https://their-website.com"}, {"name": "Another competitor", "url": "https://..."}],
  "unique_characteristics": ["What makes them different", "..."],
  "business_model": ["How they generate revenue", "..."],
  "operating_environment": ["Market or regulatory context they operate in", "..."],
  "market_summary": ["Summary of their market position", "..."],
  "customers_we_serve": ["Short 1–4 word customer segment label, e.g. Health Systems, CROs, Lab Directors, Oncology Teams — NO full sentences"],
  "why_customers_buy": ["Key reason a buyer chooses them", "..."],
  "differentiated_value": ["Specific differentiator vs alternatives", "..."],
  "status_quo": ["What buyers typically do today without this solution", "..."],
  "capabilities": ["Core capability or feature", "..."],
  "challenges_addressed": ["Pain point or problem they solve", "..."],
  "customer_benefits": ["Concrete benefit a customer gets", "..."],
  "good_fit": ["Characteristic of an ideal customer", "..."],
  "bad_fit": ["Characteristic of a poor-fit customer", "..."],
  "company_status": "Public (NASDAQ: GH) — or Private — Series B — or Bootstrapped — one short phrase describing ownership and funding status"
}

Company website: ${website}

For linkedin_url: search for their official LinkedIn company page and return the full URL (https://www.linkedin.com/company/...). Return null if you cannot find it with confidence.

For target_customers and customers_we_serve:
- Be evidence-led. Prefer segments explicitly named on the website, case studies, product pages, positioning pages, LinkedIn, or credible third-party sources.
- Think in terms of primary segments first, then meaningful secondary segments.
- Clearly distinguish customer organisation / account types from buyer / user types.
- Include a mix of customer organisation / account types and buyer / user types when both are clearly relevant.
- Cover both primary and meaningful secondary segments if the company clearly serves more than one type of customer.
- Prefer broad, repeatable market segments over one-off job titles, vague words, or internal functions.
- Good examples: "Biopharma Companies", "Academic Medical Centers", "Clinical Operations Teams", "Lab Directors".
- Prefer organisation / account types like "Biopharma Companies" or "Academic Medical Centers" over raw industries like "Healthcare".
- Prefer buyer / user groups like "Clinical Operations Teams" or "Lab Directors" over individual named titles unless those titles are the true segment.
- Do NOT list competitors, partners, investors, regulators, or generic industries unless they are clearly customers.
- Do NOT over-infer from the company's modality or therapeutic area alone.
- If the evidence is weak, return fewer but higher-confidence segments rather than guessing.
- Aim for the most complete high-confidence view of who buys from or uses this company, not just the single headline segment.

For good_fit:
- Return characteristics of companies, teams, or buyer contexts that are especially well matched to this seller.
- Focus on attributes that make the company more likely to buy or get strong value.
- Good examples: "Biotechs running distributed clinical trials", "Commercial teams with fragmented CRM workflows", "Labs scaling test volume".

For bad_fit:
- Return excluded or poor-fit segments that should usually NOT be targeted.
- Include clear disqualifiers, not weak preferences.
- Focus on companies, teams, buyer contexts, budgets, maturity levels, or use cases that are a poor fit for the seller.
- Good examples: "Early pre-product startups with no sales team", "Hospitals needing full EHR replacement", "Teams with no in-house regulatory workflow".
- Prefer specific exclusion logic over vague negatives like "small companies" unless the source clearly supports it.

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
      } as unknown as Parameters<typeof client.messages.create>[0] extends { tools?: Array<infer T> } ? T : never,
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

// ── 5. Condense long-form bullet arrays ───────────────────────────────────────

/**
 * Rewrites verbose enrichment arrays into concise UI-ready labels in a single LLM pass:
 * - good_fit / bad_fit / value_propositions → 5–8 word phrases
 * - products → short product name only (strip description after colon), max 5 words
 * - services → concise service label (e.g. "Contract research services", "GMP biologics manufacturing")
 * - technologies → 2–4 word label (e.g. "ctDNA sequencing", "NGS", "AI/ML analytics")
 */
export async function condenseBulletArrays({
  company_name,
  customers_we_serve,
  good_fit,
  bad_fit,
  value_propositions,
  products,
  services,
  technologies,
}: {
  company_name?: string;
  customers_we_serve?: string[];
  good_fit?: string[];
  bad_fit?: string[];
  value_propositions?: string[];
  products?: string[];
  services?: string[];
  technologies?: string[];
}): Promise<{
  good_fit: string[];
  bad_fit: string[];
  value_propositions: string[];
  products: string[];
  services: string[];
  technologies: string[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');

  const client = new Anthropic({ apiKey });

  const prompt = `You are condensing data for a B2B sales intelligence UI. Different fields have different rules:

**good_fit / bad_fit / value_propositions** — rewrite each as a punchy phrase of 5–8 words. No full sentences, no leading dashes, drop filler like "companies that" or "organizations with".

**products** — keep only the product name (max 5 words). Strip descriptions after a colon or dash (e.g. "Guardant360 CDx: FDA-approved liquid biopsy test…" → "Guardant360 CDx").

**services** — keep a concise service label (max 5 words) that captures what is offered (e.g. "End-to-end contract research services for biopharma clients" → "Contract research services", "GMP biologics drug substance manufacturing" → "GMP biologics manufacturing"). Never drop the service type.

**technologies** — reduce to a 2–4 word label. Use abbreviations where standard (NGS, ctDNA, AI/ML). E.g. "Next-Generation Sequencing (NGS) for comprehensive tumor mutation profiling from blood samples." → "NGS sequencing". "Circulating tumor DNA (ctDNA) digital sequencing for detection of somatic genomic alterations." → "ctDNA sequencing".
${company_name ? `\nCompany: ${company_name}` : ''}
${customers_we_serve?.length ? `Customer types (already shown elsewhere): ${customers_we_serve.join(', ')}` : ''}

Return ONLY valid JSON — no markdown, no explanation:
{
  "good_fit": [...],
  "bad_fit": [...],
  "value_propositions": [...],
  "products": [...],
  "services": [...],
  "technologies": [...]
}

Input:
${JSON.stringify(
    {
      good_fit: good_fit ?? [],
      bad_fit: bad_fit ?? [],
      value_propositions: value_propositions ?? [],
      products: products ?? [],
      services: services ?? [],
      technologies: technologies ?? [],
    },
    null,
    2,
  )}`;

  const message = await client.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 1536,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const parsed = parseJson(text);
  if (!parsed) throw new Error(`condenseBulletArrays: no JSON in response. Raw: ${text.slice(0, 300)}`);

  const toArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

  return {
    good_fit: toArr(parsed.good_fit),
    bad_fit: toArr(parsed.bad_fit),
    value_propositions: toArr(parsed.value_propositions),
    products: toArr(parsed.products),
    services: toArr(parsed.services),
    technologies: toArr(parsed.technologies),
  };
}
