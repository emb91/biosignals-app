# Arcova Package Comparison

**Status:** Current package comparison  
**Last updated:** 25 June 2026
**Commercial source of truth:** `ARCOVA_PRICING_AND_CREDIT_SPEC.md`

## Monthly package comparison

| Package | Free | Starter | Growth | Custom |
|---|---:|---:|---:|---:|
| Price | $0 | $149/month | $799/month | Custom |
| Workspace users | 1 | Unlimited | Unlimited | Custom |
| Included credits | 100/month | 2,000/month | 8,000/month | Custom |
| Purchased credit packs | Not available | $100 per 1,000 | $70 per 1,000 | Custom |
| Active ICPs | 1 | 3 | 10 | Custom |
| Active lead capacity | 100 | 5,000 | 10,000 | Custom |
| Monitoring cadence | Monthly | Monthly | Weekly | Custom |
| Signals tracked | 42 | 42 | 42 | 42 |
| Custom signals | No | No | No | Yes |
| Imported records triaged/month | 500 included | 10,000 included guide | 50,000 included guide | Custom |
| Imported enrichments included | 10/month | 250/month | 1,200/month | Custom |
| Net-new enriched leads | 5/month | 50/month | 200/month | Custom |
| Sequence generation | 1/month | 66/month | 214/month | Custom |
| Phone reveals | 1/month | 3/month | 12/month | Custom |
| Email finder | 1/month | 25/month | 60/month | Custom |
| Exports | Unlimited | Unlimited | Unlimited | Unlimited |

## Annual package comparison

| Package | Free | Starter | Growth | Custom |
|---|---:|---:|---:|---:|
| Price | - | $1,490/year | $7,990/year | Custom |
| Effective discount | - | 2 months free | 2 months free | Custom |
| Workspace users | - | Unlimited | Unlimited | Custom |
| Included credits | - | 24,000 upfront | 96,000 upfront | Custom |
| Credit spend pace | - | Spend upfront with usage warnings | Spend upfront with usage warnings | Custom |
| Purchased credit packs | Not available | $100 per 1,000 | $70 per 1,000 | Custom |
| Active ICPs | - | 3 | 10 | Custom |
| Active lead capacity | - | 5,000 | 10,000 | Custom |
| Monitoring cadence | - | Monthly | Weekly | Custom |
| Signals tracked | - | 42 | 42 | 42 |
| Custom signals | - | No | No | Yes |
| Imported records triaged/month | - | 10,000 | 50,000 | Custom |
| Imported enrichments included | - | 3,000 upfront | 14,400 upfront | Custom |
| Net-new enriched leads | - | 600 upfront | 2,400 upfront | Custom |
| Sequence generation | - | 792 upfront | 2,568 upfront | Custom |
| Phone reveals | - | 36 upfront | 144 upfront | Custom |
| Email finder | - | 300 upfront | 720 upfront | Custom |
| Exports | - | Unlimited | Unlimited | Unlimited |

## Credit behavior

| Credit type | Behavior |
|---|---|
| Monthly included credits | Reset monthly. Unused credits expire at rollover. |
| Annual included credits | Granted upfront. Customers can spend them at their chosen pace during the annual term. Unused credits expire at renewal. |
| Purchased credits | Roll over for 12 months and can be used for any paid action. |
| Arcova complimentary/demo credits | Show a realistic credit track for product experience, but do not trigger Stripe charges. |

Annual customers should not be blocked simply because they spend faster than a normal month. Instead, show pace warnings before and after large burns.

Example:

> You've used 7,200 of 24,000 annual credits. That's about 3.6 months of Starter usage. Your credits are available until renewal, but active ICP capacity and active lead capacity still apply.

## Action costs

| Action | Credits | Notes |
|---|---:|---|
| Imported contact and company enrichment | 4 | Includes ZeroBounce validation when an email is returned. |
| Company-only import/enrichment | 3 | Charged per complete, non-duplicate company; no Haiku triage. Setup-time company mapping is free. |
| Find and validate a new email | 11 | Charged only when a usable email is found. |
| Phone reveal | 20 | User-confirmed only; never automatic during enrichment. |
| Net-new enriched lead | 4 | Charged only for delivered, non-duplicate leads. |
| Manual contact refresh | 4 | Scheduled monitoring maintenance remains included. |
| Seven-touch outreach sequence | 7 | Extra sequences use credits. Each generated sequence has 7 steps before edits: 4 email, 1 LinkedIn add, and 2 LinkedIn messages. |
| Scheduled monitoring | 0 | Included within active-lead capacity. |
| Confirmed job-change maintenance | 0 | Included maintenance of an active lead. |

Company-only import billing skips duplicate companies and incomplete rows. The billable result is a complete new company accepted for company enrichment.

## What caps mean

Credits decide whether the workspace can pay for a completed action. Caps protect the product experience and provider exposure.

- Active lead capacity is the hard plan boundary. Buying more credits lets customers enrich or buy more data until the workspace reaches the plan's active-lead capacity.
- Active ICP capacity is the workspace's saved ICP limit. Editing an existing ICP is free; creating another active ICP requires an available slot or a higher plan.
- Monitoring cadence is plan-based. Buying more credits does not turn Starter's monthly monitoring into Growth's weekly monitoring.
- Included action allowances are billing-period allowances. Monthly plans receive the monthly allowance upfront; annual plans receive the annualized allowance upfront.
- The decided Starter imported-enrichment allowance is 250 monthly contact-plus-company enrichments.
- Starter's 66 generated sequences/month equal 462 total steps: 264 email, 66 LinkedIn adds, and 132 LinkedIn message steps before edits.
- Growth's 214 generated sequences/month equal 1,498 total steps: 856 email, 214 LinkedIn adds, and 428 LinkedIn message steps before edits.
- Monthly billing uses normal package pace guidance because credits reset monthly, but customers can buy more credits until they hit active-lead capacity.
- Annual billing grants all included credits upfront and uses pace warnings instead of artificial monthly commercial spend caps.
- Purchased credits add spending power, but do not increase active ICP capacity, active lead capacity or monitoring cadence.

## Recommended usage-page display

Show both the credit balance and the relevant counters:

- `1,420 included monthly credits - expire 18 July 2026`
- `18,400 annual included credits - expire 18 June 2027`
- `3,000 purchased credits - expire 4 February 2027`
- `184 / 250 included imported enrichments`
- `2 / 3 active ICPs`
- `32 / 50 included net-new enriched leads`
- `Extra imported enrichments use purchased credits until active-lead capacity is reached`
- `18 / 66 sequences generated this month`
- `72 email steps, 18 LinkedIn adds, 36 LinkedIn message steps generated this month`
- `2 / 3 phone reveals this month`
- `7 / 25 email-finder requests this month`
- `3,810 / 5,000 active leads monitored`

## Internal modeling notes

- One Arcova credit is an internal cost-credit reference, not a fixed customer cash price.
- Monitoring is included for customers, but model COGS as line items: hiring scrape, job-change profile scrape, external-contact refresh/provider calls, and fixed monthly LLM overhead where classification or synthesis uses LLMs.
- Keep docs and calculators synchronized to the current policy: 250 monthly Starter contact-plus-company enrichments, company-only import at 3 credits/company, and seven-touch sequences at 7 credits.

## Positioning notes

- Free is a real trial of the workflow, not a toy sandbox.
- Starter is designed for a small team building repeatable outbound with monthly monitoring.
- Growth is designed for a broader active market with weekly monitoring and lower purchased-credit pricing.
- Custom is for teams that need higher active lead capacity, negotiated data volumes, security, onboarding, or bespoke provider throughput.
