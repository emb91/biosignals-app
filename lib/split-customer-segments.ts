export function splitCustomerSegments(items: string[]) {
  const buyerKeywords = [
    'officer', 'director', 'manager', 'head', 'lead', 'buyer', 'stakeholder', 'procurement',
    'operations', 'sales', 'marketing', 'commercial', 'revops', 'clinical', 'scientist',
    'researcher', 'oncologist', 'physician', 'provider', 'nurse', 'administrator', 'it',
    'finance', 'compliance', 'regulatory', 'partnerships', 'business development', 'team',
    'department', 'function', 'leadership', 'executive',
  ];

  const companyKeywords = [
    'biotech', 'biopharma', 'pharma', 'health system', 'hospital', 'clinic', 'lab', 'laboratory',
    'cro', 'cdmo', 'cmo', 'manufacturer', 'distributor', 'academic', 'university', 'medical center',
    'provider group', 'diagnostic', 'life science', 'enterprise', 'startup', 'company', 'companies',
    'organizations', 'organisation',
  ];

  const buyerTypes: string[] = [];
  const customerOrganizations: string[] = [];
  const uncategorized: string[] = [];

  items.forEach((item) => {
    const normalized = item.trim().toLowerCase();
    if (!normalized) return;

    const isBuyerType = buyerKeywords.some((keyword) => normalized.includes(keyword));
    const isCompanyType = companyKeywords.some((keyword) => normalized.includes(keyword));

    if (isBuyerType && !isCompanyType) {
      buyerTypes.push(item);
      return;
    }

    if (isCompanyType) {
      customerOrganizations.push(item);
      return;
    }

    uncategorized.push(item);
  });

  return {
    customerOrganizations: [...customerOrganizations, ...uncategorized],
    buyerTypes,
  };
}
