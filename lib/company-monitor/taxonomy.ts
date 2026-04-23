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
  MODALITY_OPTIONS,
  THERAPEUTIC_AREA_OPTIONS,
  canonicalizeCompanyType,
  canonicalizeModality,
  canonicalizeTherapeuticArea,
  expandModalitiesWithParents,
  type CompanyType,
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
  therapeutic_areas: TherapeuticArea[];
  modalities: Modality[];
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

  const urls = [`https://${normalizedDomain}`, `https://${normalizedDomain}/pipeline`, `https://${normalizedDomain}/about`];
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

function parseTaxonomyJson(text: string): {
  company_type?: unknown;
  therapeutic_areas?: unknown;
  modalities?: unknown;
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
    therapeutic_areas?: unknown;
    modalities?: unknown;
    confidence?: unknown;
    evidence_summary?: unknown;
  } | null,
  checkedAt = new Date().toISOString()
): CompanyTaxonomyResult {
  const companyType = canonicalizeCompanyType(parsed?.company_type);
  const therapeuticAreas = canonicalizeArray(parsed?.therapeutic_areas, canonicalizeTherapeuticArea);
  const modalities = expandModalitiesWithParents(
    canonicalizeArray(parsed?.modalities, canonicalizeModality)
  );

  return {
    company_type: companyType,
    therapeutic_areas: therapeuticAreas,
    modalities,
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

  const prompt = `You classify life sciences companies into Arcova's controlled taxonomy.

Company: ${input.company_name}
Domain: ${input.domain || 'unknown'}

Allowed company_type values:
${COMPANY_TYPE_OPTIONS.map((option) => `- ${option.value}: ${option.description}`).join('\n')}

Allowed therapeutic_areas values:
${THERAPEUTIC_AREA_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed modalities values:
${MODALITY_OPTIONS.map((option) => `- ${option}`).join('\n')}

Evidence:
${evidenceParts.join('\n\n') || 'No scraped evidence available.'}

Instructions:
1. Use the evidence and, if needed, web search for the company domain/name.
2. Map messy language and synonyms into the allowed values only.
3. Therapeutic areas must be disease/problem spaces, not technologies.
4. Modalities are product or technology approaches. If a specific modality applies, include its parent too when relevant, e.g. Cell Therapy and CAR-T.
5. Return all relevant therapeutic areas and modalities, strongest first.
6. If uncertain, return empty arrays or null rather than inventing labels.

Return ONLY valid JSON:
{
  "company_type": "<one allowed company_type or null>",
  "therapeutic_areas": ["<allowed therapeutic area>", "..."],
  "modalities": ["<allowed modality>", "..."],
  "confidence": "<high|medium|low>",
  "evidence_summary": "<one sentence explaining the strongest evidence>"
}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: evidenceParts.length >= 2 ? 1 : 3,
      } as Parameters<typeof client.messages.create>[0]['tools'] extends Array<infer T> ? T : never,
    ],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  return normalizeCompanyTaxonomyResult(parseTaxonomyJson(text), checkedAt);
}
