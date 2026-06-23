export type CompanyEnrichmentCreditResult = {
  status: 'succeeded' | 'failed';
};

export type CompanyEnrichmentCreditDisposition = 'settle' | 'refund';

export function companyEnrichmentCreditDisposition(
  result: CompanyEnrichmentCreditResult,
): CompanyEnrichmentCreditDisposition {
  return result.status === 'succeeded' ? 'settle' : 'refund';
}
