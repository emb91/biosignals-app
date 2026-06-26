# Arcova Pricing and Credit Specification

**Status:** Working pricing decision
**Last updated:** 25 June 2026
**Scope:** Free, Starter and Growth only

## Executive decision

Arcova uses action-specific included allowances backed by Arcova credits.

- Provider COGS is recorded in fractional dollars and is separate from customer credits.
- **One Arcova credit / $0.01 remains an internal cost-credit reference only.** It is not a customer price, cash-equivalent balance, or promise that the customer is buying provider cost at cost. Customer action prices are set independently from that reference.
- Credits are consumed by deliberate, cost-incurring actions such as enrichment, email finding, phone reveal, net-new data acquisition and sequence generation.
- Routine monitoring is included as a plan entitlement and does not invisibly deduct credits.
- Included plan allowances are shown as actions, with credit values underneath. Customers think in actions; the system accounts in credits.
- Monthly customers receive their monthly included allowances upfront for the billing period. Annual customers receive the annualized included allowances upfront for the annual term.
- Purchased credits are flexible rollover credits. They are spent only after the relevant included action allowance is exhausted.
- Workspace limits are shared by the whole team. Adding users does not multiply credits or caps.

## Plans

| Entitlement | Free | Starter | Growth |
|---|---:|---:|---:|
| Monthly price | $0 | $149/workspace | $799/workspace |
| Annual price | — | $1,490/workspace | $7,990/workspace |
| Workspace users | 1 | Unlimited | Unlimited |
| Included monthly credits | 100 | 2,000 | 8,000 |
| Annual credits provided upfront | — | 24,000 | 96,000 |
| Purchased credits | Initially unavailable | $100 per 1,000 | $70 per 1,000 |
| Active ICP cap | 1 | 3 | 10 |
| Active lead cap | 100 | 5,000 | 10,000 |
| Internal monitored-account ceiling (not customer-facing) | 100 | 1,250 | 2,500 |
| Monitoring cadence | Monthly | Monthly | Weekly |
| New imported records triaged/month | 500 | 10,000 | 50,000 |
| Lead-enrichment credits included/month | 60 | 1,200 | 5,600 |
| Sequence generation package/month | 1 | 66 | 214 |
| Email finder package/month | 1 | 25 | 60 |
| Phone reveal package/month | 1 | 3 | 12 |
| Export | Full unlocked data | Full unlocked data | Full unlocked data |

Net-new lead and extra enrichment spend are constrained commercially by credit balance and active-lead capacity. Internal provider rate limits may still protect the system, but they are not sold as monthly commercial caps.
Annual pricing is ten months of subscription price (two months free), billed upfront, with the full annual credit grant available immediately. Monthly credits expire at rollover; annual credits expire at annual renewal; purchased credits expire after 12 months. Annual customers may spend their annual included credits at their chosen pace; Arcova warns when usage is ahead of the normal monthly rhythm rather than blocking purely because of pace.

## What an active ICP means

An active ICP is a saved ideal-customer profile available for scoring, coverage planning and lead ranking. The cap applies to saved active ICP profiles, not edits or refinements to an existing ICP.

- Free includes 1 active ICP.
- Starter includes 3 active ICPs.
- Growth includes 10 active ICPs.
- Deleting an ICP frees its slot.
- Purchased credits do not increase the active ICP cap.
- Larger companies with many materially different markets, products or buying motions should be on Growth or Custom.

## What an active lead means

An active lead is:

- enriched;
- high-fit under the current ICP model;
- not archived or paused; and
- included in Arcova's automatic monitoring universe.

Arcova does not ask users to manually choose which high-fit leads are monitored.

- All active leads on Starter are monitored monthly.
- All active leads on Growth are monitored weekly.
- Monitoring does not deduct visible Arcova credits.
- When the active-lead cap is reached, users can still import and store records. Additional leads cannot become active and monitored until capacity is freed or the workspace upgrades.

The Growth active-lead cap is 10,000. Weekly contact sweeps, company hiring monitoring, refreshes, and platform costs are reflected in that allowance. Growth is priced at **$799/month** or **$7,990/year**.

## Customer journey and limits

### 1. Sign-up and setup

- The user creates a workspace.
- Starter and Growth workspaces can invite the whole team.
- Arcova enriches the user's profile, company and ICP examples for free.
- Buying-team and persona setup is free.
- New ICP creation is limited by the workspace's active ICP cap; editing an existing ICP is free and does not consume another slot.
- The in-app agent is included subject to fair-use protection.
- Setup does not consume Arcova credits.

### 2. Import CRM or CSV data

- Customers can import their entire database.
- Raw import, storage, deduplication and cache matching are free.
- Importing data does not automatically enrich every record.
- Arcova should show imported data as an unprocessed/ranked universe before paid enrichment.
- Customers own their imported data.

### 3. Triage

Every newly imported contact and account is triaged before Arcova spends money enriching it.

- All imports in the same billing month count cumulatively toward the plan's triage allowance.
- Repeated imports do not reset the allowance.
- Free includes 500 newly imported records/month.
- Starter includes 10,000/month.
- Growth includes 50,000/month.
- Triage above the allowance can be priced later if needed; it is not a launch customer-facing overage.

When an ICP is added or changed:

- non-enriched data receives a free re-triage against the updated ICP;
- enriched data receives a free rescore using stored structured attributes;
- Arcova does not blanket re-enrich the database through Apollo, Apify or ZeroBounce; and
- repeated ICP edits should be debounced into one recalculation operation.

### 4. Use lead-enrichment credits

An imported lead enrichment costs **4 credits** and represents the contact-plus-company enrichment bundle. When the enrichment returns an email address, ZeroBounce validation is included in this bundle. Finding a missing or replacement email later remains the separate email-finder action.

The COGS model must include that validation. Imported enrichment is not just Apollo plus Apify; it is Apollo plus Apify plus expected ZeroBounce validation when an email is returned. Customers still see one imported-enrichment action, not a separate validation charge.

Imported contact-plus-company enrichment, company-only import/enrichment and net-new delivered leads now share one customer-facing **lead-enrichment credit** allowance. Users can spend the pool on any mix:

- imported contact + company enrichment: **4 credits**;
- company-only import/enrichment: **3 credits**; and
- net-new delivered/enriched lead or data purchase: **4 credits**.

#### Free

- **60 lead-enrichment credits/month**, equal to the prior 10 imported contact-plus-company enrichments (40 credits) plus 5 net-new enriched leads (20 credits).
- Active-lead cap: 100.

#### Starter

- **1,200 lead-enrichment credits/month**, equal to the prior 250 imported contact-plus-company enrichments (1,000 credits) plus 50 net-new enriched leads (200 credits).
- Starter can spend those 1,200 credits on contact-plus-company imports, company-only imports, net-new leads, or combinations.
- This preserves the package room for generated sequences, email finds and phone reveals.
- Purchased credits can fund additional lead-enrichment actions until the workspace reaches active-lead capacity.
- Monthly billing shows the 1,200-credit lead-enrichment package pace, but does not impose an artificial monthly enrichment ceiling.
- Annual billing can spend annual credits upfront, with pace warnings instead of an artificial monthly commercial cap.
- Active-lead cap: 5,000.

#### Growth

- **5,600 lead-enrichment credits/month**, equal to the prior 1,200 imported contact-plus-company enrichments (4,800 credits) plus 200 net-new enriched leads (800 credits).
- Growth can spend those 5,600 credits on contact-plus-company imports, company-only imports, net-new leads, or combinations.
- This preserves the package room for generated sequences, email finds and phone reveals.
- Purchased credits can fund additional lead-enrichment actions until the workspace reaches active-lead capacity.
- Monthly billing shows the 5,600-credit lead-enrichment package pace, but does not impose an artificial monthly enrichment ceiling.
- Annual billing can spend annual credits upfront, with pace warnings instead of an artificial monthly commercial cap.
- Active-lead cap: 10,000.

Purchased credits add spending power but do not increase active ICP capacity, active-lead capacity or monitoring cadence.

### 5. Work with enriched leads

| Action | Arcova credits | Limit behavior |
|---|---:|---|
| Imported lead enrichment | 4 | Shared lead-enrichment credit pool first; purchased credits after that; active-lead capacity still applies |
| Company-only import/enrichment | 3 | Shared lead-enrichment credit pool first; charged only for complete, non-duplicate companies; no Haiku triage step |
| Email validation | 0.5 | Included in enrichment when an email is returned; standalone validation only when explicitly exposed |
| Find a new email | 11 | Included email-finder allowance first; purchased credits after that |
| Phone reveal | 20 | Included phone-reveal allowance first; purchased credits after that |
| Net-new enriched lead | 4 | Shared lead-enrichment credit pool first; purchased credits after that; active-lead capacity still applies |
| Manual lead refresh | 4 | Shared balance |
| Seven-touch outreach sequence | 7 | Included sequence allowance first; purchased credits after that |
| Scheduled monitoring | 0 | Included within active-lead cap |
| Confirmed job-change refresh | 0 | Included maintenance of an active lead |

Before a paid action, Arcova should show the estimated credit cost.

Credits should be reserved before the provider call and settled only on a billable result. Failed calls, duplicates and fresh cache hits should be refunded or never finalized.

For company-only imports, incomplete rows and duplicate companies are not billable results. The billable action is a complete new company accepted for company enrichment at **3 credits/company**.

### 6. Phone reveal

- Phone reveal is always a deliberate user click.
- It must never run automatically during enrichment.
- The UI shows that the request costs **20 credits**.
- Apollo currently charges eight provider credits per reveal.
- At Apollo rates of $0.016–$0.025 per credit, Arcova's provider replacement cost is approximately $0.128–$0.20.
- Twenty Arcova credits represent the conservative $0.20 replacement cost.
- Included package allowances:
  - Free: 1 phone reveal/month.
  - Starter: 3 phone reveals/month.
  - Growth: 12 phone reveals/month.
- Annual customers receive the annualized allowance upfront.
- Extra phone reveals use purchased credits.

### 7. Buy net-new data

- Searching and previewing potential records is free.
- Arcova checks owned and canonical cached data before spending provider credits.
- The UI shows how many genuinely new leads will be delivered and the maximum credit reservation.
- Each successfully delivered enriched lead costs **4 credits**.
- Failed, duplicate or fresh-cache records do not consume credits.
- Net-new delivered leads spend the shared lead-enrichment credit pool.
- Additional net-new leads use purchased credits after that shared pool is exhausted, until active-lead capacity is reached.
- Annual billing can spend annual credits upfront, but active-lead capacity still applies.

Net-new data remains inside the Arcova credit system. There is no separate $1-per-lead currency.

### 8. Monitoring

- All high-fit active leads are monitored automatically.
- Starter monitors all active leads monthly.
- Growth monitors all active leads weekly.
- Users do not allocate weekly versus monthly monitoring lead by lead.
- Scheduled monitoring is included and does not consume visible credits.
- Job-change knock-on enrichment is included maintenance.
- The active-lead cap controls Arcova's recurring monitoring exposure.

This deliberately gives Starter a lower freshness tier rather than allowing background monitoring to consume credits invisibly. Customers should never discover that scheduled work exhausted the balance needed for deliberate actions.

Internal COGS should still model included monitoring as explicit lines:

- hiring scrape for monitored companies;
- job-change profile scrape for monitored contacts;
- external-contact refresh/provider calls triggered by monitoring;
- fixed monthly LLM overhead where monitoring classification or synthesis uses LLMs.

### 9. Outreach sequence generation

Arcova generates a complete seven-touch sequence and stages it for Lemlist.

- Arcova does not generate or send one-off emails.
- Lemlist controls sending inboxes, daily send limits, campaign timing, deliverability and reply stops.
- One generated sequence costs **7 credits**.
- Each generated sequence contains seven steps before editing: four email steps, one LinkedIn connection request, and two LinkedIn message steps.
- Free includes a 1-sequence monthly package allowance, equivalent to 7 total steps: 4 email, 1 LinkedIn connection request, and 2 LinkedIn message steps.
- Starter includes a 66-sequence monthly package allowance, equivalent to 462 total steps: 264 email, 66 LinkedIn connection requests, and 132 LinkedIn message steps.
- Growth includes a 214-sequence monthly package allowance, equivalent to 1,498 total steps: 856 email, 214 LinkedIn connection requests, and 428 LinkedIn message steps.
- Customers can generate additional sequences by spending credits. Arcova does not own or enforce the customer's final Lemlist cadence.
- Editing generated copy manually is free.
- A failed Arcova generation should be retried for free.

Outreach volume context:

- 66 generated sequences/month produce 462 total steps: 264 email, 66 LinkedIn connection requests, and 132 LinkedIn message steps before editing.
- 214 generated sequences/month produce 1,498 total steps: 856 email, 214 LinkedIn connection requests, and 428 LinkedIn message steps before editing.
- Actual delivery remains governed by the user's Lemlist configuration.

### 10. Exports

- Customers may export all data they have legitimately imported, enriched or purchased.
- Exporting does not consume credits.
- There is no commercial CSV export cap.
- Technical rate limits may protect infrastructure but should not be presented as a plan entitlement.
- Arcova's retention should come from freshness, monitoring, signals and workflow—not data imprisonment.

## Credit accounting

### Included action allowances plus purchased credits

The user sees action allowances first and credit balances second.

Each included action allowance has a credit value underneath. Monthly credits are the shared
spending pool; action allowances are guardrails on the shape of that spend, not a promise that
every action category can be maxed simultaneously.

- Free: 100 included monthly credits, with guardrails of 60 shared lead-enrichment credits, 2 sequences, 1 email find, and 1 phone reveal.
- Starter: 2,000 included monthly credits, with guardrails of 1,200 shared lead-enrichment credits, 66 sequences, 25 email finds, and 3 phone reveals.
- Growth: 8,000 included monthly credits, with guardrails of 5,600 shared lead-enrichment credits, 214 sequences, 60 email finds, and 12 phone reveals.

The app shows action-specific counters such as:

- lead-enrichment credits: `736 / 1,200 included this month`;
- active ICPs: `2 / 3`;
- active lead capacity: `3,810 / 5,000`;
- triage: `6,200 / 10,000 records this month`;
- active leads: `3,810 / 5,000`;
- sequence generation: `18 / 66 generated this month`.

These counters are customer-facing action allowances. Once the relevant included allowance is exhausted, extra actions use purchased credits. Purchased credits are flexible and can be applied to any paid action, but they do not increase active ICP capacity, active-lead capacity or monitoring cadence.

### Monthly subscriptions

- Included credits reset each billing period.
- Unused included monthly credits do not roll over.
- Purchased credits expire 12 months after purchase.

### Annual subscriptions

- The customer receives all 12 months of included credits upfront:
  - Free equivalent: 1,200.
  - Starter: 24,000.
  - Growth: 96,000.
- Annual included credits remain usable throughout the annual term.
- Unused annual included credits expire at renewal or the end of the annual term.
- Arcova does not apply artificial monthly commercial spend caps to annual included credits.
- The UI warns when annual usage is ahead of the normal monthly pace, for example: `You've used 7,200 of 24,000 annual credits. That's about 3.6 months of Starter usage. Your credits are available until renewal, but active ICP capacity and active lead capacity still apply.`
- Active ICP capacity, active-lead capacity and monitoring cadence remain unchanged.
- Purchased credits expire 12 months after their individual purchase date.

### Spending order and UI

Arcova should consume the relevant included action allowance first. When that allowance is exhausted, Arcova should consume purchased credits from the bucket that expires soonest.

The UI must distinguish balances, for example:

- `1,420 included monthly credits — expire 18 July 2026`
- `3,000 purchased credits — expire 4 February 2027`

Annual customers should see:

- `18,400 annual included credits — expire 18 June 2027`
- any purchased-credit buckets separately.

## Why the guardrails exist

- **Triage allowance:** allows full-database ranking without making a 30,000-record import equivalent to a 100-record import.
- **Included action allowances:** keep the package understandable in action terms rather than asking customers to reason from raw credits.
- **Active ICP capacity:** keeps broad multi-market GTM motions on higher tiers while letting most companies run one focused ICP.
- **Active-lead cap:** bounds recurring monitoring COGS accumulated over many months.
- **Sequence allowance:** shows included generation volume. Extra sequences use purchased credits; delivery cadence belongs to the customer's Lemlist configuration.
- **Annual pace warnings:** annual customers can spend credits upfront, but Arcova must make the burn rate obvious before large actions.

## Required implementation changes

1. Separate raw import from paid enrichment. The current import route enriches every non-duplicate row.
2. Add the pre-enrichment triage stage.
3. Implement the included shared lead-enrichment credit allocation and active-lead capacity boundary.
4. Stop automatic Apollo phone reveal in the enrichment pipeline.
5. Add a unified credit ledger with pending, settled and refunded states.
6. Add separately expiring monthly, annual and purchased credit buckets.
7. Add workspace-level counters for triage, shared lead-enrichment credits, active leads, sequences, phone reveals and email finding while retaining raw action telemetry for audit.
8. Add the active-lead universe cap to scheduled monitoring.
9. Preserve free cached ICP re-evaluation behavior.
10. Expose credit costs and cap status before every deliberate paid action.
