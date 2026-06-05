/**
 * Plain-sentence rendering of a signal event for the board-wide activity log
 * on /log — e.g. "Illumina filed a new patent", "SYNthesis registered a
 * clinical trial", "Chong Ma started a new role at Moderna".
 *
 * Subject is the COMPANY for company-scope signals, the CONTACT for
 * contact-scope signals (with " at {company}" appended when known). Verb
 * phrases live in SIGNAL_VERB_PHRASE; anything unmapped falls back to the
 * noun-phrase display name from signal-display-names.
 */
import { getSignalDisplayName } from './signal-display-names';

/** signal_key → verb phrase that completes "{subject} ___". */
const SIGNAL_VERB_PHRASE: Record<string, string> = {
  // Patents / IP
  patent_filed_or_granted: 'filed a new patent',
  patent_application_published: 'published a patent application',
  patent_application: 'filed a patent application',
  patent_granted: 'was granted a patent',
  new_therapeutic_area_patent: 'filed a patent in a new therapeutic area',
  assignee_portfolio_acceleration: 'accelerated its patent filings',
  // Research / publications
  publication: 'published new research',
  new_paper_published: 'published a new paper',
  // Clinical
  clinical_trial: 'registered a clinical trial',
  clinical_trial_registered: 'registered a clinical trial',
  clinical_trial_recruiting: 'started recruiting for a clinical trial',
  clinical_trial_completed: 'completed a clinical trial',
  trial_site_expansion: 'expanded a clinical trial',
  trial_failure_or_halt: 'halted a clinical trial',
  program_discontinuation: 'discontinued a program',
  indication_expansion: 'expanded into a new indication',
  phase_transition: 'advanced a trial to the next phase',
  principal_investigator_new_trial: 'became PI on a new clinical trial',
  // Regulatory
  fda_approval: 'received FDA approval',
  breakthrough_designation: 'received a breakthrough designation',
  fast_track_designation: 'received fast track designation',
  priority_review: 'was granted priority review',
  orphan_designation: 'received orphan drug designation',
  complete_response_letter: 'received a complete response letter',
  // Money
  funding_round: 'raised a funding round',
  new_funding: 'raised new funding',
  ipo_or_follow_on: 'announced an IPO or follow-on raise',
  ipo: 'went public',
  grant_award: 'won a research grant',
  partnership_deal: 'signed a partnership or licensing deal',
  ma: 'was involved in M&A',
  // Company growth
  company_founded: 'was founded',
  new_facility: 'opened a new facility',
  // Hiring (company)
  cmc_hiring: 'is hiring in CMC / manufacturing',
  cmc_hire: 'made a CMC / manufacturing hire',
  clinical_ops_hire: 'made a clinical operations hire',
  bd_hire: 'made a BD / partnerships hire',
  regulatory_hire: 'made a regulatory hire',
  csuite_hire: 'made a C-suite hire',
  research_hiring: 'is hiring in R&D',
  quality_hiring: 'is hiring in quality / GMP',
  medical_hiring: 'is hiring in medical affairs',
  data_informatics_hiring: 'is hiring in data & informatics',
  executive_hiring: 'is hiring executives',
  hiring_expansion: 'is expanding hiring',
  team_actively_hiring: 'is actively hiring',
  // CRM (company)
  new_contact_added_in_crm: 'added a new contact in your CRM',
  open_opportunity_in_crm: 'has an open opportunity in your CRM',
  closed_lost_in_crm: 'closed an opportunity as lost in your CRM',
  terminated_deal: 'terminated a deal',
  lapsed_customer: 'lapsed as a customer',
  renewal_coming_up: 'has a renewal coming up',
  // Contact-scope
  new_to_role: 'started a new role',
  new_internal_role: 'moved into a new internal role',
  recently_promoted: 'was promoted',
  promoted: 'was promoted',
  recently_changed_company: 'changed company',
  recently_hired: 'was recently hired',
  title_change: 'changed job title',
  award_or_recognition: 'received an award or recognition',
};

export type SignalSentenceInput = {
  signalKey: string;
  scope: 'company' | 'contact';
  companyName?: string | null;
  contactName?: string | null;
};

export function formatSignalSentence(input: SignalSentenceInput): string {
  const company = input.companyName?.trim() || '';
  const contact = input.contactName?.trim() || '';
  const subject =
    input.scope === 'contact' ? contact || company || 'A contact' : company || 'A company';

  const verb = SIGNAL_VERB_PHRASE[input.signalKey];
  if (verb) {
    // For a contact-scope signal, name their company too when we have it.
    if (input.scope === 'contact' && company && subject !== company) {
      return `${subject} ${verb} at ${company}`;
    }
    return `${subject} ${verb}`;
  }

  // Unmapped key → fall back to the noun-phrase label, lower-cased into the
  // sentence ("{subject} — funding round").
  const label = getSignalDisplayName(input.signalKey).toLowerCase();
  return `${subject} — ${label}`;
}
