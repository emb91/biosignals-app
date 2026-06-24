# Arcova Billing Go-Live Plan

**Status:** Workspace credit system implemented; launch enforcement remains off

**Commercial source of truth:** `ARCOVA_PRICING_AND_CREDIT_SPEC.md`

**Runtime source of truth:** `lib/billing/config.ts`

## Current commercial model

Arcova uses fixed workspace pricing. It is not priced per seat.

| Tier | Monthly | Annual | Users | Active ICPs | Credits |
|---|---:|---:|---:|---:|---:|
| Free | $0 | — | 1 | 1 | 100/month |
| Starter | $149/workspace | $1,490/workspace | Unlimited | 3 | 2,000/month or 24,000 upfront annually |
| Growth | $799/workspace | $7,990/workspace | Unlimited | 10 | 8,000/month or 96,000 upfront annually |

Credit packs:

- Starter: $100 per 1,000 credits.
- Growth: $70 per 1,000 credits.
- Purchased credits expire after 12 months.
- Purchased credits increase spending power but do not increase active ICP capacity,
  active-lead capacity, or monitoring cadence.

Annual plans provide two months free. The full annual credit grant is provided upfront and
can be spent at the customer's chosen pace. The UI should warn when annual usage is ahead
of the normal monthly rhythm, but should not block solely because of pace.

## Billing architecture now implemented

- One Stripe Customer and one subscription per workspace.
- Monthly and annual Stripe prices for Starter and Growth.
- Tier-specific one-time credit-pack products.
- Workspace-level credit buckets, transactions, allocations, and usage counters.
- Earliest-expiry-first credit spending and exact-bucket refunds.
- Idempotent webhook grants and purchases.
- Seven-day failed-payment grace period.
- Read/export access remains available after grace; new paid actions and monitoring pause.
- Stripe subscription, payment-failure, recovery, and cancellation webhooks trigger a
  best-effort monitoring-universe reconciliation so plan changes update cadence without
  waiting for the next cron sweep. The cron refresh remains the safety net.
- Shared monitoring cadence scaffold is in place: org-scoped account/contact subscribers
  populate source-specific sweep targets, with effective acquisition cadence set to the
  fastest active subscriber for each canonical entity.
- Workspaces owned by an exact `@arcova.bio` email are automatically complimentary:
  unlimited entitlements, no customer-credit debits, and no Stripe checkout. Inviting an
  Arcova user into a customer-owned workspace does not exempt that customer workspace.

The workspace credit ledger is authoritative for Arcova actions.

## Required Stripe environment variables

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER_WORKSPACE
STRIPE_PRICE_STARTER_WORKSPACE_ANNUAL
STRIPE_PRICE_GROWTH_WORKSPACE
STRIPE_PRICE_GROWTH_WORKSPACE_ANNUAL
STRIPE_PRICE_STARTER_CREDITS_1000
STRIPE_PRICE_GROWTH_CREDITS_1000
```

Generate the catalog with `node scripts/stripe-bootstrap.mjs`, then install the returned price IDs in
Vercel. Stripe subscription quantity must remain `1` because the subscription represents the workspace.

## Enforcement rollout

1. Keep `ARCOVA_CREDIT_ENFORCEMENT` unset or `false`.
2. Run at least seven days of shadow reconciliation.
3. Compare:
   - settled customer credits by action;
   - provider costs by workspace and actor;
   - duplicate/cache-hit refunds;
   - usage-cap counters;
   - active monitoring coverage and overdue sweeps.
4. Enable selected actions first with:

   ```text
   ARCOVA_CREDIT_ENFORCEMENT_ACTIONS=action_one,action_two
   ```

5. Enable all actions only after reconciliation:

   ```text
   ARCOVA_CREDIT_ENFORCEMENT=true
   ```

## Pre-launch acceptance checks

- Checkout succeeds for Starter and Growth, monthly and annual.
- Annual customers receive all annual credits once, upfront.
- Credit-pack purchases grant exactly 1,000 purchased credits and are idempotent.
- Monthly, annual, purchased, and adjustment buckets expire correctly.
- Concurrent requests cannot overspend the workspace.
- Failed and partial actions return credits to their original buckets.
- Imported enrichment switches to purchased credits after its included allocation.
- Purchased credits do not override active ICP capacity, active-lead capacity, or monitoring cadence.
- Imported enrichment and net-new data can continue with purchased credits until active-lead capacity is reached.
- New ICP creation is blocked at the active ICP cap; editing an existing ICP remains allowed.
- Annual customers see pace warnings before unusually large burns of their annual included credits.
- Payment failure enters grace, then pauses paid actions without hiding customer data.
- Webhook replay does not duplicate subscription or credit grants.
- Self-serve upgrade, downgrade, cancellation, failed-payment grace expiry, and recovery
  recompute monitored account/contact subscriber rows and source sweep targets.
- If one Growth workspace and one Starter workspace monitor the same canonical company,
  the company/source acquisition target becomes weekly once, while Starter attribution
  remains monthly.
- If the last Growth subscriber leaves an entity, the shared target falls back to the
  fastest remaining active subscriber cadence; if no active subscribers remain, it is
  marked `no_subscribers`.
- Customer interfaces never expose provider names or backend enrichment sequencing.

## Operational reporting

Use `/api/admin/billing-operations` for the internal workspace view:

- settled customer credits;
- actual provider cost;
- profiles and companies attempted;
- jobs returned;
- monitored and waitlisted contacts/accounts;
- due sweeps and monitoring coverage SLA.

## Deferred

- Custom tier.
- Postpaid Stripe usage billing.
- More credit-pack sizes.
- Dynamic plan recommendations based on observed usage.
- Dispatcher cutover from per-org Apify/PubMed sweeps to shared entity/source sweep
  targets with fan-out. The cadence tables are ready first; the expensive scrape
  dedupe cutover should ship behind a measured before/after cost report.
