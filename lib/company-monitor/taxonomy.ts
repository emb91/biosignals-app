/**
 * Company monitor — taxonomy module.
 *
 * Classifies messy company evidence into Arcova's controlled company taxonomy.
 * The LLM may interpret aliases and synonyms, but persisted values must match
 * the canonical options exported from `arcova-taxonomy`.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  COMPANY_TYPE_OPTIONS,
  DEVELOPMENT_STAGE_OPTIONS,
  MODALITY_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  canonicalizeCompanyType,
  canonicalizeModality,
  canonicalizeTherapeuticArea,
  expandModalitiesWithParents,
  type CompanyType,
  type DevelopmentStage,
  type Modality,
  type TherapeuticArea,
} from '@/lib/arcova-taxonomy';
import {
  inferPlatformCategoryFromLegacyModalities,
  normalizePlatformCategory,
} from '@/lib/platform-category';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';
const MAX_CONTEXT_CHARS = 12000;

export type CompanyTaxonomyInput = {
  company_name: string;
  domain?: string | null;
  apify_company_firmographics?: Record<string, unknown> | null;
  apollo_company_firmographics?: Record<string, unknown> | null;
  apollo_organization_raw?: Record<string, unknown> | null;
};

export type CompanyTaxonomyResult = {
  company_type: CompanyType | null;
  company_type_display: string | null;
  /** Short software / platform category for the company itself (e.g. Sales Intelligence Platform). Null for non-software companies. */
  platform_category: string | null;
  /** What THIS company fundamentally works on (their science / product modality). SaaS/vendor often empty. Never copy customer disease areas here because the website mentions oncology. */
  therapeutic_areas: TherapeuticArea[];
  modalities: Modality[];
  /** This company's OWN development maturity (their assets/trials/org). SaaS/vendor often empty. Do not merge buyer pipeline stages here. */
  development_stages: DevelopmentStage[];
  /** Disease / problem spaces of ACCOUNTS they sell into (beachhead). Not "this company is an oncology company" unless they develop drugs in that space. */
  customer_therapeutic_areas: TherapeuticArea[];
  /** Technology / workflow classes of customers they target (e.g. cell therapy labs). Distinct from own modalities. */
  customer_modalities: Modality[];
  /** Development stages of the ACCOUNTS they sell into (e.g. Phase II biotechs). Distinct from own development_stages. */
  customer_development_stages: DevelopmentStage[];
  source: 'llm' | null;
  confidence: 'high' | 'medium' | 'low';
  evidence_summary: string | null;
  checked_at: string;
};

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(value?: string | null): string | null {
  const trimmed = normalizeString(value).toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

async function fetchWebsiteContext(domain?: string | null): Promise<string | null> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  const urls = [
    `https://${normalizedDomain}`,
    `https://${normalizedDomain}/pipeline`,
    `https://${normalizedDomain}/about`,
    `https://${normalizedDomain}/programs`,
    `https://${normalizedDomain}/clinical-trials`,
    `https://${normalizedDomain}/science`,
  ];
  const chunks: string[] = [];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ArcovaTaxonomyBot/1.0)',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) continue;

      const html = await response.text();
      const text = stripHtml(html).slice(0, 5000);
      if (text) chunks.push(`Source: ${url}\n${text}`);
    } catch {
      // Website fetch is best-effort. Claude web search can still fill gaps.
    }
  }

  return chunks.length > 0 ? chunks.join('\n\n').slice(0, MAX_CONTEXT_CHARS) : null;
}

function compactFirmographics(label: string, raw: Record<string, unknown> | null | undefined): string {
  if (!raw) return '';

  const fields = {
    name: raw.name,
    description: raw.description || raw.short_description,
    bio_summary: raw.bio_summary,
    tagline: raw.tagline,
    domain: raw.domain || raw.primary_domain || raw.website_url,
    industry: raw.industry,
    specialties: raw.specialties,
    technologies: raw.technology_names,
    current_technologies: raw.current_technologies,
    funding_stage: raw.funding_stage,
  };

  const cleaned = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(normalizeString(value));
    })
  );

  return Object.keys(cleaned).length > 0
    ? `${label}:\n${JSON.stringify(cleaned, null, 2)}`
    : '';
}

function canonicalizeArray<T extends string>(
  values: unknown,
  canonicalize: (value: unknown) => T | null
): T[] {
  const items = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  const result: T[] = [];

  for (const item of items) {
    const canonical = canonicalize(item);
    if (canonical && !result.includes(canonical)) result.push(canonical);
  }

  return result;
}

function normalizeConfidence(value: unknown): CompanyTaxonomyResult['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function canonicalizeDevelopmentStage(value: unknown): DevelopmentStage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (
    (DEVELOPMENT_STAGE_OPTIONS as readonly string[]).find(
      (opt) => opt.toLowerCase() === normalized
    ) as DevelopmentStage | undefined
  ) ?? null;
}

function parseTaxonomyJson(text: string): {
  company_type?: unknown;
  company_type_display?: unknown;
  platform_category?: unknown;
  therapeutic_areas?: unknown;
  modalities?: unknown;
  development_stages?: unknown;
  customer_therapeutic_areas?: unknown;
  customer_modalities?: unknown;
  customer_development_stages?: unknown;
  confidence?: unknown;
  evidence_summary?: unknown;
} | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function normalizeCompanyTaxonomyResult(
  parsed: {
    company_type?: unknown;
    company_type_display?: unknown;
    platform_category?: unknown;
    therapeutic_areas?: unknown;
    modalities?: unknown;
    development_stages?: unknown;
    customer_therapeutic_areas?: unknown;
    customer_modalities?: unknown;
    customer_development_stages?: unknown;
    confidence?: unknown;
    evidence_summary?: unknown;
  } | null,
  checkedAt = new Date().toISOString()
): CompanyTaxonomyResult {
  const companyType = canonicalizeCompanyType(parsed?.company_type);
  const rawDisplay = normalizeString(parsed?.company_type_display);
  const companyTypeDisplay = rawDisplay || (companyType ?? null);
  const platformCategory =
    normalizePlatformCategory(parsed?.platform_category) ??
    inferPlatformCategoryFromLegacyModalities(parsed?.modalities);
  const therapeuticAreas = canonicalizeArray(parsed?.therapeutic_areas, canonicalizeTherapeuticArea);
  const modalities = expandModalitiesWithParents(
    canonicalizeArray(parsed?.modalities, canonicalizeModality)
  );
  const developmentStages = canonicalizeArray(parsed?.development_stages, canonicalizeDevelopmentStage);
  const customerTherapeuticAreas = canonicalizeArray(
    parsed?.customer_therapeutic_areas,
    canonicalizeTherapeuticArea
  );
  const customerModalities = expandModalitiesWithParents(
    canonicalizeArray(parsed?.customer_modalities, canonicalizeModality)
  );
  const customerDevelopmentStages = canonicalizeArray(
    parsed?.customer_development_stages,
    canonicalizeDevelopmentStage
  );

  return {
    company_type: companyType,
    company_type_display: companyTypeDisplay,
    platform_category: platformCategory,
    therapeutic_areas: therapeuticAreas,
    modalities,
    development_stages: developmentStages,
    customer_therapeutic_areas: customerTherapeuticAreas,
    customer_modalities: customerModalities,
    customer_development_stages: customerDevelopmentStages,
    source: parsed ? 'llm' : null,
    confidence: normalizeConfidence(parsed?.confidence),
    evidence_summary: normalizeString(parsed?.evidence_summary) || null,
    checked_at: checkedAt,
  };
}

export async function resolveCompanyTaxonomy(
  input: CompanyTaxonomyInput
): Promise<CompanyTaxonomyResult> {
  const checkedAt = new Date().toISOString();
  const websiteContext = await fetchWebsiteContext(input.domain);

  const evidenceParts = [
    compactFirmographics('Apify/LinkedIn company context', input.apify_company_firmographics),
    compactFirmographics('Apollo company context', input.apollo_company_firmographics),
    compactFirmographics('Apollo organization raw context', input.apollo_organization_raw),
    websiteContext ? `Website context:\n${websiteContext}` : '',
  ].filter(Boolean);

  const prompt = `You classify life sciences companies into Arcova's controlled taxonomy — using TWO SEPARATE PLANES that must never be mixed.

CRITICAL RULE — read this before anything else:
If the company is a SaaS, data platform, sales intelligence tool, CRM, BI vendor, or any software-first business:
  • company_type should usually be "SaaS" for commercial workflow, data, intelligence, GTM, CRM, or research software platforms.
  • Use "Digital Health & Informatics" only when the software is fundamentally patient-facing, clinical, care-delivery, provider workflow, or healthcare informatics.
  • platform_category should capture the company's software / product type in a short label such as "Sales Intelligence Platform", "Scientific Content Platform", or "Analytics Platform".
  • platform_category must be 1–4 words, Title Case, noun-phrase style, and must not contain "and".
  • therapeutic_areas MUST be [] — disease areas seen on the website are their CUSTOMERS' areas, not theirs.
  • modalities MUST stay [] unless the company truly has its own scientific / therapeutic modality.
  • Do NOT use an AI label just because the website mentions AI features or algorithms. Use an AI platform category only when the core product is meaningfully an AI platform.
  • development_stages MUST be [] — they have no drug pipeline.
  • Put disease areas, drug modalities, and trial stages into customer_* fields instead.

WORKED EXAMPLE — sales intelligence / BI platform (e.g. a company like BioIntelli or SciLeads):
Website says: "We help oncology and neuroscience drug developers find leads. Our AI covers small molecule and cell therapy programs across Phase I–III."
CORRECT output:
{
  "company_type": "SaaS",
  "platform_category": "Sales Intelligence Platform",
  "therapeutic_areas": [],
  "modalities": [],
  "development_stages": [],
  "customer_therapeutic_areas": ["Oncology", "Neuroscience"],
  "customer_modalities": ["Small Molecule", "Cell Therapy"],
  "customer_development_stages": ["Phase I", "Phase II", "Phase III"]
}
WRONG output (do NOT do this):
{
  "platform_category": null,
  "therapeutic_areas": ["Oncology", "Neuroscience"],
  "modalities": ["Small Molecule", "Cell Therapy"],
  "customer_therapeutic_areas": []
}

PLANE A — THIS COMPANY (what THEY are / what THEY build):
- platform_category, therapeutic_areas, modalities, development_stages describe only the company's own product/science/organisational maturity.
- SaaS / BI / data vendors: company_type is usually "SaaS"; platform_category should usually be populated; therapeutic_areas = [], drug modalities = [], development_stages = [].
- If the product is a GTM, prospecting, sales, or intelligence tool for life sciences, prefer specific categories like Sales Intelligence Platform, Commercial Intelligence Platform, Scientific Content Platform, or Analytics Platform over a generic AI label.
- Reserve "Digital Health & Informatics" for companies whose core product is used in patient care, clinical decision support, provider workflow, healthcare operations, or digital therapeutics.
- Biotech / Pharma / device / diagnostic developers: therapeutic_areas and modalities from their OWN pipeline; development_stages from their OWN assets/trials (use web search for current clinical phase).
- CDMO / CRO / contract lab: PLANE A modalities and development_stages may reflect what THEY operationally handle; still split customer beachhead into PLANE B when the site describes WHO they sell to.

PLANE B — CUSTOMERS SERVED (beachhead / who buys from them):
- customer_therapeutic_areas, customer_modalities, customer_development_stages describe target accounts and buying contexts — diseases, customer science workflows, or trial phases OF THE ACCOUNTS THEY SELL INTO.
- For software/data companies: disease areas and drug modalities mentioned on the site almost always belong here, not in PLANE A.
- Pure therapeutic developers focused only on their asset: usually leave all customer_* fields empty ([]) unless there is explicit separate beachhead messaging.

General rules:
- Same allowed vocabulary lists for TA and modalities in BOTH planes; development stages use the development_stages list for BOTH planes.
- platform_category is free-form but constrained: 1–4 words, Title Case, no "and", no slogans, no sentences.
- Therapeutic areas must be disease/problem spaces, not buzzwords.
- modalities include parent modalities when a specific child applies (e.g. CAR-T → Cell Therapy).
- evidence_summary must explicitly mention both planes when both are non-empty (e.g. "Own: SaaS sales intelligence platform; customer: oncology/neuroscience biotechs in Phase I–III").
- If evidence is weak, return fewer values and lower confidence — do not fabricate.

Company: ${input.company_name}
Domain: ${input.domain || 'unknown'}

Allowed company_type values:
${COMPANY_TYPE_OPTIONS.map((option) => `- ${option.value}: ${option.description}`).join('\n')}

Allowed therapeutic_areas values (PLANE A and PLANE B):
${THERAPEUTIC_AREA_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed modalities values (PLANE A and PLANE B):
${MODALITY_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed development_stages values (PLANE A and PLANE B):
${DEVELOPMENT_STAGE_OPTIONS.map((option) => `- ${option}`).join('\n')}

Evidence:
${evidenceParts.join('\n\n') || 'No scraped evidence available.'}

Web search: for drug developers' own trial phase, search "[company name] clinical trial phase" or "[company name] pipeline". For Academic / Research Institute own work, you may use ["Preclinical"] without search when appropriate.

Return ONLY valid JSON:
{
  "company_type": "<one allowed company_type or null>",
  "company_type_display": "<short human-readable label, always populated>",
  "platform_category": "<1-4 word Title Case software/product category for the company itself, or null>",
  "therapeutic_areas": [],
  "modalities": [],
  "development_stages": [],
  "customer_therapeutic_areas": [],
  "customer_modalities": [],
  "customer_development_stages": [],
  "confidence": "<high|medium|low>",
  "evidence_summary": "<one or two sentences — PLANE A vs PLANE B>"
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1100,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 3,
      } as Parameters<typeof client.messages.create>[0]['tools'] extends Array<infer T> ? T : never,
    ],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  return normalizeCompanyTaxonomyResult(parseTaxonomyJson(text), checkedAt);
}
