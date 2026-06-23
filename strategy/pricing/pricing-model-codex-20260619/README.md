# Arcova Pricing Model — Codex — 2026-06-19

This folder consolidates the commercial model, credit-system design, cost analysis, and calculators produced during the June 2026 pricing redesign.

## Source-of-truth order

1. `ARCOVA_PRICING_AND_CREDIT_SPEC.md` — commercial plans, credits, caps, action prices, and customer-facing rules.
2. `PACKAGE_COMPARISON.md` — compact package comparison for Free, Starter, Growth, and Custom.
3. `lib/billing/config.ts` — live application configuration. This remains in the application codebase.
4. `BILLING_PLAN.md` — implementation status, Stripe setup, rollout, and enforcement plan.
5. `PRICING_AND_COST_BASIS.md` — COGS, margin policy, and pricing rationale.

## Supporting analysis and tools

- `Arcova_Pricing_Model.xlsx` — main pricing and profitability workbook.
- `ARCOVA_CREDIT_CALCULATOR.xlsx` — tier and credit calculator.
- `DATA_TOUCHPOINTS_AND_COST.md` — action/provider cost inventory.
- `DATA_COST_CALCULATOR.html` — interactive cost calculator.
Application code, customer-facing product pages, and database migrations intentionally remain in their normal repository locations.

## Database migration history

Historical migrations are retained in `supabase/migrations/` because Supabase migration history must remain reproducible:

- `20260613_billing_foundation.sql` — originally created the subscription cache, contact packs, and billable-contact meter.
- `20260613_billing_consume_rpc.sql` — originally created the retired contact-consumption RPC.
- `20260616_billing_export_events.sql` — originally created the retired export counter.

Those files are history only. Their obsolete database objects are removed by:

- `20260618225522_remove_legacy_pricing_schema.sql`

The current credit system is created and maintained by the `20260619_arcova_*` migrations in the same directory. Do not use the older migrations as product or pricing specifications.
