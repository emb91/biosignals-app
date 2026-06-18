# Arcova Pricing and Cost Basis

**Status:** Current operating summary
**Last updated:** 19 June 2026
**Commercial source of truth:** `ARCOVA_PRICING_AND_CREDIT_SPEC.md`

## Pricing

| Plan | Monthly price | Annual price | Included credits | Active leads | Monitoring |
|---|---:|---:|---:|---:|---|
| Free | $0 | — | 100/month | 100 | Monthly |
| Starter | $149/workspace | $1,490/workspace | 2,000/month or 24,000 upfront | 5,000 | Monthly |
| Growth | $799/workspace | $7,990/workspace | 8,000/month or 96,000 upfront | 10,000 | Weekly |

Paid plans include unlimited workspace users. Adding users does not multiply credits or caps.

Credit packs:

- Starter: $100 per 1,000 credits.
- Growth: $70 per 1,000 credits.
- Purchased credits expire after 12 months and do not bypass plan caps.

## Customer credits versus internal cost

These are deliberately separate systems:

- **Customer credits** price completed product actions and should target strong action-level margin.
- **Provider COGS** is recorded in fractional US dollars from actual provider usage.
- **$0.01 is an internal cost-credit reference only.** It does not determine customer credit prices.
- Legacy internal acquisition units remain an abuse/cost governor and are never customer-facing.

Customer action prices:

| Action | Credits |
|---|---:|
| Imported contact and company enrichment | 4 |
| Company-only enrichment | 3 |
| Email validation | 0.5 when billable |
| Successful new-email lookup and validation | 11 |
| Phone reveal | 20 |
| Net-new enriched lead | 4 |
| Manual contact refresh | 4 |
| Seven-touch outreach sequence | 5 |
| Scheduled monitoring | 0 |
| Confirmed job-change maintenance | 0 |
| Raw import, storage, deduplication, cached rescore | 0 |

## Cost model

Provider costs must be recorded from actual runs, not inferred from customer credits.

Current verified Apify planning rates:

| Work | Billing basis | Planning rate |
|---|---|---:|
| Contact/profile enrichment and job-change monitoring | Successful profile result | $4 per 1,000 |
| Company firmographic enrichment | Successful company result | $4 per 1,000 on Free; $3 per 1,000 on Gold |
| Company hiring monitoring | Returned job result | $1 per 1,000 returned jobs |

Other variable costs include email verification, contact/company lookup, phone reveal, and LLM usage.
Their actual charges belong in provider telemetry and the internal operations view.

Monitoring is the largest recurring cost sensitivity because it repeats across the full active universe.
The Growth cap is 10,000 active leads.

Hiring-monitor planning should use:

- base case: five returned jobs per monitored company per sweep;
- stress case: ten returned jobs;
- production replacement: trailing 30-day jobs returned per attempted company.

## Margin policy

- Target **80–90%+ gross margin on paid actions**.
- Require at least **60% total plan gross margin at maximum intended launch usage**.
- Move toward **70%+ total plan margin** as actual usage and provider mix stabilize.
- Review Growth separately because weekly monitoring makes it more sensitive to full-cap usage.
- Do not model subscription value using assumed credit-pack purchases unless that scenario explicitly
  includes them.

The internal operations view should report:

- subscription revenue by workspace;
- purchased-credit revenue separately;
- provider cost by actor/action;
- monitoring cost by contacts and accounts;
- settled customer credits;
- cost per active lead;
- total gross margin at actual usage and at intended cap.

## Structural cost controls

### Cache first

Use canonical people and companies before running paid provider work. Duplicates and fresh cache hits should
not consume customer credits or repeat COGS.

### Triage before enrichment

Raw import, storage, and deduplication are free. Imported records are triaged first. Arcova must not
automatically enrich every medium/high-fit record.

### Fit-gate recurring work

Monitoring and refresh queues should prioritize eligible high-fit contacts and accounts. Low-value records
must not consume recurring provider budget merely because they exist in the workspace.

### Separate contacts from accounts internally

Customers see one active-lead allowance. Internally Arcova meters contacts and accounts separately to
understand provider cost, coverage, and abuse. The internal account ceiling is not customer-facing.

## Open validation work

1. Complete seven days of shadow credit/provider reconciliation.
2. Measure weekly Growth monitoring at realistic active-contact and active-account volumes.
3. Replace all planning rates with trailing production averages where possible.
4. Validate margins at normal usage and maximum intended usage before enforcement.
5. Confirm real provider subscription costs in the internal admin model.

## Code references

- `lib/billing/config.ts` — plans, action costs, caps, Stripe environment keys.
- `lib/billing/credits.ts` — credit grants, reservations, settlement, refunds, and enforcement.
- `lib/billing/monitoring.ts` — workspace monitoring allocation.
- `lib/apify.ts` — centralized Apify execution and cost telemetry.
- `lib/provider-usage.ts` — internal provider usage/cost records.
- `app/api/admin/billing-operations/route.ts` — internal credit, cost, and monitoring report.
- `ARCOVA_PRICING_AND_CREDIT_SPEC.md` — full commercial behavior.
