export type SignalScope = 'company' | 'contact';

export type SignalCategory =
  | 'Funding & Financial'
  | 'Pipeline & Clinical'
  | 'Hiring & Team'
  | 'Corporate & Strategic'
  | 'Career & Role Changes'
  | 'Activity & Network'
  | 'Publications & Recognition'
  | 'First-Party Engagement'
  | 'CRM & Relationship';

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
    id: 'patent_filed_or_granted',
    scope: 'company',
    displayName: 'Patent filed or granted',
    category: 'Corporate & Strategic',
    baseWeight: 0.7,
    description: 'Patent activity signals new IP development, a novel programme direction, or approaching commercialisation.',
  },
  {
    id: 'demo_requested',
    scope: 'company',
    displayName: 'Demo requested',
    category: 'First-Party Engagement',
    baseWeight: 0.95,
    description: 'A demo request is a strong inbound buying signal with clear intent.',
  },
  {
    id: 'inbound_enquiry',
    scope: 'company',
    displayName: 'Inbound enquiry',
    category: 'First-Party Engagement',
    baseWeight: 0.9,
    description: 'An inbound enquiry indicates active interest and a warm outreach opportunity.',
  },
  {
    id: 'visited_your_website',
    scope: 'company',
    displayName: 'Website visit',
    category: 'First-Party Engagement',
    baseWeight: 0.65,
    description: 'A company visiting your website can indicate awareness or active evaluation.',
  },
  {
    id: 'attended_your_webinar_or_event',
    scope: 'company',
    displayName: 'Webinar or event attendee',
    category: 'First-Party Engagement',
    baseWeight: 0.75,
    description: 'Attendance at your event suggests active interest in your domain or offering.',
  },
  {
    id: 'downloaded_your_content',
    scope: 'company',
    displayName: 'Content download',
    category: 'First-Party Engagement',
    baseWeight: 0.65,
    description: 'Downloading content signals research behaviour and topic interest.',
  },
  {
    id: 'open_opportunity_in_crm',
    scope: 'company',
    displayName: 'Open opportunity in CRM',
    category: 'CRM & Relationship',
    baseWeight: 0.9,
    description: 'An open opportunity means this company is already in an active sales motion.',
  },
  {
    id: 'lapsed_customer',
    scope: 'company',
    displayName: 'Lapsed customer',
    category: 'CRM & Relationship',
    baseWeight: 0.85,
    description: 'A lapsed customer represents a warm re-engagement opportunity.',
  },
  {
    id: 'renewal_coming_up',
    scope: 'company',
    displayName: 'Renewal due',
    category: 'CRM & Relationship',
    baseWeight: 0.9,
    description: 'An upcoming renewal is a time-sensitive moment to confirm or expand the relationship.',
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
    id: 'new_internal_role',
    scope: 'contact',
    displayName: 'New internal role',
    category: 'Career & Role Changes',
    baseWeight: 0.75,
    description: 'An internal move can signal expanding responsibilities or a new mandate.',
  },
  {
    id: 'title_change',
    scope: 'contact',
    displayName: 'Title change',
    category: 'Career & Role Changes',
    baseWeight: 0.65,
    description: 'A title change can reflect broadened scope or increased seniority.',
  },
  {
    id: 'board_or_advisory_role',
    scope: 'contact',
    displayName: 'Board or advisory role',
    category: 'Career & Role Changes',
    baseWeight: 0.6,
    description: 'Joining a board or advisory position signals growing influence and network.',
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
  {
    id: 'new_paper_published',
    scope: 'contact',
    displayName: 'New paper published',
    category: 'Publications & Recognition',
    baseWeight: 0.8,
    description: 'A new publication signals active research and potential near-term needs.',
  },
  {
    id: 'conference_speaker',
    scope: 'contact',
    displayName: 'Conference speaker',
    category: 'Publications & Recognition',
    baseWeight: 0.7,
    description: 'Speaking at a conference signals visibility and current domain focus.',
  },
  {
    id: 'principal_investigator_new_trial',
    scope: 'contact',
    displayName: 'PI on new trial',
    category: 'Publications & Recognition',
    baseWeight: 0.85,
    description: 'Becoming a PI on a new trial often creates fresh operational and vendor needs.',
  },
  {
    id: 'award_or_recognition',
    scope: 'contact',
    displayName: 'Award or recognition',
    category: 'Publications & Recognition',
    baseWeight: 0.55,
    description: 'Recognition can signal growing influence and a moment of increased visibility.',
  },
  {
    id: 'team_actively_hiring',
    scope: 'contact',
    displayName: 'Team actively hiring',
    category: 'Hiring & Team',
    baseWeight: 0.65,
    description: 'A team hiring beneath this contact suggests growth and expanding scope.',
  },
  {
    id: 'attended_your_webinar_or_event_contact',
    scope: 'contact',
    displayName: 'Webinar or event attendee',
    category: 'First-Party Engagement',
    baseWeight: 0.75,
    description: 'Attendance at your event suggests personal interest in your domain or offering.',
  },
  {
    id: 'downloaded_your_content_contact',
    scope: 'contact',
    displayName: 'Downloaded content',
    category: 'First-Party Engagement',
    baseWeight: 0.65,
    description: 'Downloading content signals research behaviour and active topic interest.',
  },
  {
    id: 'clicked_your_linkedin_ad',
    scope: 'contact',
    displayName: 'LinkedIn ad click',
    category: 'First-Party Engagement',
    baseWeight: 0.6,
    description: 'Clicking your LinkedIn ad indicates direct exposure and some level of intent.',
  },
  {
    id: 'responded_to_a_previous_outreach',
    scope: 'contact',
    displayName: 'Responded to outreach',
    category: 'First-Party Engagement',
    baseWeight: 0.8,
    description: 'A previous response is a strong warmth signal for re-engagement.',
  },
  {
    id: 'previously_contacted_by_your_team',
    scope: 'contact',
    displayName: 'Previously contacted',
    category: 'CRM & Relationship',
    baseWeight: 0.6,
    description: 'Prior contact means there is already a relationship thread to build on.',
  },
  {
    id: 'meeting_previously_booked',
    scope: 'contact',
    displayName: 'Meeting previously booked',
    category: 'CRM & Relationship',
    baseWeight: 0.75,
    description: 'A previously booked meeting indicates a warm prior relationship.',
  },
  {
    id: 'open_opportunity_in_your_pipeline',
    scope: 'contact',
    displayName: 'Open opportunity',
    category: 'CRM & Relationship',
    baseWeight: 0.9,
    description: 'This contact is already associated with an active deal in your pipeline.',
  },
  {
    id: 'lapsed_customer_contact',
    scope: 'contact',
    displayName: 'Lapsed customer contact',
    category: 'CRM & Relationship',
    baseWeight: 0.85,
    description: 'A contact at a lapsed customer account is a prime re-engagement target.',
  },
  {
    id: 'renewal_coming_up_contact',
    scope: 'contact',
    displayName: 'Renewal due',
    category: 'CRM & Relationship',
    baseWeight: 0.9,
    description: 'An upcoming renewal is a time-sensitive moment to engage the key contact.',
  },
];

export const COMPANY_SIGNALS = SIGNAL_CATALOG.filter((signal) => signal.scope === 'company');
export const CONTACT_SIGNALS = SIGNAL_CATALOG.filter((signal) => signal.scope === 'contact');

/** First-party and CRM-linked contact signals — not backed by live ingestion yet; UI may collect interest. */
const CONTACT_SIGNAL_COMING_SOON_IDS = new Set([
  'attended_your_webinar_or_event_contact',
  'downloaded_your_content_contact',
  'clicked_your_linkedin_ad',
  'responded_to_a_previous_outreach',
  'previously_contacted_by_your_team',
  'meeting_previously_booked',
  'open_opportunity_in_your_pipeline',
  'lapsed_customer_contact',
  'renewal_coming_up_contact',
]);

export function isContactSignalComingSoon(signalId: string): boolean {
  return CONTACT_SIGNAL_COMING_SOON_IDS.has(signalId);
}

/** Default contact signal set for new personas (managed-service signals excluded). */
export function getDefaultContactSignalSelectionIds(): string[] {
  return CONTACT_SIGNALS.filter((s) => !isContactSignalComingSoon(s.id)).map((s) => s.id);
}

export const getSignalById = (signalId: string) =>
  SIGNAL_CATALOG.find((signal) => signal.id === signalId) ?? null;
