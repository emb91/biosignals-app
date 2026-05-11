export const ROUTES = {
  today: '/today',
  gtmBase: '/gtm-base',
  import: '/import',
  signals: '/signals',
  settings: '/settings',
  health: '/health',
  data: '/data',
  contactUs: '/contact-us',
  setup: {
    company: '/my-profile',
    icps: '/company-criteria',
    newIcp: '/company-criteria/new',
    personas: '/personas',
    newPersona: '/personas/new',
  },
  leads: {
    contacts: '/leads/contacts',
    accounts: '/leads/accounts',
  },
} as const;

export function withQuery(path: string, params: URLSearchParams | string): string {
  const query = typeof params === 'string' ? params : params.toString();
  return query ? `${path}?${query}` : path;
}
