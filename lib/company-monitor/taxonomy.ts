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
  therapeutic_areas: TherapeuticArea[];
  modalities: Modality[];
  development_stages: DevelopmentStage[];
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
  therapeutic_areas?: unknown;
  modalities?: unknown;
  development_stages?: unknown;
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
    therapeutic_areas?: unknown;
    modalities?: unknown;
    development_stages?: unknown;
    confidence?: unknown;
    evidence_summary?: unknown;
  } | null,
  checkedAt = new Date().toISOString()
): CompanyTaxonomyResult {
  const companyType = canonicalizeCompanyType(parsed?.company_type);
  const rawDisplay = normalizeString(parsed?.company_type_display);
  const companyTypeDisplay = rawDisplay || (companyType ?? null);
  const therapeuticAreas = canonicalizeArray(parsed?.therapeutic_areas, canonicalizeTherapeuticArea);
  const modalities = expandModalitiesWithParents(
    canonicalizeArray(parsed?.modalities, canonicalizeModality)
  );
  const developmentStages = canonicalizeArray(parsed?.development_stages, canonicalizeDevelopmentStage);

  return {
    company_type: companyType,
    company_type_display: companyTypeDisplay,
    therapeutic_areas: therapeuticAreas,
    modalities,
    development_stages: developmentStages,
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

  const VENDOR_TYPES = new Set([
    'CDMO',
    'CRO',
    'Life Science Tools & Instruments',
    'Contract Lab & Testing Services',
    'Digital Health & Informatics',
  ]);

  const prompt = `You classify life sciences companies into Arcova's controlled taxonomy.

Company: ${input.company_name}
Domain: ${input.domain || 'unknown'}

Allowed company_type values:
${COMPANY_TYPE_OPTIONS.map((option) => `- ${option.value}: ${option.description}`).join('\n')}

Allowed therapeutic_areas values:
${THERAPEUTIC_AREA_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed modalities values:
${MODALITY_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed development_stages values:
${DEVELOPMENT_STAGE_OPTIONS.map((option) => `- ${option}`).join('\n')}

Evidence:
${evidenceParts.join('\n\n') || 'No scraped evidence available.'}

Classification rules:

Step 1 — Determine company_type from the evidence.

Step 2 — Determine classification mode based on company_type:
- THERAPEUTIC MODE: company_type is Biotech / Biopharma, Pharma, Medical Device, Diagnostics, or Academic Spinout.
  → Classify therapeutic_areas and modalities from the company's OWN pipeline, assets, platform, or indications.
- VENDOR MODE: company_type is CDMO, CRO, Life Science Tools & Instruments, Contract Lab & Testing Services, or Digital Health & Informatics.
  → Classify therapeutic_areas and modalities from the CUSTOMER SEGMENTS and LAB WORKFLOWS the company serves — not from what the company itself does.
  → Example: a lab monitoring company serving cell therapy and gene therapy labs should return those as modalities, even though it makes no therapies itself.
  → Prefer a populated classification over blank fields when customer-side evidence supports it.
- UNKNOWN / OTHER: use any concrete signal from website or enrichment. Explain reasoning.

Step 3 — Apply these rules to all modes:
- Therapeutic areas must be disease/problem spaces, not technologies.
- Modalities are product/technology approaches. If a specific modality applies, include its parent too (e.g. CAR-T → also Cell Therapy).
- Return all relevant values, strongest first. In vendor mode, include all customer segments with supporting evidence.
- If evidence is weak, return fewer values with lower confidence — do not fabricate.
- Always populate company_type_display with a short human-readable label (e.g. "Venture Capital", "Lab Monitoring Software", "Management Consulting"). If company_type matches, use the same value.
- Always populate evidence_summary with one sentence explaining what the classification is based on, and whether it reflects the company's own work or its served customer segments.
- For development_stages: only populate for Biotech / Biopharma, Pharma, Academic Spinout, Academic / Research Institute, CRO, and CDMO. Leave empty for all other company types. For therapeutic developers (Biotech / Biopharma, Pharma, Academic Spinout), you MUST use web search to find their current clinical trial phase — search for "[company name] clinical trial phase" or "[company name] pipeline" to get up-to-date information. Do not rely on scraped website content alone as it is frequently outdated. For Academic / Research Institute, always use ["Preclinical"] without searching. For CROs and CDMOs, infer from the trial phases or manufacturing stages they serve. If a company spans multiple stages, include all that apply. Use "All stages" only for large organisations clearly operating across the full development spectrum. Always classify the most advanced stage the company has reached.

Return ONLY valid JSON:
{
  "company_type": "<one allowed company_type or null>",
  "company_type_display": "<short human-readable label, always populated>",
  "therapeutic_areas": ["<allowed therapeutic area>", "..."],
  "modalities": ["<allowed modality>", "..."],
  "development_stages": ["<allowed development stage>", "..."],
  "confidence": "<high|medium|low>",
  "evidence_summary": "<one sentence — what evidence was used and whether classification reflects own pipeline or served customers>"
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
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
