export const ROUTES = {
  agentLab: '/agent-lab',
  briefing: '/briefing',
  dashboard: '/dashboard',
  import: '/import',
  signals: '/signals',
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
    health: '/leads/health',
    data: '/leads/data',
  },
} as const;

export const LEGACY_ROUTES = {
  contacts: '/results',
  accounts: '/accounts',
  health: '/health',
  data: '/data',
  pipeline: '/pipeline',
} as const;

export function withQuery(path: string, params: URLSearchParams | string): string {
  const query = typeof params === 'string' ? params : params.toString();
  return query ? `${path}?${query}` : path;
}
