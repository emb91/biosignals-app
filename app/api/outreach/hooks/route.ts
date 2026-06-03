/**
 * GET /api/outreach/hooks?contactId=…
 *
 * Returns the list of recent signals (last 14d) that can anchor an outreach
 * sequence for this contact. Pure DB query — NO LLM call.
 *
 * Ordering:
 *   1. Contact-level signals first (job change, promotion, new role)
 *   2. Then company-level signals, newest first
 *
 * Output: { hooks: Hook[] } where Hook = {
 *   source_type: 'signal' | 'derived',
 *   source_event_id: string | null,
 *   source_event_at: string | null,
 *   signal_type: string | null,
 *   is_contact_level: boolean,
 *   title: string,
 *   summary: string | null,
 * }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { effectiveReadiness, getActionFromScores, HIGH_SCORE } from '@/lib/lead-action';
import { personaFunctionNames } from '@/lib/persona-functions';

// 30 days, not 14: month-old signals like an FDA approval or indication
// expansion are still strong, honest outreach anchors. The panel shows them as
// recent; the picker should too. Caution/stale years-old events are excluded by
// recency + the caution-never-a-hook rule regardless.
const LOOKBACK_DAYS = 30;
// Hard cap on hooks returned. Was 10; brought down so the picker is scannable.
// Combined with tier-based ranking below, the top of the list is now the
// outreach-worthiest signals rather than a dump of every publication.
const MAX_HOOKS = 6;

// HARD RULE: CRM-internal pipeline/status events are the seller's OWN HubSpot
// bookkeeping — a deal logged, a contact added, a deal closed/lost. They are NOT
// market signals about the prospect and must NEVER become an outreach hook: you
// cannot cold-open a contact about a deal your own team created in HubSpot.
// (Prospect-ENGAGEMENT events that also live in the CRM — demo requested,
// inbound enquiry, website/webinar/content, replied to outreach — are genuine
// prospect actions and are deliberately NOT excluded.)
const CRM_INTERNAL_EVENT_TYPES = new Set<string>([
  'open_opportunity_in_crm',
  'new_contact_added_in_crm',
  'closed_lost_in_crm',
  'lapsed_customer',
  'terminated_deal',
]);

// Maximum chars for the displayed title. PubMed titles especially blow past
// what's readable in a side-panel card. ~80 chars + ellipsis fits one line at
// the current type scale.
const MAX_TITLE_CHARS = 80;

/**
 * Humanized label per signal type. Snake_case + auto-generated titles like
 * "trial_site_expansion detected from ClinicalTrials.gov" force the rep to
 * decode jargon before they can decide. This is a single source of truth for
 * the surface label — falls back to title-cased snake_case if a type isn't
 * mapped (so a brand-new signal type still renders, just less prettily).
 */
const SIGNAL_TYPE_LABEL: Record<string, string> = {
  // Contact-scope
  recently_promoted: 'Promotion',
  recently_changed_company: 'New role',
  new_to_role: 'New role',
  new_internal_role: 'Internal move',
  title_change: 'Title change',
  pubmed_contact_paper: 'Publication',
  new_paper_published: 'Publication',
  principal_investigator_new_trial: 'New trial (PI)',
  // Company-scope — high-value
  funding_round: 'Funding',
  grant_award: 'Grant',
  ipo_or_follow_on: 'IPO / follow-on',
  ma_event: 'M&A',
  partnership_deal: 'Partnership',
  licensing_deal: 'Licensing deal',
  co_development_deal: 'Co-development',
  partnership_with_upfront_economics: 'Partnership',
  milestone_payment: 'Milestone',
  fda_approval: 'FDA approval',
  breakthrough_designation: 'Breakthrough designation',
  fast_track_designation: 'Fast track designation',
  priority_review: 'Priority review',
  orphan_designation: 'Orphan designation',
  complete_response_letter: 'CRL',
  // Company-scope — operational
  hiring_expansion: 'Hiring surge',
  cmc_hiring: 'CMC hiring',
  clinical_ops_hiring: 'Clinical ops hiring',
  regulatory_hiring: 'Regulatory hiring',
  research_hiring: 'Research hiring',
  quality_hiring: 'Quality hiring',
  medical_hiring: 'Medical affairs hiring',
  bd_hiring: 'BD hiring',
  commercial_hiring: 'Commercial hiring',
  data_informatics_hiring: 'Data / informatics hiring',
  executive_hiring: 'Executive hiring',
  ats_jobs_cmc_hiring: 'CMC hiring',
  ats_jobs_clinical_ops_hiring: 'Clinical ops hiring',
  ats_jobs_regulatory_hiring: 'Regulatory hiring',
  ats_jobs_research_hiring: 'Research hiring',
  ats_jobs_quality_hiring: 'Quality hiring',
  ats_jobs_medical_hiring: 'Medical affairs hiring',
  ats_jobs_bd_hiring: 'BD hiring',
  ats_jobs_commercial_hiring: 'Commercial hiring',
  ats_jobs_data_informatics_hiring: 'Data / informatics hiring',
  ats_jobs_executive_hiring: 'Executive hiring',
  ats_jobs_hiring_expansion: 'Hiring surge',
  ats_jobs_surge: 'Hiring surge',
  // Clinical trials
  clinical_trial_registered: 'Trial registered',
  clinical_trial_recruiting: 'Trial recruiting',
  clinical_trial_completed: 'Trial completed',
  clinical_trial_sponsor_change: 'Trial sponsor change',
  phase_transition: 'Phase transition',
  trial_site_expansion: 'Trial site expansion',
  indication_expansion: 'New indication',
  trial_failure_or_halt: 'Trial halted',
  program_discontinuation: 'Program discontinued',
  // Patents / publications
  pubmed_publication: 'Publication',
  publication: 'Publication',
  patent_filed_or_granted: 'Patent',
  patent_application_published: 'Patent filed',
  patent_granted: 'Patent granted',
  new_therapeutic_area_patent: 'New therapeutic-area patent',
  assignee_portfolio_acceleration: 'Patent activity',
  // CRM / engagement
  open_opportunity_in_crm: 'Open opportunity',
  new_contact_added_in_crm: 'New CRM contact',
  closed_lost_in_crm: 'Closed-lost (CRM)',
  lapsed_customer: 'Lapsed customer',
  demo_requested: 'Demo request',
  inbound_enquiry: 'Inbound enquiry',
  visited_your_website: 'Website visit',
  attended_your_webinar_or_event: 'Webinar / event',
  downloaded_your_content: 'Content download',
  responded_to_previous_outreach: 'Reply to outreach',
  // Org churn
  leadership_churn: 'Leadership churn',
  key_contact_departed: 'Contact departed',
  acquisition_distraction: 'Acquisition distraction',
  restructuring: 'Restructuring',
  terminated_deal: 'Terminated deal',
};

function humanizeSignalType(raw: string | null): string {
  if (!raw) return 'Signal';
  const mapped = SIGNAL_TYPE_LABEL[raw];
  if (mapped) return mapped;
  // Strip the internal `ats_jobs_` source/workflow prefix — the user cares about
  // the hiring, not that we read it from an applicant-tracking system. A bare
  // "surge" (or nothing left) is just a hiring surge.
  let key = raw.replace(/^ats_jobs_/, '');
  if (key === '' || key === 'surge' || key === 'hiring_expansion') key = 'hiring surge';
  // Fallback: turn `foo_bar_baz` into `Foo bar baz` so unknown types still render.
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/, (c) => c.toUpperCase());
}

/**
 * Outreach-value tiers per signal type. Lower number = better hook. The
 * picker sorts by this first, then by date. Promotions and partnership-class
 * deals are the strongest concrete outreach anchors; generic publications
 * and hiring buckets sit lower because they're plentiful and softer.
 */
const SIGNAL_TIER: Record<string, number> = {
  // Tier 1 — strongest anchors (personal change or big news with implications)
  recently_promoted: 1,
  recently_changed_company: 1,
  new_to_role: 1,
  title_change: 1,
  funding_round: 1,
  grant_award: 1,
  ipo_or_follow_on: 1,
  ma_event: 1,
  partnership_deal: 1,
  licensing_deal: 1,
  co_development_deal: 1,
  partnership_with_upfront_economics: 1,
  fda_approval: 1,
  breakthrough_designation: 1,
  demo_requested: 1,
  responded_to_previous_outreach: 1,
  inbound_enquiry: 1,
  // Tier 2 — solid but more contextual
  fast_track_designation: 2,
  priority_review: 2,
  orphan_designation: 2,
  milestone_payment: 2,
  new_paper_published: 2,
  pubmed_contact_paper: 2,
  principal_investigator_new_trial: 2,
  phase_transition: 2,
  clinical_trial_completed: 2,
  indication_expansion: 2,
  hiring_expansion: 2,
  ats_jobs_hiring_expansion: 2,
  patent_granted: 2,
  new_therapeutic_area_patent: 2,
  open_opportunity_in_crm: 2,
  // Tier 3 — narrative / volume signals
  // (everything else falls here via the default)
};

function tierFor(signalType: string | null): number {
  if (!signalType) return 3;
  return SIGNAL_TIER[signalType] ?? 3;
}

/**
 * Map signal type → visual category. Default = `strategic` (a neutral middle
 * bucket) for anything unmapped so unknown signals still render colored.
 */
const SIGNAL_CATEGORY: Record<string, HookCategory> = {
  // Money / commercial
  funding_round: 'funding',
  grant_award: 'funding',
  ipo_or_follow_on: 'funding',
  milestone_payment: 'funding',
  partnership_with_upfront_economics: 'funding',
  // People change / org movement
  recently_promoted: 'people',
  recently_changed_company: 'people',
  new_to_role: 'people',
  new_internal_role: 'people',
  title_change: 'people',
  executive_hiring: 'people',
  ats_jobs_executive_hiring: 'people',
  leadership_churn: 'people',
  key_contact_departed: 'people',
  // Strategic news / deals / facilities
  partnership_deal: 'strategic',
  licensing_deal: 'strategic',
  co_development_deal: 'strategic',
  commercialization_move: 'strategic',
  ma_event: 'strategic',
  new_facility: 'strategic',
  facility_expansion: 'strategic',
  // Clinical / regulatory / operational
  clinical_trial_registered: 'clinical_ops',
  clinical_trial_recruiting: 'clinical_ops',
  clinical_trial_completed: 'clinical_ops',
  clinical_trial_sponsor_change: 'clinical_ops',
  phase_transition: 'clinical_ops',
  trial_site_expansion: 'clinical_ops',
  indication_expansion: 'clinical_ops',
  fda_approval: 'clinical_ops',
  breakthrough_designation: 'clinical_ops',
  fast_track_designation: 'clinical_ops',
  priority_review: 'clinical_ops',
  orphan_designation: 'clinical_ops',
  complete_response_letter: 'clinical_ops',
  cmc_hiring: 'clinical_ops',
  clinical_ops_hiring: 'clinical_ops',
  regulatory_hiring: 'clinical_ops',
  research_hiring: 'clinical_ops',
  quality_hiring: 'clinical_ops',
  medical_hiring: 'clinical_ops',
  bd_hiring: 'clinical_ops',
  commercial_hiring: 'clinical_ops',
  data_informatics_hiring: 'clinical_ops',
  hiring_expansion: 'clinical_ops',
  ats_jobs_cmc_hiring: 'clinical_ops',
  ats_jobs_clinical_ops_hiring: 'clinical_ops',
  ats_jobs_regulatory_hiring: 'clinical_ops',
  ats_jobs_research_hiring: 'clinical_ops',
  ats_jobs_quality_hiring: 'clinical_ops',
  ats_jobs_medical_hiring: 'clinical_ops',
  ats_jobs_bd_hiring: 'clinical_ops',
  ats_jobs_commercial_hiring: 'clinical_ops',
  ats_jobs_data_informatics_hiring: 'clinical_ops',
  ats_jobs_hiring_expansion: 'clinical_ops',
  // Research / IP output (publications + patents)
  publication: 'research',
  pubmed_publication: 'research',
  new_paper_published: 'research',
  pubmed_contact_paper: 'research',
  principal_investigator_new_trial: 'research',
  patent_filed_or_granted: 'research',
  patent_application_published: 'research',
  patent_granted: 'research',
  new_therapeutic_area_patent: 'research',
  assignee_portfolio_acceleration: 'research',
  // First-party engagement / CRM warm states
  demo_requested: 'engagement',
  inbound_enquiry: 'engagement',
  visited_your_website: 'engagement',
  attended_your_webinar_or_event: 'engagement',
  downloaded_your_content: 'engagement',
  responded_to_previous_outreach: 'engagement',
  open_opportunity_in_crm: 'engagement',
  new_contact_added_in_crm: 'engagement',
  prior_customer_relationship: 'engagement',
  prior_active_deal_relationship: 'engagement',
  prior_pipeline_relationship: 'engagement',
  // Caution / suppression
  closed_lost_in_crm: 'caution',
  lapsed_customer: 'caution',
  terminated_deal: 'caution',
  trial_failure_or_halt: 'caution',
  program_discontinuation: 'caution',
  restructuring: 'caution',
  acquisition_distraction: 'caution',
};

function categoryFor(signalType: string | null): HookCategory {
  if (!signalType) return 'strategic';
  return SIGNAL_CATEGORY[signalType] ?? 'strategic';
}

/**
 * Strip auto-generated noise from signal titles and clip overly long ones.
 * - "X detected at Y" / "X detected from Y" → just "X" with proper casing
 *   (we already show the humanized label separately, so the auto-prefix is
 *   pure noise).
 * - PubMed titles often run 150+ chars; clip with ellipsis.
 * - Strip trailing periods so the card doesn't look mid-sentence.
 */
function cleanTitle(raw: string | null, signalType: string | null): string {
  if (!raw) return humanizeSignalType(signalType);
  let t = raw.trim();
  // "trial_site_expansion detected from ClinicalTrials.gov" → no useful info,
  // replace with the humanized label outright.
  const detectedMatch = t.match(/^([a-z0-9_]+)\s+detected\s+(?:at|from)\b/i);
  if (detectedMatch) return humanizeSignalType(signalType);
  // Strip HTML/XML entities that occasionally leak through (e.g. &#x2009;).
  t = t.replace(/&#x[0-9a-f]+;/gi, '').replace(/&[a-z]+;/gi, '');
  // Trim trailing period for a cleaner card look.
  t = t.replace(/\.+$/, '').trim();
  if (t.length > MAX_TITLE_CHARS) {
    t = t.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + '…';
  }
  return t || humanizeSignalType(signalType);
}

// Outreach gate: only show hooks when the contact is in the "reach out" cell of
// the action model — company fit high AND contact fit high AND effective
// readiness (max of company + contact) high. HIGH_SCORE + the gate logic come
// from lib/lead-action so the gate can never drift from the action shown in the
// leads/accounts UI.

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Internal server error';
}

/**
 * Visual category for the picker pill. Drives pill color. Categories group
 * signals by what they "mean" for an outreach hook (not by readiness dimension
 * — `publication` is `new_strategy` in readiness, but in the picker it reads
 * as "research", not strategic news).
 */
type HookCategory =
  | 'funding'
  | 'people'
  | 'strategic'
  | 'clinical_ops'
  | 'research'
  | 'engagement'
  | 'caution';

type Hook = {
  source_type: 'signal' | 'derived';
  source_event_id: string | null;
  source_event_at: string | null;
  signal_type: string | null;
  /** Human-friendly label used by the picker chip (e.g. "Promotion"). */
  signal_label: string;
  /** Visual category driving pill color in the UI. */
  category: HookCategory;
  /**
   * Short sentence-fragment for embedding in the picker CTA. e.g.
   * "their promotion", "Moderna's partnership". Reads as
   *   "Generate a sequence on '{phrase}'"
   * in the UI. Always lowercase apart from proper nouns; never ends with
   * punctuation.
   */
  phrase: string;
  /** Outreach-value tier: 1 = strongest anchor, 3 = narrative/volume. */
  tier: number;
  is_contact_level: boolean;
  /** Cleaned + clipped title for display (kept for the editor anchor + LLM). */
  title: string;
  summary: string | null;
  /** AI score 0-100 for how strong this is as an outreach anchor. Set by the
   *  curation pass. Null when curation was skipped (LLM error fallback). */
  ai_score?: number | null;
  /** One-line reasoning from the curation pass — surfaced in the UI so the
   *  rep understands why this hook was recommended. */
  ai_reason?: string | null;
  /** Which seller value_prop / capability this hook concretely activates.
   *  Required to pass the grounding bar — hooks without specific seller
   *  grounding are rejected by the curation pass. Used internally + can be
   *  surfaced as "evidence" in the UI. */
  ai_seller_grounding?: string | null;
  /** Specific fact from the signal title/summary that makes this hook
   *  non-generic. Required alongside seller_grounding. */
  ai_signal_grounding?: string | null;
  /** True when this is a fallback PATTERN observation, not a specific
   *  signal-anchored hook (e.g. "noticed they've been publishing a lot
   *  on respiratory mRNA"). Rendered differently in the picker. */
  is_pattern?: boolean;
};

/**
 * Per-signal short phrasing overrides where the generic
 * "{subject}'s {lowercase_label}" doesn't read well. e.g. "publication" reads
 * better as "their recent paper" than "their publication", and
 * "Trial site expansion" is fine as-is.
 */
const PHRASE_OVERRIDE: Record<string, { contact?: string; company?: string }> = {
  pubmed_publication: { contact: 'their recent paper', company: 'their recent paper' },
  publication: { contact: 'their recent paper', company: 'their recent paper' },
  new_paper_published: { contact: 'their recent paper' },
  pubmed_contact_paper: { contact: 'their recent paper' },
  partnership_deal: { company: 'their new partnership' },
  partnership_with_upfront_economics: { company: 'their new partnership' },
  co_development_deal: { company: 'their new co-development deal' },
  licensing_deal: { company: 'their new licensing deal' },
  funding_round: { company: 'their funding round' },
  ma_event: { company: 'their M&A move' },
  ipo_or_follow_on: { company: 'their IPO / follow-on' },
  fda_approval: { company: 'their FDA approval' },
  breakthrough_designation: { company: 'their breakthrough designation' },
  hiring_expansion: { company: 'their hiring surge' },
  ats_jobs_hiring_expansion: { company: 'their hiring surge' },
  assignee_portfolio_acceleration: { company: 'their patent activity' },
  trial_site_expansion: { company: 'their trial site expansion' },
  clinical_trial_recruiting: { company: 'their recruiting trial' },
  recently_promoted: { contact: 'their promotion' },
  recently_changed_company: { contact: 'their new role' },
  new_to_role: { contact: 'their new role' },
  title_change: { contact: 'their title change' },
};

function phraseFor(
  signalType: string | null,
  signalLabel: string,
  isContactLevel: boolean,
  companyName: string | null,
): string {
  const override = signalType ? PHRASE_OVERRIDE[signalType] : undefined;
  if (override) {
    const o = isContactLevel ? override.contact : override.company;
    if (o) return o;
  }
  // Generic fallback. Lowercase the label unless it contains proper nouns
  // (we have a couple like "M&A", "FDA approval", "CMC hiring" — the casing
  // there is intentional in the label, so we preserve all-caps tokens).
  const lowered = signalLabel
    .split(' ')
    .map((w) => (w === w.toUpperCase() && w.length <= 4 ? w : w.toLowerCase()))
    .join(' ');
  if (isContactLevel) return `their ${lowered}`;
  // Company-scope. Use the first word of the company name when present
  // ("Moderna" out of "Moderna, Inc."). Strip trailing legal suffixes.
  if (companyName) {
    const firstWord = companyName.trim().split(/[,\s]+/)[0];
    if (firstWord) return `${firstWord}'s ${lowered}`;
  }
  return `their ${lowered}`;
}

type GatingScores = {
  contact_fit_score: number | null;
  company_fit_score: number | null;
  contact_readiness_score: number | null;
  company_readiness_score: number | null;
  threshold: number;
  reason: 'fit_below_threshold' | 'readiness_below_threshold' | 'no_company';
};

type SignalRow = {
  id: string;
  source_event_type: string | null;
  title: string | null;
  summary: string | null;
  event_at: string | null;
  entity_company_id: string | null;
  entity_contact_id: string | null;
};

// Max candidates we send to the LLM. Trimmed to keep the prompt small —
// every token cut shaves Haiku response time. The mechanical pre-rank
// already biases toward strong tiers so we don't need a wide pool.
const MAX_CANDIDATES_TO_SCORE = 8;

// Ceiling on curated hooks. NOT a target — we surface however many actually
// pass the grounding bar (could be 0, 1, 2, ...). 5 is the UI sanity cap.
const MAX_PICKS = 5;

type CurationVerdict = {
  index: number;
  score: number;
  reason: string;
  seller_grounding: string;
  signal_grounding: string;
};

type PatternHookVerdict = {
  phrase: string;
  reason: string;
  seller_grounding: string;
  signal_grounding: string;
  score: number;
};

function tolerantJsonParse(text: string): unknown {
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart === -1 || objEnd === -1) return null;
  try {
    return JSON.parse(candidate.slice(objStart, objEnd + 1));
  } catch {
    return null;
  }
}

function parseCuration(
  text: string,
  maxIndex: number,
): { picks: CurationVerdict[]; pattern: PatternHookVerdict | null } {
  const parsed = tolerantJsonParse(text);
  if (!parsed || typeof parsed !== 'object') return { picks: [], pattern: null };

  const obj = parsed as { top?: unknown; pattern?: unknown };
  const rawTop = Array.isArray(obj.top) ? obj.top : [];

  // Pick parser — every field required, drops the item if any are missing.
  // This is the grounding bar: no seller_grounding + signal_grounding → no pick.
  const picks: CurationVerdict[] = [];
  const seen = new Set<number>();
  for (const item of rawTop) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const idx = typeof o.index === 'number' ? Math.floor(o.index) : NaN;
    if (!Number.isFinite(idx) || idx < 1 || idx > maxIndex) continue;
    if (seen.has(idx)) continue;
    const score = typeof o.score === 'number' ? Math.max(0, Math.min(100, Math.floor(o.score))) : 0;
    const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
    const sellerG = typeof o.seller_grounding === 'string' ? o.seller_grounding.trim() : '';
    const signalG = typeof o.signal_grounding === 'string' ? o.signal_grounding.trim() : '';
    // Hard gate: drop any pick missing grounding. This is the "if you can't
    // explain it concretely, don't pick it" rule. Length minimums catch
    // empty-but-present placeholders like " " or "n/a".
    if (!reason || sellerG.length < 6 || signalG.length < 6) continue;
    seen.add(idx);
    picks.push({ index: idx, score, reason, seller_grounding: sellerG, signal_grounding: signalG });
  }

  // Pattern parser — emitted only when LLM judged that a generic pattern hook
  // concretely fits the seller. Apply the same grounding bar.
  let pattern: PatternHookVerdict | null = null;
  if (obj.pattern && typeof obj.pattern === 'object') {
    const p = obj.pattern as Record<string, unknown>;
    const phrase = typeof p.phrase === 'string' ? p.phrase.trim() : '';
    const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
    const sellerG = typeof p.seller_grounding === 'string' ? p.seller_grounding.trim() : '';
    const signalG = typeof p.signal_grounding === 'string' ? p.signal_grounding.trim() : '';
    const score = typeof p.score === 'number' ? Math.max(0, Math.min(100, Math.floor(p.score))) : 50;
    if (phrase && reason && sellerG.length >= 6 && signalG.length >= 6) {
      pattern = { phrase, reason, seller_grounding: sellerG, signal_grounding: signalG, score };
    }
  }

  // If "top" had specific picks, suppress the pattern: the prompt rule is
  // that pattern fires ONLY when zero specifics pass. Defensive double-check
  // here in case the LLM hands us both.
  const cappedPicks = picks.slice(0, MAX_PICKS);
  if (cappedPicks.length > 0) {
    return { picks: cappedPicks, pattern: null };
  }
  return { picks: cappedPicks, pattern };
}

function buildCurationPrompt(opts: {
  contact: { firstName: string; fullName: string; title: string | null; bio: string | null; fitSummary: string | null };
  contactCompanyName: string | null;
  sellerCompany: { name: string | null; tagline: string | null; valueProps: unknown; capabilities: unknown; whyCustomersBuy: unknown } | null;
  buyingGroupFunctions: string[];
  buyingGroupSeniority: string[];
  contactPersonaFunctions: string[];
  candidates: Array<{ idx: number; signalType: string; isContact: boolean; title: string; summary: string | null }>;
}): string {
  const seller = opts.sellerCompany;
  const sellerBlock = seller
    ? JSON.stringify(
        {
          name: seller.name,
          tagline: seller.tagline,
          value_propositions: seller.valueProps,
          capabilities: seller.capabilities,
          why_customers_buy: seller.whyCustomersBuy,
        },
        null,
        2,
      )
    : '"(seller value-prop not configured)"';

  // Candidate lines are deliberately terse — full titles, no summaries.
  // Summaries usually duplicate the title and bloat the prompt for no signal.
  const candidateLines = opts.candidates
    .map(
      (c) =>
        `${c.idx}. [${c.signalType}, ${c.isContact ? 'about contact' : 'about company'}] ${c.title.slice(0, 140)}`,
    )
    .join('\n');

  const firstName = opts.contact.firstName || 'the contact';
  const coName = opts.contactCompanyName || 'the company';

  // The buying group = the functions/seniority we sell into (inferred per ICP).
  // It tells us WHO cares and WHY an angle lands — it is NOT a filter that
  // vetoes company signals by their originating department.
  const buyingGroupBlock =
    opts.buyingGroupFunctions.length > 0
      ? `WHO WE SELL INTO (the buying group)
- Functions we target: ${opts.buyingGroupFunctions.join(', ')}
- Seniority we target: ${opts.buyingGroupSeniority.length ? opts.buyingGroupSeniority.join(', ') : '(any)'}
${opts.contactPersonaFunctions.length ? `- ${firstName} sits in this buying group as: ${opts.contactPersonaFunctions.join(', ')}` : ''}

USE THIS to judge WHO cares and WHY an angle lands — NOT as a filter on which signals count. ${firstName} sits on the commercial / decision side, so they care about their company's TRAJECTORY: funding, regulatory approvals, indication/market expansion, hiring surges, new programs, deals, partnerships, a wave of publications or patents — anything that says the company is scaling or commercialising is a buying-relevant moment for them, EVEN WHEN the signal originates in science, regulatory, clinical, or manufacturing. Do NOT discard a signal just because it didn't come from ${firstName}'s own department. The only real noise is a trivial, isolated event in an unrelated function with no strategic read (e.g. a single HR or facilities hire). When in doubt, it's relevant.`
      : `WHO WE SELL INTO: (buying group not yet inferred for this account — judge relevance from ${firstName}'s title and what someone in their role owns, and from the company's overall trajectory.)`;

  return `You are picking outreach angles for a B2B sales rep.

CONTACT (the reader — the email must resonate with THEM)
- Name: ${firstName} (${opts.contact.fullName})
- Title: ${opts.contact.title ?? 'unknown'}
- At: ${coName}
- Bio: ${opts.contact.bio ?? '(none)'}
- Why a fit: ${opts.contact.fitSummary ?? '(not summarised)'}

OUR COMPANY (the seller)
${sellerBlock}

${buyingGroupBlock}

CANDIDATE SIGNALS (last ${LOOKBACK_DAYS} days)
${candidateLines}

═══ YOUR JOB ═══

The decision to reach out has ALREADY been made — this account cleared the fit + readiness gate before you were called. Your job is NOT to re-decide whether to reach out. It is to pick the BEST ANGLE(S) to open with. When the account has real recent activity (it does, or you wouldn't be here), you will almost always find at least one good angle. Returning nothing is reserved for the rare case where EVERY candidate is stale or a caution/setback — never for "no single signal is a perfect fit."

Pick up to ${MAX_PICKS} angles, strongest first.

CORE PRINCIPLE: a signal earns us the TIMING; the email has to RESONATE with ${firstName}. The angle does not have to BE a single signal — it has to be something ${firstName} would care about given their role and where their company is heading. A company that is publishing heavily, hiring fast, getting approvals, expanding indications, raising, or signing deals is in a buying-relevant moment, and that is itself a resonant reason to open a conversation with a commercial leader — even if no single item is a perfect standalone hook.

═══ THINK AT THE RIGHT ALTITUDE (read this twice) ═══

Reason like a SALES STRATEGIST, not a domain scientist. The question is "what does this activity MEAN about where ${coName} is as a business, and why would that make ${firstName} want to talk to us?" — NOT "does the technical content of this specific paper or patent match our product?"

Do NOT get into the weeds of a signal's subject matter. You do not need to understand the science in a publication or the claims in a patent. What matters is what their EXISTENCE, CATEGORY, and VOLUME mean:
- publishing heavily → active, well-resourced, scientifically productive
- many patents → investing, building IP, scaling
- FDA approval / indication expansion → commercialising, new revenue, new budget
- hiring surge → growth, new initiatives, new owners of problems
- new deal / partnership → money moving, momentum
Stack those up and the read is simple: "this company is busy, growing, and commercialising — a great moment to start a conversation." A commercial leader cares about THAT, regardless of whether any single paper's topic maps to our product. Zoom OUT. Do not reject a clearly-active account because the molecular detail of one signal doesn't tie to a value prop.

═══ THE GROUNDING BAR (every pick must clear all three) ═══

For each angle you pick, you must be able to:
1. Name ONE specific value_propositions item or capability from our_company it connects to. Not "what we do generally" — a named item from the list above.
2. Ground it in the FACT and SCALE of the activity — "filed 34 patents", "opened 17 roles", "won FDA approval", "published several papers this month", or a theme across signals. Ground on what HAPPENED, NOT on the technical content inside it. No inventing.
3. Say in plain English why it lands for ${firstName} given their role AND their company's trajectory. A commercial / BD / exec buyer caring about company momentum PASSES — the signal does NOT have to originate in their own function, and its subject matter does NOT have to match our product.

Drop a candidate only if it is stale, a caution/setback (never a hook), or genuinely irrelevant operational noise. Otherwise it is fair game.

═══ WHAT TO DROP ═══

- Caution / setback signals (program discontinued, trial halted, restructuring, leadership churn) — NEVER a hook, no exceptions.
- Genuinely old news (months/years old) when fresher activity exists.
- A trivial, isolated event in an unrelated function with no strategic read.

Publications, patents, hiring surges, approvals, expansions, deals, partnerships are ALL fair game when recent — on their own if strong, or combined into a momentum theme.

═══ HOW TO WRITE THE "reason" FIELD ═══

Write each reason like you're explaining it to a smart 13-year-old. Plain English.
A rep glances at this for 1 second and has to instantly understand WHY this hook is good.

HARD RULES:
- Maximum 20 words.
- One sentence. Simple subject-verb-object.
- For CONTACT-scope hooks: use "${firstName}" as the subject.
- For COMPANY-scope hooks: use "${coName}" as the subject.
- NEVER use pronouns: NO "she", NO "he", NO "her", NO "his", NO "they", NO "their". Always name the actual person or company.
- NO semicolons. NO em dashes. NO comma-splicing two clauses.
- BANNED WORDS: creates, implies, leverage, actionable, infrastructure, framework, alignment, prime, position, drive, enable, optimise, optimize, robust, holistic, paradigm, ecosystem, synergies, immediate need.
- Name what's HAPPENING then why the rep CARES. Stop.

GOOD examples:
- "${firstName} just got promoted with a bigger team, which usually means new budget."
- "${firstName}'s team is running a trial right now, which is when our tool actually saves time."
- "${coName}'s new partnership probably needs new analytics, which is what we do."

BAD examples (do not write like this):
- "Recent promotion creates immediate need for analytical infrastructure to manage expanded multi-arm datasets."  ← jargon, banned words, no clear subject
- "Her team is running live studies now; our monitoring helps identify when data becomes actionable."  ← banned pronoun, semicolon, banned word
- "First-author paper is fresh proof-point; rep can position our pipeline as tool to accelerate next analysis."  ← "position", "proof-point"
- "They recently raised funds, enabling them to invest in tooling."  ← pronoun, banned "enabling"

═══ MOMENTUM OPENER (use whenever no single signal is a clean standalone hook) ═══

If no single signal is a crisp standalone hook but the account is clearly active, DO NOT return empty. Emit ONE momentum opener in "pattern": name the visible pattern concretely (e.g. "${coName} has published several papers and opened 17 roles in the last few weeks", or "${coName} just won FDA approval and is expanding indications") and tie it to a named value_prop and to ${firstName}'s world. The VOLUME and direction of activity is a real, honest reason to reach out — it says the company is moving, which is exactly when ${firstName} would care.

The momentum opener must still name a real pattern grounded in the candidates (not a vague "lots going on") and connect to a named value_prop. But "several distinct signals all point to a company scaling/commercialising" IS such a pattern.

Only skip the momentum opener if literally every candidate is stale or a caution signal. NEVER emit it when you already have specific picks in "top" — it's the fallback, not a supplement.

═══ OUTPUT — strict JSON, no prose, no markdown fences ═══

{
  "top": [
    {
      "index": <candidate number from the list above>,
      "score": <0-100>,
      "reason": "<plain English, ≤20 words, names the subject by name not pronoun>",
      "seller_grounding": "<which named value_prop / capability from our_company this activates>",
      "signal_grounding": "<the specific fact from this candidate's title that proves the fit>",
      "contact_grounding": "<why this lands for ${firstName} specifically — what someone in their role owns that makes them care. If you cannot fill this honestly, the pick fails.>"
    }
    // ... up to ${MAX_PICKS} items, in score-descending order.
    // If no single signal is a clean standalone hook, leave "top" as [] and use "pattern" instead.
  ],
  "pattern": null
  // OR — when "top" is [] but the account is active, the MOMENTUM OPENER:
  // {
  //   "phrase": "<short observation, e.g. 'their recent wave of papers and open roles'>",
  //   "score": <0-100>,
  //   "reason": "<plain English, ≤20 words, same rules as above>",
  //   "seller_grounding": "<which named value_prop>",
  //   "signal_grounding": "<the theme summary, e.g. '3 papers + 17 roles + FDA approval in the last month'>"
  // }
}

Returning { "top": [], "pattern": null } is a LAST RESORT — only when every candidate is stale or a caution signal. For an active account you should return specific picks, or failing that a momentum opener. Do not refuse a clearly-active account.`;
}

/**
 * Run the curation LLM call. Three possible outcomes:
 *  - `{ hooks: [...], verdict: 'ok' }`        — LLM found grounded picks (or
 *                                                a fitting pattern fallback).
 *  - `{ hooks: [],    verdict: 'no_strong_hooks' }` — LLM evaluated and
 *                                                concluded nothing concrete
 *                                                fits. Honest empty state.
 *  - `null`                                    — LLM call itself failed
 *                                                (network / parse). Caller
 *                                                falls back to mechanical
 *                                                top-N so the picker still
 *                                                shows something.
 */
type CurationOutcome = { hooks: Hook[]; verdict: 'ok' | 'no_strong_hooks' };

async function curateHooks(
  candidates: Hook[],
  ctx: {
    userId: string;
    contactId: string;
    contact: { firstName: string; fullName: string; title: string | null; bio: string | null; fitSummary: string | null };
    contactCompanyName: string | null;
    sellerCompany: { name: string | null; tagline: string | null; valueProps: unknown; capabilities: unknown; whyCustomersBuy: unknown } | null;
    buyingGroupFunctions: string[];
    buyingGroupSeniority: string[];
    contactPersonaFunctions: string[];
  },
): Promise<CurationOutcome | null> {
  if (candidates.length === 0) return { hooks: [], verdict: 'no_strong_hooks' };
  const trimmed = candidates.slice(0, MAX_CANDIDATES_TO_SCORE);
  const prompt = buildCurationPrompt({
    contact: ctx.contact,
    contactCompanyName: ctx.contactCompanyName,
    sellerCompany: ctx.sellerCompany,
    buyingGroupFunctions: ctx.buyingGroupFunctions,
    buyingGroupSeniority: ctx.buyingGroupSeniority,
    contactPersonaFunctions: ctx.contactPersonaFunctions,
    candidates: trimmed.map((c, i) => ({
      idx: i + 1,
      signalType: c.signal_type ?? 'unknown',
      isContact: c.is_contact_level,
      title: c.title,
      summary: c.summary,
    })),
  });
  try {
    const completion = await completeLlm({
      feature: 'outreach_curate_hooks',
      prompt,
      maxTokens: 800,
      temperature: 0.2,
    });
    void recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'outreach_curate_hooks',
      route: 'app/api/outreach/hooks',
      model: completion.model,
      usage: completion.usage,
      metadata: { contact_id: ctx.contactId, candidate_count: trimmed.length },
    }).catch(() => {});

    const { picks, pattern } = parseCuration(completion.text, trimmed.length);

    // Path 1: specific grounded picks.
    if (picks.length > 0) {
      const hooks = picks.map((v) => ({
        ...trimmed[v.index - 1],
        ai_score: v.score,
        ai_reason: v.reason,
        ai_seller_grounding: v.seller_grounding,
        ai_signal_grounding: v.signal_grounding,
      }));
      return { hooks, verdict: 'ok' };
    }

    // Path 2: zero specifics — pattern observation fired AND fit the seller.
    if (pattern) {
      const patternHook: Hook = {
        source_type: 'derived',
        source_event_id: null,
        source_event_at: null,
        signal_type: 'pattern_observation',
        signal_label: 'Pattern',
        category: 'strategic',
        phrase: pattern.phrase,
        tier: 2,
        is_contact_level: false,
        title: pattern.phrase,
        summary: pattern.signal_grounding,
        ai_score: pattern.score,
        ai_reason: pattern.reason,
        ai_seller_grounding: pattern.seller_grounding,
        ai_signal_grounding: pattern.signal_grounding,
        is_pattern: true,
      };
      return { hooks: [patternHook], verdict: 'ok' };
    }

    // Path 3: LLM evaluated, found nothing worth surfacing. Honest empty.
    return { hooks: [], verdict: 'no_strong_hooks' };
  } catch (error) {
    console.error('[outreach/hooks] curation failed, falling back:', error);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const contactId = (url.searchParams.get('contactId') ?? '').trim();
    if (!contactId) {
      return NextResponse.json({ error: 'contactId required' }, { status: 400 });
    }

    // ── Existing-sequence lookup ───────────────────────────────────────────
    // The side panel needs to know if we've already drafted/sent/replied for
    // this contact so it can render a "you're already reaching out…" state
    // instead of the hook picker. Cheap query — by (user_id, contact_id,
    // created_at desc) using the existing index.
    const { data: existingSeqRow } = await supabase
      .from('outreach_sequences')
      .select('id, anchor_hook_text, anchor_signal_type, dispatch_status, dispatch_channel, dispatch_error, last_status_at, created_at')
      .eq('user_id', user.id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const existingSequence = existingSeqRow ?? null;

    // Look up the contact's company_id + name + scores + persona context.
    // The persona fields (first_name, full_name, title, bio, fit_summary)
    // are used by the curation LLM to judge which hooks make sense for this
    // specific person.
    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select(
        'id, company_id, company_name, contact_fit_score, readiness_score, ' +
          'first_name, full_name, job_title, contact_bio, contact_fit_summary, ' +
          'scored_against_persona_id, companies(company_name)',
      )
      .eq('user_id', user.id)
      .eq('id', contactId)
      .maybeSingle();
    if (contactErr) {
      return NextResponse.json({ error: contactErr.message }, { status: 500 });
    }
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    const contactRow = contact as {
      company_id?: string | null;
      company_name?: string | null;
      contact_fit_score?: number | null;
      readiness_score?: number | null;
      first_name?: string | null;
      full_name?: string | null;
      job_title?: string | null;
      contact_bio?: string[] | null;
      contact_fit_summary?: string | null;
      scored_against_persona_id?: string | null;
      companies?: { company_name?: string | null } | Array<{ company_name?: string | null }> | null;
    };
    const companyId = contactRow.company_id ?? null;
    const contactFit = typeof contactRow.contact_fit_score === 'number' ? contactRow.contact_fit_score : null;
    const contactReadiness = typeof contactRow.readiness_score === 'number' ? contactRow.readiness_score : null;
    // Prefer the canonical companies.company_name (cleaner) over the
    // denormalised contacts.company_name (often "Inc."-suffixed).
    const companiesField = Array.isArray(contactRow.companies)
      ? contactRow.companies[0]
      : contactRow.companies;
    const companyName: string | null =
      (companiesField?.company_name ?? null) ?? contactRow.company_name ?? null;

    // Pull company-side scores from user_companies (post-Phase-1d the
    // per-user scoring fields live here, not on companies).
    let companyFit: number | null = null;
    let companyReadiness: number | null = null;
    let matchedIcpId: string | null = null;
    if (companyId) {
      const { data: uc } = await supabase
        .from('user_companies')
        .select('company_fit_score, readiness_score, matched_icp_id')
        .eq('user_id', user.id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (uc) {
        const ucRow = uc as {
          company_fit_score?: number | null;
          readiness_score?: number | null;
          matched_icp_id?: string | null;
        };
        companyFit = typeof ucRow.company_fit_score === 'number' ? ucRow.company_fit_score : null;
        companyReadiness = typeof ucRow.readiness_score === 'number' ? ucRow.readiness_score : null;
        matchedIcpId = ucRow.matched_icp_id ?? null;
      }
    }

    // Buying group = the functions/seniority we actually sell INTO, inferred per
    // ICP (table `personas`). This is the authoritative ground truth for judging
    // whether a company signal is relevant: hiring in a function we don't sell to
    // (e.g. HR roles when we sell into R&D) is noise, no matter how strong the
    // signal. We also pick out the contact's own matched persona so the curation
    // LLM knows which slice of the buying group THIS reader occupies.
    let buyingGroupFunctions: string[] = [];
    let buyingGroupSeniority: string[] = [];
    let contactPersonaFunctions: string[] = [];
    if (matchedIcpId) {
      const { data: personas } = await supabase
        .from('personas')
        .select('id, functions, seniority_levels')
        .eq('icp_id', matchedIcpId);
      const personaRows = (personas ?? []) as Array<{
        id: string;
        functions?: string[] | null;
        seniority_levels?: string[] | null;
      }>;
      const fnSet = new Set<string>();
      const snSet = new Set<string>();
      for (const p of personaRows) {
        for (const f of personaFunctionNames(p.functions)) fnSet.add(f);
        for (const s of p.seniority_levels ?? []) if (s) snSet.add(s);
        if (p.id === contactRow.scored_against_persona_id) {
          contactPersonaFunctions = personaFunctionNames(p.functions);
        }
      }
      buyingGroupFunctions = [...fnSet];
      buyingGroupSeniority = [...snSet];
    }

    // The gate IS the action model: only "reach out" contacts get hooks.
    // effectiveReadiness folds company + contact readiness (max + bump) so a
    // strong contact at a hot company qualifies even with no personal signal.
    const effReadiness = effectiveReadiness(companyReadiness, contactReadiness);
    const action = getActionFromScores(companyFit, contactFit, effReadiness, null);

    if (action !== 'reach_out') {
      const gating: GatingScores = {
        contact_fit_score: contactFit,
        company_fit_score: companyFit,
        contact_readiness_score: contactReadiness,
        company_readiness_score: companyReadiness,
        threshold: HIGH_SCORE,
        // 'monitor' = fits high but readiness low; otherwise a fit gate failed.
        reason: !companyId ? 'no_company' : action === 'monitor' ? 'readiness_below_threshold' : 'fit_below_threshold',
      };
      return NextResponse.json({ hooks: [], gated: true, gating, existing_sequence: existingSequence });
    }

    // Pull signals from the lookback window — contact-scoped OR company-scoped.
    const cutoffIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const filterExpr = companyId
      ? `entity_contact_id.eq.${contactId},entity_company_id.eq.${companyId}`
      : `entity_contact_id.eq.${contactId}`;

    const { data: signals, error: signalsErr } = await supabase
      .from('signal_source_events')
      .select('id, source_event_type, title, summary, event_at, entity_company_id, entity_contact_id')
      .eq('user_id', user.id)
      .or(filterExpr)
      .gte('event_at', cutoffIso)
      .order('event_at', { ascending: false })
      // Pull a wide buffer so the tier-based re-rank below has enough volume
      // to surface high-value signals even when generic publications dominate
      // the raw date order.
      .limit(40);
    if (signalsErr) {
      return NextResponse.json({ error: signalsErr.message }, { status: 500 });
    }

    // Dedupe by the HUMANIZED label, not raw source_event_type. Four raw
    // types — publication, pubmed_publication, new_paper_published,
    // pubmed_contact_paper — all humanize to "Publication" and would otherwise
    // surface as 4 identical cards. Grouping by label collapses them to one.
    // Within each label group: prefer contact-scope, then most recent.
    const bestByLabel = new Map<string, SignalRow>();
    for (const s of (signals ?? []) as SignalRow[]) {
      if (!s.source_event_type || !s.title) continue;
      // Hard rule: CRM-internal status/pipeline updates are never outreach hooks.
      if (CRM_INTERNAL_EVENT_TYPES.has(s.source_event_type)) continue;
      const label = humanizeSignalType(s.source_event_type);
      const existing = bestByLabel.get(label);
      if (!existing) {
        bestByLabel.set(label, s);
        continue;
      }
      const newIsContact = s.entity_contact_id === contactId;
      const existingIsContact = existing.entity_contact_id === contactId;
      if (newIsContact && !existingIsContact) {
        bestByLabel.set(label, s);
        continue;
      }
      if (existingIsContact && !newIsContact) continue;
      // Same scope class — pick the most recent.
      const newTime = s.event_at ? Date.parse(s.event_at) : 0;
      const existingTime = existing.event_at ? Date.parse(existing.event_at) : 0;
      if (newTime > existingTime) bestByLabel.set(label, s);
    }

    const hooksAll: Hook[] = [];
    for (const s of bestByLabel.values()) {
      const isContactLevel = s.entity_contact_id === contactId;
      const signalLabel = humanizeSignalType(s.source_event_type);
      const cleanedTitle = cleanTitle(s.title, s.source_event_type);
      const phrase = phraseFor(s.source_event_type, signalLabel, isContactLevel, companyName);
      hooksAll.push({
        source_type: 'signal',
        source_event_id: s.id,
        source_event_at: s.event_at,
        signal_type: s.source_event_type,
        signal_label: signalLabel,
        category: categoryFor(s.source_event_type),
        phrase,
        tier: tierFor(s.source_event_type),
        is_contact_level: isContactLevel,
        title: cleanedTitle,
        summary: s.summary,
      });
    }

    // Order: contact-scope hooks first, then company-scope. Within each,
    // sort by tier (lower = stronger) then most recent.
    const byTierThenRecency = (a: Hook, b: Hook) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const at = a.source_event_at ? Date.parse(a.source_event_at) : 0;
      const bt = b.source_event_at ? Date.parse(b.source_event_at) : 0;
      return bt - at;
    };
    const contactLevel = hooksAll.filter((h) => h.is_contact_level).sort(byTierThenRecency);
    const companyLevel = hooksAll.filter((h) => !h.is_contact_level).sort(byTierThenRecency);

    // Mechanical pre-rank (still useful as the LLM input order + fallback).
    const mechanicalHooks = [...contactLevel, ...companyLevel].slice(0, MAX_HOOKS);

    if (mechanicalHooks.length === 0) {
      return NextResponse.json({ hooks: [], existing_sequence: existingSequence });
    }

    // ── AI curation pass ────────────────────────────────────────────────────
    // Score the mechanical shortlist against the seller's value prop and pick
    // the strongest 3 with one-line reasoning. Falls back to the mechanical
    // shortlist on any failure.
    const { data: sellerCompanyRow } = await supabase
      .from('user_company')
      .select('company_name, tagline, value_propositions, capabilities, why_customers_buy')
      .eq('user_id', user.id)
      .maybeSingle();
    const sellerCompany = sellerCompanyRow
      ? {
          name: (sellerCompanyRow as { company_name?: string | null }).company_name ?? null,
          tagline: (sellerCompanyRow as { tagline?: string | null }).tagline ?? null,
          valueProps: (sellerCompanyRow as { value_propositions?: unknown }).value_propositions ?? null,
          capabilities: (sellerCompanyRow as { capabilities?: unknown }).capabilities ?? null,
          whyCustomersBuy: (sellerCompanyRow as { why_customers_buy?: unknown }).why_customers_buy ?? null,
        }
      : null;

    const bioText = Array.isArray(contactRow.contact_bio)
      ? contactRow.contact_bio.filter(Boolean).join(' ')
      : null;

    const curated = await curateHooks(mechanicalHooks, {
      userId: user.id,
      contactId,
      contact: {
        firstName: contactRow.first_name ?? '',
        fullName: contactRow.full_name ?? '',
        title: contactRow.job_title ?? null,
        bio: bioText,
        fitSummary: contactRow.contact_fit_summary ?? null,
      },
      contactCompanyName: companyName,
      sellerCompany,
      buyingGroupFunctions,
      buyingGroupSeniority,
      contactPersonaFunctions,
    });

    // Three response paths, matching the curation outcomes:
    //   • curated === null            → LLM failed. Mechanical fallback so
    //                                    the rep still sees something.
    //   • curated.verdict === 'ok'    → AI found grounded picks (or pattern).
    //                                    Surface them.
    //   • verdict === 'no_strong_hooks' → AI evaluated and concluded nothing
    //                                    fits. Surface honestly, NOT mechanical
    //                                    — mechanical here would put back
    //                                    exactly what the AI rejected.
    if (!curated) {
      return NextResponse.json({
        hooks: mechanicalHooks.slice(0, MAX_PICKS),
        curation: 'mechanical',
        existing_sequence: existingSequence,
      });
    }
    return NextResponse.json({
      hooks: curated.hooks,
      curation: 'ai',
      ai_verdict: curated.verdict,
      existing_sequence: existingSequence,
    });
  } catch (error) {
    console.error('Error in outreach/hooks GET:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
