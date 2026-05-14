export const SIGNAL_DISPLAY_NAMES: Record<string, string> = {
  new_funding: 'New funding round',
  ipo: 'IPO or public listing',
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
  company_founded: 'Company founded or incorporated',
  new_facility: 'New office or facility',
  conference_presentation: 'Conference presentation or poster',
  publication: 'Publication in peer-reviewed journal',
  press_release: 'Press release or news mention',
  visited_your_website: 'Website visit',
  downloaded_your_content: 'Content download',
  attended_your_webinar_or_event: 'Webinar attendee',
  clicked_your_linkedin_ad: 'LinkedIn ad click',
  demo_requested: 'Demo requested',
  inbound_enquiry: 'Inbound enquiry',
  responded_to_a_previous_outreach: 'Engaged with previously',
  previously_contacted_by_your_team: 'Previously contacted',
  open_opportunity_in_your_pipeline: 'Open opportunity',
  open_opportunity_in_crm: 'Open opportunity in CRM',
  new_contact_added_in_crm: 'New contact added in CRM',
  lapsed_customer: 'Lapsed customer',
  renewal_coming_up: 'Renewal due',
  meeting_previously_booked: 'Meeting booked',
  closed_lost_in_crm: 'Closed lost in CRM',
  went_dark_after_engagement: 'Went dark after engagement',
  met_at_conference_or_tradeshow: 'Met at conference or tradeshow',
  followed_your_company: 'Followed your company',
  engaged_with_your_content: 'Engaged with your content',
  commented_on_your_post: 'Commented on your post',
  shared_your_content: 'Shared your content',
  viewed_your_profile: 'Viewed your profile',
  new_to_role: 'New to role',
  recently_promoted: 'Recently promoted',
  recently_changed_company: 'Recently changed company',
  active_on_linkedin: 'Active on LinkedIn',
  network_overlap: 'Connected to similar companies',
  new_internal_role: 'New internal role',
  promoted: 'Promoted',
  recently_hired: 'Recently hired',
  title_change: 'Title change',
  board_or_advisory_role: 'Board or advisory role',
  new_paper_published: 'New paper published',
  conference_speaker: 'Conference speaker',
  principal_investigator_new_trial: 'Principal investigator on new trial',
  award_or_recognition: 'Award or recognition',
  patent_filed_or_granted: 'Patent filed or granted',
  team_actively_hiring: 'Team actively hiring',
  attended_your_webinar_or_event_contact: 'Webinar or event attendee',
  downloaded_your_content_contact: 'Downloaded content',
  lapsed_customer_contact: 'Lapsed customer contact',
  renewal_coming_up_contact: 'Renewal due',
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
