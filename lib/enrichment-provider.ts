import { enrichContactWithApollo, type ApolloEnrichmentResult } from '@/lib/apollo';

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
