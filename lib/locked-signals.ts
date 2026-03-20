export type LockedSignalCategory =
  | 'Funding & Financial'
  | 'Pipeline & Clinical'
  | 'Hiring & Team'
  | 'Corporate & Strategic';

export interface LockedSignal {
  id: string;
  name: string;
  category: LockedSignalCategory;
}

export type LockedSignalAudience = 'company' | 'persona';

const PERSONA_LOCKED_SIGNALS_POOL: LockedSignal[] = [
  // First-party tracking
  { id: 'visited_your_website', name: 'Website visit', category: 'Corporate & Strategic' },
  { id: 'downloaded_your_content', name: 'Content download', category: 'Pipeline & Clinical' },
  { id: 'attended_your_webinar_or_event', name: 'Webinar attendee', category: 'Hiring & Team' },
  { id: 'clicked_your_linkedin_ad', name: 'LinkedIn ad click', category: 'Corporate & Strategic' },
  { id: 'responded_to_a_previous_outreach', name: 'Engaged with previously', category: 'Corporate & Strategic' },
  // CRM integration
  { id: 'previously_contacted_by_your_team', name: 'Previously contacted', category: 'Corporate & Strategic' },
  { id: 'open_opportunity_in_your_pipeline', name: 'Open opportunity', category: 'Funding & Financial' },
  { id: 'lapsed_customer', name: 'Lapsed customer', category: 'Funding & Financial' },
  { id: 'renewal_coming_up', name: 'Renewal due', category: 'Funding & Financial' },
  { id: 'meeting_previously_booked', name: 'Meeting booked', category: 'Hiring & Team' },
];

const COMPANY_LOCKED_SIGNALS_POOL: LockedSignal[] = [
  // Connect your tracking
  { id: 'visited_your_website', name: 'Website visit', category: 'Corporate & Strategic' },
  { id: 'downloaded_your_content', name: 'Content download', category: 'Pipeline & Clinical' },
  { id: 'attended_your_webinar_or_event', name: 'Webinar attendee', category: 'Hiring & Team' },
  { id: 'clicked_your_linkedin_ad', name: 'LinkedIn ad click', category: 'Corporate & Strategic' },
  { id: 'demo_requested', name: 'Demo requested', category: 'Corporate & Strategic' },
  { id: 'inbound_enquiry', name: 'Inbound enquiry', category: 'Corporate & Strategic' },
  { id: 'responded_to_a_previous_outreach', name: 'Engaged with previously', category: 'Corporate & Strategic' },
  // Connect your CRM
  { id: 'previously_contacted_by_your_team', name: 'Previously contacted', category: 'Corporate & Strategic' },
  { id: 'meeting_previously_booked', name: 'Meeting booked', category: 'Hiring & Team' },
  { id: 'renewal_coming_up', name: 'Renewal due', category: 'Funding & Financial' },
  { id: 'lapsed_customer', name: 'Lapsed customer', category: 'Funding & Financial' },
  { id: 'open_opportunity_in_crm', name: 'Open opportunity in CRM', category: 'Funding & Financial' },
];

export function getRandomLockedSignals(count?: number, audience: LockedSignalAudience = 'persona'): LockedSignal[] {
  const sourcePool = audience === 'company' ? COMPANY_LOCKED_SIGNALS_POOL : PERSONA_LOCKED_SIGNALS_POOL;
  const pool = [...sourcePool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (typeof count === 'number') {
    return pool.slice(0, Math.max(0, count));
  }
  return pool;
}
