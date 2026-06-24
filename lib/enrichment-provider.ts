import {
  enrichContactWithApollo,
  bulkEnrichContactsWithApollo,
  type ApolloEnrichmentResult,
} from '@/lib/apollo';

export type EnrichmentLookupInput = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  company_domain?: string;
  job_title?: string;
  email?: string;
  linkedin_url?: string;
  company_linkedin_url?: string;
  location?: string;
  /** Apollo person id from search — strongest people/match key (see ApolloLookupInput). */
  apollo_person_id?: string;
};

export type EnrichmentResult = ApolloEnrichmentResult & {
  provider: 'apollo';
};

export async function enrichContact(input: EnrichmentLookupInput): Promise<EnrichmentResult> {
  return {
    ...(await enrichContactWithApollo(input)),
    provider: 'apollo',
  };
}

/**
 * Bulk variant of `enrichContact` — enriches up to 10 contacts per Apollo
 * people/bulk_match call instead of one match per contact. Index-aligned to
 * `inputs`. Used by the enrichment queue to cut Apollo round-trips ~10× when
 * the user enriches a batch of triaged contacts.
 */
export async function enrichContacts(inputs: EnrichmentLookupInput[]): Promise<EnrichmentResult[]> {
  const results = await bulkEnrichContactsWithApollo(inputs);
  return results.map((result) => ({ ...result, provider: 'apollo' as const }));
}
