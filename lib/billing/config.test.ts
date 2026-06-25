import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_CREDITS, FREE_TIER, PLANS, type BillingPlanKey, planConfig } from './config';

test('Starter includes 250 monthly imported contact and company enrichments', () => {
  assert.equal(PLANS.starter.caps.importedEnrichmentsIncludedMonthly, 250);
});

test('outreach sequence generation costs 7 Arcova credits', () => {
  assert.equal(ACTION_CREDITS.outreach_sequence, 7);
});

function packageMixCredits(planKey: BillingPlanKey) {
  const plan = planConfig(planKey);
  const caps = plan.caps;
  return (
    caps.importedEnrichmentsIncludedMonthly * ACTION_CREDITS.imported_contact_company_enrichment +
    caps.netNewEnrichedLeadsMonthly * ACTION_CREDITS.net_new_enriched_lead +
    caps.outreachSequencesIncludedMonthly * ACTION_CREDITS.outreach_sequence +
    caps.emailFinderRequestsIncludedMonthly * ACTION_CREDITS.email_finder +
    caps.phoneRevealsIncludedMonthly * ACTION_CREDITS.phone_reveal
  );
}

test('listed monthly action mix fits inside each monthly credit grant', () => {
  assert.equal(packageMixCredits('free'), 98);
  assert.equal(packageMixCredits('starter'), 1997);
  assert.equal(packageMixCredits('growth'), 7998);
  assert.ok(packageMixCredits('free') <= FREE_TIER.monthlyCredits);
  assert.ok(packageMixCredits('starter') <= PLANS.starter.monthlyCredits);
  assert.ok(packageMixCredits('growth') <= PLANS.growth.monthlyCredits);
});
