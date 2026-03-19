export const SIGNAL_DISPLAY_NAMES: Record<string, string> = {
  new_funding: 'New funding round',
  ipo: 'IPO',
  grant_award: 'Grant award',
  partnership_deal: 'Partnership or licensing deal',
  ma: 'M&A',
  clinical_trial: 'Clinical trial registered',
  phase_transition: 'Phase transition',
  indication_expansion: 'New indication expansion',
  breakthrough_designation: 'Breakthrough / fast track designation',
  fda_approval: 'FDA approval or clearance',
  cmc_hire: 'CMC / manufacturing hire',
  clinical_ops_hire: 'Clinical operations hire',
  bd_hire: 'BD or partnerships hire',
  regulatory_hire: 'Regulatory affairs hire',
  csuite_hire: 'C-suite or VP hire',
  job_surge: 'Job postings surge',
  company_founded: 'Company founded',
  new_facility: 'New office or facility',
  conference_presentation: 'Conference presentation or poster',
  publication: 'Publication in peer-reviewed journal',
  press_release: 'Press release or news mention',
};

const prettifySignalId = (signalId: string) =>
  signalId
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const getSignalDisplayName = (signalValue?: string | null, fallback = 'Signal updated') => {
  if (!signalValue) return fallback;

  const normalized = signalValue.trim();
  if (!normalized) return fallback;

  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.id === 'string') {
        return SIGNAL_DISPLAY_NAMES[parsed.id] || parsed.name || prettifySignalId(parsed.id);
      }
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        return parsed.name.trim();
      }
    }
  } catch {
    // Not JSON, continue below.
  }

  return SIGNAL_DISPLAY_NAMES[normalized] || prettifySignalId(normalized);
};
