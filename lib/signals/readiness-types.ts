export type ReadinessDimension =
  | 'new_budget'
  | 'new_needs'
  | 'new_people'
  | 'new_strategy'
  | 'caution';

export type SignalScope = 'company' | 'contact';

export type SignalStrength = 'weak' | 'medium' | 'strong';

export type ConfidenceLabel = 'low' | 'medium' | 'high';

export type ReadinessLabel = 'low' | 'medium' | 'high';

export type BuyerFunction =
  | 'executive_leadership'
  | 'business_development'
  | 'partnerships'
  | 'clinical_operations'
  | 'research_and_development'
  | 'regulatory_affairs'
  | 'manufacturing_and_cmc'
  | 'medical_affairs'
  | 'commercial'
  | 'sales_operations'
  | 'procurement'
  | 'strategy_and_corporate_development'
  | 'lab_operations'
  | 'technology_and_systems'
  | 'ai_and_machine_learning'
  | 'data_and_informatics'
  | 'quality_and_compliance'
  | 'marketing';

export type IntentMechanism =
  | 'budget_created'
  | 'complexity_increased'
  | 'team_buildout'
  | 'leadership_change'
  | 'program_advance'
  | 'strategy_shift'
  | 'commercial_interest'
  | 'suppression';

export type SignalKey =
  | 'funding_round'
  | 'grant_award'
  | 'ipo_or_follow_on'
  | 'milestone_payment'
  | 'partnership_with_upfront_economics'
  | 'ma_event'
  | 'demo_requested'
  | 'inbound_enquiry'
  | 'open_opportunity_in_crm'
  | 'new_contact_added_in_crm'
  | 'closed_lost_in_crm'
  | 'clinical_trial_registered'
  | 'phase_transition'
  | 'trial_site_expansion'
  | 'indication_expansion'
  | 'breakthrough_designation'
  | 'fda_approval'
  | 'new_facility'
  | 'facility_expansion'
  | 'cmc_scale_up'
  | 'cdmo_partnership'
  | 'quality_compliance_buildout'
  | 'visited_your_website'
  | 'attended_your_webinar_or_event'
  | 'downloaded_your_content'
  | 'responded_to_previous_outreach'
  | 'cmc_hiring'
  | 'clinical_ops_hiring'
  | 'regulatory_hiring'
  | 'bd_hiring'
  | 'commercial_hiring'
  | 'job_surge'
  | 'new_to_role'
  | 'recently_promoted'
  | 'recently_changed_company'
  | 'new_internal_role'
  | 'title_change'
  | 'board_or_advisory_role'
  | 'partnership_deal'
  | 'licensing_deal'
  | 'co_development_deal'
  | 'regional_expansion'
  | 'commercialization_move'
  | 'platform_repositioning'
  | 'conference_presentation'
  | 'conference_speaker'
  | 'publication'
  | 'new_paper_published'
  | 'patent_filed_or_granted'
  | 'layoffs'
  | 'trial_failure_or_halt'
  | 'program_discontinuation'
  | 'restructuring'
  | 'distressed_financing'
  | 'acquisition_distraction'
  | 'leadership_churn'
  | 'lapsed_customer';

export type SignalCatalogEntry = {
  signalKey: SignalKey;
  scope: SignalScope;
  dimensions: ReadinessDimension[];
  defaultStrength: SignalStrength;
  /** Base category impact out of 100 before confidence, recency, and relevance adjustments. */
  baseImpactScore: number;
  defaultConfidence: ConfidenceLabel;
  decayDays: number;
  buyerFunctions: BuyerFunction[];
  intentMechanisms: IntentMechanism[];
  notes?: string;
};

export type RawSignalEvent = {
  id: string;
  userId: string;
  entityId: string;
  entityScope: SignalScope;
  source: string;
  sourceUrl: string | null;
  sourceEventType: string;
  sourceEventId: string | null;
  title: string | null;
  summary: string | null;
  excerpt: string | null;
  eventAt: string | null;
  observedAt: string;
  metadata: Record<string, unknown>;
};

export type NormalizedSignal = {
  id: string;
  rawSignalEventId: string;
  signalKey: SignalKey;
  scope: SignalScope;
  entityId: string;
  dimensions: ReadinessDimension[];
  buyerFunctions: BuyerFunction[];
  intentMechanisms: IntentMechanism[];
  defaultStrength: SignalStrength;
  defaultConfidence: ConfidenceLabel;
  eventAt: string | null;
  observedAt: string;
  evidenceExcerpt: string | null;
};

export type SignalEvidence = {
  id: string;
  signalKey: SignalKey;
  scope: SignalScope;
  source: string;
  sourceUrl: string | null;
  eventAt: string | null;
  excerpt: string | null;
  confidenceLabel: ConfidenceLabel;
};

export type DimensionState = {
  score: number;
  label: ReadinessLabel;
  confidenceLabel: ConfidenceLabel;
  evidenceIds: string[];
};

export type AccountReason = {
  summaryShort: string;
  summaryLong: string;
  whyNow: string;
  affectedFunctions: BuyerFunction[];
  suggestedAngle: string;
  confidenceLabel: ConfidenceLabel;
};

export type AccountReadinessState = {
  overallScore: number;
  overallLabel: ReadinessLabel;
  newBudget: DimensionState;
  newNeeds: DimensionState;
  newPeople: DimensionState;
  newStrategy: DimensionState;
  caution: DimensionState;
};

export type RecommendedRouteContact = {
  contactId: string;
  fullName: string;
  title: string | null;
  buyerFunctions: BuyerFunction[];
  rationale: string | null;
};

export type AccountReadinessContext = {
  accountId: string;
  companyName: string;
  fit: {
    score: number;
    label: ReadinessLabel;
  };
  readiness: AccountReadinessState;
  reason: AccountReason;
  route: {
    recommendedContacts: RecommendedRouteContact[];
  };
  topSignals: SignalEvidence[];
};

export type ReadinessScoreInputs = {
  strengthWeight: number;
  confidenceMultiplier: number;
  recencyMultiplier: number;
  relevanceMultiplier: number;
};

export type DimensionContribution = {
  signalId: string;
  dimension: ReadinessDimension;
  contribution: number;
  inputs: ReadinessScoreInputs;
};
