import { enrichContactWithApollo, type ApolloEnrichmentResult } from '@/lib/apollo';
import { enrichContactWithFiber, type FiberEnrichmentResult } from '@/lib/fiber';

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

export type EnrichmentProviderName = 'apollo' | 'fiber';

export type EnrichmentResult = Partial<ApolloEnrichmentResult & FiberEnrichmentResult> & {
  provider: EnrichmentProviderName;
};

export function getActiveEnrichmentProvider(): EnrichmentProviderName {
  return process.env.ENRICHMENT_PROVIDER === 'fiber' ? 'fiber' : 'apollo';
}

export async function enrichContact(input: EnrichmentLookupInput): Promise<EnrichmentResult> {
  const provider = getActiveEnrichmentProvider();

  if (provider === 'fiber') {
    return {
      ...(await enrichContactWithFiber(input)),
      provider,
    };
  }

  return {
    ...(await enrichContactWithApollo(input)),
    provider,
  };
}
