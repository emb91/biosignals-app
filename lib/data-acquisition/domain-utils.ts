export function normalizeCompanyDomain(value: string | null | undefined): string | null {
  const cleaned = (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  return cleaned || null;
}

export function firstCompanyDomain(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const domain = normalizeCompanyDomain(value);
    if (domain) return domain;
  }
  return null;
}
