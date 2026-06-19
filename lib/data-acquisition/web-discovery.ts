import { completeWithWebSearch } from '@/lib/llm-client';
import type { DiscoveredCompany } from '@/lib/data-acquisition/apollo-discovery';
import type { AcquisitionIcp } from '@/lib/data-acquisition/search-spec';

type WebCompanyCandidate = {
  name?: string | null;
  domain?: string | null;
  linkedin_url?: string | null;
  description?: string | null;
};

function normalizeDomain(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!cleaned || cleaned.includes('linkedin.com') || cleaned.includes('facebook.com')) return null;
  return cleaned;
}

function cleanList(values: Array<string | null | undefined> | null | undefined, limit = 8): string[] {
  return [...new Set((values || []).map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .slice(0, limit);
}

function parseJsonArray(text: string): WebCompanyCandidate[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return Array.isArray(parsed) ? (parsed as WebCompanyCandidate[]) : [];
  } catch {
    return [];
  }
}

export async function discoverCompaniesWithWebSearch(params: {
  icp: AcquisitionIcp;
  targetCompanyCount: number;
}): Promise<DiscoveredCompany[]> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) return [];

  const icp = params.icp;
  const prompt = `Find up to ${Math.min(25, Math.max(5, params.targetCompanyCount))} real companies that match this ICP.

Return only a JSON array. Each item:
{
  "name": "Company name",
  "domain": "official website domain",
  "linkedin_url": "official LinkedIn company page or null",
  "description": "one sentence explaining why it matches"
}

Rules:
- Companies must be operating businesses, not news articles, directories, or databases.
- Prefer official domains. Do not return linkedin.com as the domain.
- Avoid obvious duplicates.

ICP:
- Name: ${icp.name || 'Unnamed ICP'}
- Company type: ${icp.company_type || 'Any'}
- Platform category: ${icp.platform_category || 'Any'}
- Therapeutic areas: ${cleanList(icp.therapeutic_areas).join(', ') || 'Any'}
- Modalities: ${cleanList(icp.modalities).join(', ') || 'Any'}
- Development stages: ${cleanList(icp.development_stages).join(', ') || 'Any'}
- Customer/buyer hints: ${cleanList([...(icp.target_customers || []), ...(icp.buyer_types || [])]).join(', ') || 'Any'}
`;

  const completion = await completeWithWebSearch({
    feature: 'web_company_discovery',
    prompt,
    maxTokens: 1600,
    maxSearches: 5,
  });

  const candidates = parseJsonArray(completion.text);
  const seen = new Set<string>();
  const companies: DiscoveredCompany[] = [];
  for (const candidate of candidates) {
    const name = candidate.name?.trim();
    const domain = normalizeDomain(candidate.domain);
    if (!name || !domain || seen.has(domain)) continue;
    seen.add(domain);
    companies.push({
      source: 'web_search',
      source_id: null,
      name,
      domain,
      linkedin_url: candidate.linkedin_url?.trim() || null,
      employee_count: null,
      raw: {
        name,
        primary_domain: domain,
        website_url: `https://${domain}`,
        linkedin_url: candidate.linkedin_url?.trim() || null,
        short_description: candidate.description || null,
      },
    });
  }
  return companies.slice(0, params.targetCompanyCount);
}
