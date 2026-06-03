/**
 * CRM-internal pipeline/status events: the seller's OWN HubSpot bookkeeping —
 * a deal logged, a contact added, a deal closed/lost. These are NOT market
 * signals about the prospect, so they are excluded from BOTH the signals panel
 * and outreach hook candidates. You can't open a conversation about a deal your
 * own team created in the CRM.
 *
 * NOTE: prospect-ENGAGEMENT events that also live in the CRM (demo requested,
 * inbound enquiry, website/webinar/content, replied to outreach) are genuine
 * prospect actions and are deliberately NOT in this set.
 *
 * They may still contribute to readiness scoring (an open deal genuinely
 * indicates an active account) — this set governs display + outreach only.
 */
export const CRM_INTERNAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'open_opportunity_in_crm',
  'new_contact_added_in_crm',
  'closed_lost_in_crm',
  'lapsed_customer',
  'terminated_deal',
]);
