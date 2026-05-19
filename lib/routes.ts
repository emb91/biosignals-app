export const ROUTES = {
  admin: {
    llmUsage: '/admin/llm-usage',
    signalsTodo: '/admin/signals-todo',
    signalsTest: '/admin/signals-test',
  },
  today: '/today',
  log: '/log',
  gtmBase: '/gtm-base',
  import: '/import',
  contacts: '/contacts',
  contactSignals: '/contacts/signals',
  accounts: '/accounts',
  accountSignals: '/accounts/signals',
  customers: '/customers',
  signals: '/signals',
  settings: '/settings',
  health: '/health',
  data: '/data',
  contactUs: '/contact-us',
  setup: {
    /** Full-screen guided onboarding (company → ICP → buying team). */
    arcova: '/arcova-setup',
    company: '/my-company',
    icps: '/icps',
    newIcp: '/icps/new',
  },
  leads: {
    contacts: '/leads/contacts',
    accounts: '/leads/accounts',
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
