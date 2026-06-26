import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CREDITS, FREE_TIER, PLANS, type BillingPlanKey, planConfig } from './config';

test('plans include a shared monthly lead-enrichment credit pool', () => {
  assert.equal(FREE_TIER.caps.leadEnrichmentCreditsIncludedMonthly, 60);
  assert.equal(PLANS.starter.caps.leadEnrichmentCreditsIncludedMonthly, 1_200);
  assert.equal(PLANS.growth.caps.leadEnrichmentCreditsIncludedMonthly, 5_600);
});

test('outreach sequence generation costs 7 Arcova credits', () => {
  assert.equal(ACTION_CREDITS.outreach_sequence, 7);
});

function packageMixCredits(planKey: BillingPlanKey) {
  const plan = planConfig(planKey);
  const caps = plan.caps;
  return (
    caps.leadEnrichmentCreditsIncludedMonthly +
    caps.outreachSequencesIncludedMonthly * ACTION_CREDITS.outreach_sequence +
    caps.emailFinderRequestsIncludedMonthly * ACTION_CREDITS.email_finder +
    caps.phoneRevealsIncludedMonthly * ACTION_CREDITS.phone_reveal
  );
}

test('shared lead-enrichment pool preserves old imported plus net-new package math', () => {
  for (const planKey of ['free', 'starter', 'growth'] as const) {
    const caps = planConfig(planKey).caps;
    assert.equal(
      caps.leadEnrichmentCreditsIncludedMonthly,
      caps.importedEnrichmentsIncludedMonthly * ACTION_CREDITS.imported_contact_company_enrichment +
        caps.netNewEnrichedLeadsMonthly * ACTION_CREDITS.net_new_enriched_lead,
    );
  }
});

test('listed monthly action mix fits inside each monthly credit grant', () => {
  assert.equal(packageMixCredits('free'), 98);
  assert.equal(packageMixCredits('starter'), 1997);
  assert.equal(packageMixCredits('growth'), 7998);
  assert.ok(packageMixCredits('free') <= FREE_TIER.monthlyCredits);
  assert.ok(packageMixCredits('starter') <= PLANS.starter.monthlyCredits);
  assert.ok(packageMixCredits('growth') <= PLANS.growth.monthlyCredits);
});
