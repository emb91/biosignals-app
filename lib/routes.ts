export const ROUTES = {
  admin: {
    llmUsage: '/admin/llm-usage',
    signalsTodo: '/admin/signals-todo',
  },
  today: '/today',
  outreach: '/outreach',
  log: '/log',
  gtmBase: '/gtm-base',
  import: '/import',
  contacts: '/contacts',
  companies: '/companies',
  accounts: '/companies',
  legacyAccounts: '/accounts',
  customers: '/customers',
  signals: '/signals',
  settings: '/settings',
  coverage: '/coverage',
  data: '/data',
  contactUs: '/contact-us',
  setup: {
    /** Full-screen guided onboarding (company → ICP → buying team). */
    arcova: '/arcova-setup',
    company: '/my-company',
    profile: '/my-profile',
    icps: '/icps',
    newIcp: '/icps/new',
  },
  leads: {
    contacts: '/contacts',
    accounts: '/companies',
  },
  /** Same-origin REST paths used by fetch(). */
  api: {
    /** List/create/delete ICP definitions (historically `/api/company-criteria`). */
    icps: '/api/icps',
  },
} as const;

export function withQuery(path: string, params: URLSearchParams | string): string {
  const query = typeof params === 'string' ? params : params.toString();
  return query ? `${path}?${query}` : path;
}
