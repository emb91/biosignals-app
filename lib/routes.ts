export const ROUTES = {
  admin: {
    llmUsage: '/admin/llm-usage',
    signalsTodo: '/admin/signals-todo',
  },
  today: '/today',
  gtmBase: '/gtm-base',
  import: '/import',
  signals: '/signals',
  settings: '/settings',
  health: '/health',
  data: '/data',
  contactUs: '/contact-us',
  setup: {
    /** Full-screen guided onboarding (company → ICP → buying team). */
    arcova: '/arcova-setup',
    company: '/my-profile',
    icps: '/company-criteria',
    newIcp: '/company-criteria/new',
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
