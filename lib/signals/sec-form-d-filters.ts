const IGNORED_FORM_D_INDUSTRY_GROUPS = new Set(['pooled investment fund']);

function normalizeSecTaxonomyValue(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function shouldSkipFormDFundingSignal(filing: {
  industry_group_type: string | null;
}): boolean {
  return IGNORED_FORM_D_INDUSTRY_GROUPS.has(
    normalizeSecTaxonomyValue(filing.industry_group_type),
  );
}
