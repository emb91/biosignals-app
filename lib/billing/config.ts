/**
 * Arcova's commercial catalog and entitlement source of truth.
 *
 * Customer credits price product value. Provider costs are recorded separately
 * in fractional dollars and must never be exposed through customer APIs.
 */

export type PlanKey = 'starter' | 'growth';
export type BillingPlanKey = 'free' | PlanKey;
export type BillingInterval = 'monthly' | 'annual';

export type UsageCaps = {
  activeIcps: number;
  activeMonitoredContacts: number;
  internalMonitoredAccounts: number;
  monitoringCadenceDays: number;
  importedRecordsTriagedMonthly: number;
  leadEnrichmentCreditsIncludedMonthly: number;
  /** @deprecated Use leadEnrichmentCreditsIncludedMonthly for customer-facing included lead-enrichment allowance. */
  importedEnrichmentsIncludedMonthly: number;
  importedEnrichmentsHardCapMonthly: number;
  /** @deprecated Use leadEnrichmentCreditsIncludedMonthly for customer-facing included lead-enrichment allowance. */
  netNewEnrichedLeadsMonthly: number;
  outreachSequencesIncludedMonthly: number;
  phoneRevealsIncludedMonthly: number;
  emailFinderRequestsIncludedMonthly: number;
};

export type PlanConfig = {
  key: PlanKey;
  name: string;
  monthlyUsd: number;
  annualUsd: number;
  monthlyCredits: number;
  annualCredits: number;
  workspaceUsers: number;
  creditPackUsdPer1k: number;
  caps: UsageCaps;
  priceEnv: string;
  annualPriceEnv: string;
  creditPackPriceEnv: string;
  lookupKey: string;
  annualLookupKey: string;
  creditPackLookupKey: string;
};

const FREE_CAPS: UsageCaps = {
  activeIcps: 1,
  activeMonitoredContacts: 100,
  internalMonitoredAccounts: 100,
  monitoringCadenceDays: 30,
  importedRecordsTriagedMonthly: 500,
  leadEnrichmentCreditsIncludedMonthly: 60,
  importedEnrichmentsIncludedMonthly: 10,
  importedEnrichmentsHardCapMonthly: 10,
  netNewEnrichedLeadsMonthly: 5,
  outreachSequencesIncludedMonthly: 1,
  phoneRevealsIncludedMonthly: 1,
  emailFinderRequestsIncludedMonthly: 1,
};

const STARTER_CAPS: UsageCaps = {
  activeIcps: 3,
  activeMonitoredContacts: 5_000,
  internalMonitoredAccounts: 1_250,
  monitoringCadenceDays: 30,
  importedRecordsTriagedMonthly: 10_000,
  leadEnrichmentCreditsIncludedMonthly: 1_200,
  importedEnrichmentsIncludedMonthly: 250,
  importedEnrichmentsHardCapMonthly: 5_000,
  netNewEnrichedLeadsMonthly: 50,
  outreachSequencesIncludedMonthly: 66,
  phoneRevealsIncludedMonthly: 3,
  emailFinderRequestsIncludedMonthly: 25,
};

const GROWTH_CAPS: UsageCaps = {
  activeIcps: 10,
  activeMonitoredContacts: 10_000,
  internalMonitoredAccounts: 2_500,
  monitoringCadenceDays: 7,
  importedRecordsTriagedMonthly: 50_000,
  leadEnrichmentCreditsIncludedMonthly: 5_600,
  importedEnrichmentsIncludedMonthly: 1_200,
  importedEnrichmentsHardCapMonthly: 10_000,
  netNewEnrichedLeadsMonthly: 200,
  outreachSequencesIncludedMonthly: 214,
  phoneRevealsIncludedMonthly: 12,
  emailFinderRequestsIncludedMonthly: 60,
};

export const PLANS: Record<PlanKey, PlanConfig> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    monthlyUsd: 149,
    annualUsd: 1_490,
    monthlyCredits: 2_000,
    annualCredits: 24_000,
    workspaceUsers: Number.MAX_SAFE_INTEGER,
    creditPackUsdPer1k: 100,
    caps: STARTER_CAPS,
    priceEnv: 'STRIPE_PRICE_STARTER_WORKSPACE',
    annualPriceEnv: 'STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL',
    creditPackPriceEnv: 'STRIPE_PRICE_STARTER_CREDITS_1000',
    lookupKey: 'arcova_starter_workspace_monthly',
    annualLookupKey: 'arcova_starter_workspace_annual',
    creditPackLookupKey: 'arcova_starter_credits_1000',
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    monthlyUsd: 799,
    annualUsd: 7_990,
    monthlyCredits: 8_000,
    annualCredits: 96_000,
    workspaceUsers: Number.MAX_SAFE_INTEGER,
    creditPackUsdPer1k: 70,
    caps: GROWTH_CAPS,
    priceEnv: 'STRIPE_PRICE_GROWTH_WORKSPACE',
    annualPriceEnv: 'STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL',
    creditPackPriceEnv: 'STRIPE_PRICE_GROWTH_CREDITS_1000',
    lookupKey: 'arcova_growth_workspace_monthly',
    annualLookupKey: 'arcova_growth_workspace_annual',
    creditPackLookupKey: 'arcova_growth_credits_1000',
  },
};

export const FREE_TIER = {
  name: 'Free',
  monthlyCredits: 100,
  seatLimit: 1,
  caps: FREE_CAPS,
} as const;

export const ACTION_CREDITS = {
  imported_contact_company_enrichment: 4,
  company_enrichment: 3,
  // Standalone validation only. Imported enrichment, net-new enrichment, and
  // email finder include ZeroBounce validation inside their action cost.
  email_validation: 0.5,
  email_finder: 11,
  phone_reveal: 20,
  net_new_enriched_lead: 4,
  manual_contact_refresh: 4,
  outreach_sequence: 7,
  scheduled_monitoring: 0,
  job_change_maintenance: 0,
  raw_import: 0,
  cached_rescore: 0,
} as const;

export type CreditAction = keyof typeof ACTION_CREDITS;

export const CREDIT_PACK_SIZE = 1_000;
export const PAYMENT_GRACE_DAYS = 7;

export function isPlanKey(value: unknown): value is PlanKey {
  return value === 'starter' || value === 'growth';
}

export function planConfig(key: BillingPlanKey): { name: string; monthlyCredits: number; caps: UsageCaps } {
  return key === 'free' ? FREE_TIER : PLANS[key];
}

export function planPriceId(plan: PlanConfig): string | null {
  return process.env[plan.priceEnv] || null;
}

export function planAnnualPriceId(plan: PlanConfig): string | null {
  return process.env[plan.annualPriceEnv] || null;
}

export function creditPackPriceId(planKey: PlanKey): string | null {
  const plan = PLANS[planKey];
  return process.env[plan.creditPackPriceEnv] || null;
}

export function planForPriceId(priceId: string | null | undefined): PlanConfig | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (
      planPriceId(plan) === priceId ||
      planAnnualPriceId(plan) === priceId
    ) return plan;
  }
  return null;
}

export function intervalForPriceId(priceId: string | null | undefined): BillingInterval {
  if (!priceId) return 'monthly';
  for (const plan of Object.values(PLANS)) {
    if (planAnnualPriceId(plan) === priceId) return 'annual';
  }
  return 'monthly';
}
