export const ACCOUNT_SWEEP_SOURCES = [
  'hiring',
  'publications',
  'patents',
  'press_releases',
  'funding',
  'grants',
  'fda_regulatory',
  'clinical_trials',
  'conferences',
] as const;

export const CONTACT_SWEEP_SOURCES = [
  'job_change',
  'publications',
  'conference_presenters',
  'conference_social',
] as const;

export type AccountSweepSource = typeof ACCOUNT_SWEEP_SOURCES[number];
export type ContactSweepSource = typeof CONTACT_SWEEP_SOURCES[number];
