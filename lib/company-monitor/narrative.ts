/**
 * Company narrative module — resolves products_services, services, technologies
 * for a lead company using Claude web_search.
 *
 * Skips enrichment if all three fields are already populated to avoid
 * redundant API calls on re-enrichment runs.
 */

import { analyseCompanyWithClaude } from '@/lib/my-company-enrichment';

export type CompanyNarrativeInput = {
  company_id: string;
  company_name: string;
  domain?: string | null;
  website?: string | null;
};

export type CompanyNarrativeResult = {
  skipped: boolean;
  products_services: string[] | null;
  services: string[] | null;
  technologies: string[] | null;
};

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return filtered.length > 0 ? filtered : null;
}

export async function resolveCompanyNarrative(
  input: CompanyNarrativeInput,
  existingRow?: { products_services?: string[] | null; services?: string[] | null; technologies?: string[] | null } | null
): Promise<CompanyNarrativeResult> {
  // Skip if all three fields are already populated
  if (
    existingRow?.products_services?.length &&
    existingRow?.services?.length &&
    existingRow?.technologies?.length
  ) {
    return {
      skipped: true,
      products_services: existingRow.products_services,
      services: existingRow.services,
      technologies: existingRow.technologies,
    };
  }

  const website =
    input.website?.trim() ||
    (input.domain ? `https://${input.domain}` : null);

  if (!website) {
    return { skipped: true, products_services: null, services: null, technologies: null };
  }

  const narrative = await analyseCompanyWithClaude(website);

  return {
    skipped: false,
    products_services: toStringArray(narrative.products),
    services: toStringArray(narrative.services),
    technologies: toStringArray(narrative.technologies),
  };
}
