export type SignalScope = 'company' | 'contact';

export type SignalCategory =
  | 'Funding & Financial'
  | 'Pipeline & Clinical'
  | 'Hiring & Team'
  | 'Corporate & Strategic'
  | 'Career & Role Changes'
  | 'Activity & Network';

export type SignalDefinition = {
  id: string;
  scope: SignalScope;
  displayName: string;
  category: SignalCategory;
  baseWeight: number;
  description: string;
};

export const SIGNAL_CATALOG: SignalDefinition[] = [
  {
    id: 'new_funding',
    scope: 'company',
    displayName: 'New funding round',
    category: 'Funding & Financial',
    baseWeight: 1,
    description: 'A financing round often signals budget, momentum, and near-term new work.',
  },
  {
    id: 'ipo',
    scope: 'company',
    displayName: 'IPO or public listing',
    category: 'Funding & Financial',
    baseWeight: 0.95,
    description: 'Public listing activity suggests a major transition with increased urgency and spend.',
  },
  {
    id: 'grant_award',
    scope: 'company',
    displayName: 'Grant award',
    category: 'Funding & Financial',
    baseWeight: 0.8,
    description: 'A grant award can unlock a funded workstream with fresh operational needs.',
  },
  {
    id: 'partnership_deal',
    scope: 'company',
    displayName: 'Partnership or licensing deal',
    category: 'Funding & Financial',
    baseWeight: 0.9,
    description: 'A partnership or licensing deal often introduces new execution and diligence work.',
  },
  {
    id: 'ma',
    scope: 'company',
    displayName: 'M&A',
    category: 'Funding & Financial',
    baseWeight: 0.85,
    description: 'M&A activity can create integration, expansion, and strategic change.',
  },
  {
    id: 'clinical_trial',
    scope: 'company',
    displayName: 'Clinical trial registered',
    category: 'Pipeline & Clinical',
    baseWeight: 0.9,
    description: 'A newly registered trial usually marks a concrete execution phase.',
  },
  {
    id: 'phase_transition',
    scope: 'company',
    displayName: 'Phase transition',
    category: 'Pipeline & Clinical',
    baseWeight: 0.95,
    description: 'Moving into a new development phase often creates fresh operational demand.',
  },
  {
    id: 'indication_expansion',
    scope: 'company',
    displayName: 'New indication expansion',
    category: 'Pipeline & Clinical',
    baseWeight: 0.8,
    description: 'Expanding into a new indication suggests growth and additional program complexity.',
  },
  {
    id: 'breakthrough_designation',
    scope: 'company',
    displayName: 'Breakthrough / fast track designation',
    category: 'Pipeline & Clinical',
    baseWeight: 0.85,
    description: 'Regulatory acceleration can compress timelines and increase urgency.',
  },
  {
    id: 'fda_approval',
    scope: 'company',
    displayName: 'FDA approval or clearance',
    category: 'Pipeline & Clinical',
    baseWeight: 0.9,
    description: 'Approval or clearance often precedes launch and scale-up.',
  },
  {
    id: 'cmc_hire',
    scope: 'company',
    displayName: 'CMC / manufacturing hire',
    category: 'Hiring & Team',
    baseWeight: 0.75,
    description: 'Targeted CMC or manufacturing hiring can indicate ramp-up or production planning.',
  },
  {
    id: 'clinical_ops_hire',
    scope: 'company',
    displayName: 'Clinical operations hire',
    category: 'Hiring & Team',
    baseWeight: 0.75,
    description: 'Clinical operations hiring suggests active trial execution or expansion.',
  },
  {
    id: 'bd_hire',
    scope: 'company',
    displayName: 'BD or partnerships hire',
    category: 'Hiring & Team',
    baseWeight: 0.7,
    description: 'A BD or partnerships hire often signals strategic growth motion.',
  },
  {
    id: 'regulatory_hire',
    scope: 'company',
    displayName: 'Regulatory affairs hire',
    category: 'Hiring & Team',
    baseWeight: 0.7,
    description: 'Regulatory hiring can indicate upcoming submissions or more active compliance work.',
  },
  {
    id: 'csuite_hire',
    scope: 'company',
    displayName: 'C-suite or VP hire',
    category: 'Hiring & Team',
    baseWeight: 0.8,
    description: 'A leadership hire can signal a strategic shift or a new buying champion.',
  },
  {
    id: 'job_surge',
    scope: 'company',
    displayName: 'Job postings surge',
    category: 'Hiring & Team',
    baseWeight: 0.7,
    description: 'A hiring surge often suggests investment, growth, and new infrastructure needs.',
  },
  {
    id: 'company_founded',
    scope: 'company',
    displayName: 'Company founded or incorporated',
    category: 'Corporate & Strategic',
    baseWeight: 0.55,
    description: 'A newly formed company can signal an early buying window and new setup needs.',
  },
  {
    id: 'new_facility',
    scope: 'company',
    displayName: 'New office or facility',
    category: 'Corporate & Strategic',
    baseWeight: 0.7,
    description: 'A new facility often signals expansion and operational investment.',
  },
  {
    id: 'conference_presentation',
    scope: 'company',
    displayName: 'Conference presentation or poster',
    category: 'Corporate & Strategic',
    baseWeight: 0.6,
    description: 'Conference activity can signal active programs and market visibility.',
  },
  {
    id: 'publication',
    scope: 'company',
    displayName: 'Publication in peer-reviewed journal',
    category: 'Corporate & Strategic',
    baseWeight: 0.55,
    description: 'A publication can indicate scientific momentum or validation.',
  },
  {
    id: 'press_release',
    scope: 'company',
    displayName: 'Press release or news mention',
    category: 'Corporate & Strategic',
    baseWeight: 0.45,
    description: 'A press release can be a useful weak signal of recent movement.',
  },
  {
    id: 'new_to_role',
    scope: 'contact',
    displayName: 'New to role',
    category: 'Career & Role Changes',
    baseWeight: 0.9,
    description: 'A new role often creates a reason to reassess systems and partners.',
  },
  {
    id: 'recently_promoted',
    scope: 'contact',
    displayName: 'Recently promoted',
    category: 'Career & Role Changes',
    baseWeight: 0.8,
    description: 'A promotion can increase budget influence and decision-making authority.',
  },
  {
    id: 'recently_changed_company',
    scope: 'contact',
    displayName: 'Recently changed company',
    category: 'Career & Role Changes',
    baseWeight: 1,
    description: 'A company move is often one of the strongest signals of an open buying window.',
  },
  {
    id: 'active_on_linkedin',
    scope: 'contact',
    displayName: 'Active on LinkedIn',
    category: 'Activity & Network',
    baseWeight: 0.5,
    description: 'Public activity can be a weak signal of current professional focus.',
  },
  {
    id: 'network_overlap',
    scope: 'contact',
    displayName: 'Connected to similar companies',
    category: 'Activity & Network',
    baseWeight: 0.45,
    description: 'Network overlap can suggest proximity to similar buying motions.',
  },
];

export const COMPANY_SIGNALS = SIGNAL_CATALOG.filter((signal) => signal.scope === 'company');
export const CONTACT_SIGNALS = SIGNAL_CATALOG.filter((signal) => signal.scope === 'contact');

export const getSignalById = (signalId: string) =>
  SIGNAL_CATALOG.find((signal) => signal.id === signalId) ?? null;
