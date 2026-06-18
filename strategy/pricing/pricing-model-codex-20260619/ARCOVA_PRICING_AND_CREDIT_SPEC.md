# Arcova Pricing and Credit Specification

**Status:** Working pricing decision
**Last updated:** 19 June 2026
**Scope:** Free, Starter and Growth only

## Executive decision

Arcova uses one shared workspace credit balance.

- Provider COGS is recorded in fractional dollars and is separate from customer credits.
- **$0.01 remains an internal cost-credit reference only.** Customer action prices are set independently from that reference.
- Credits are consumed by deliberate, cost-incurring actions such as enrichment, email finding, phone reveal, net-new data acquisition and sequence generation.
- Routine monitoring is included as a plan entitlement and does not invisibly deduct credits.
- Action-specific counters sit alongside the shared credit balance. These are limits, not separate credit currencies.
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
| Active lead cap | 100 | 5,000 | 10,000 |
| Internal monitored-account ceiling (not customer-facing) | 100 | 1,250 | 2,500 |
| Monitoring cadence | Monthly | Monthly | Weekly |
| New imported records triaged/month | 500 | 10,000 | 50,000 |
| Imported enrichments from included allowance/month | 25 | 300 | 1,400 |
| Imported enrichment hard cap/month | 25 | 500 | 5,000 |
| Net-new delivered-lead cap/month | 10 | 2,500 | 10,000 |
| Sequence generation cap | 1/rolling 24h | 3/rolling 24h | 10/rolling 24h |
| Export | Full unlocked data | Full unlocked data | Full unlocked data |

The net-new lead caps are initial operational/provider-throughput guardrails. They should be reviewed using real usage data.
Annual pricing is ten months of subscription price (two months free), billed upfront, with the full annual credit grant available immediately. Monthly credits expire at rollover; annual credits expire at annual renewal; purchased credits expire after 12 months.

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
- Triage above the allowance costs **0.1 credit per record**.

When an ICP is added or changed:

- non-enriched data receives a free re-triage against the updated ICP;
- enriched data receives a free rescore using stored structured attributes;
- Arcova does not blanket re-enrich the database through Apollo, Apify or ZeroBounce; and
- repeated ICP edits should be debounced into one recalculation operation.

### 4. Enrich imported leads

An imported lead enrichment costs **4 credits** and represents the contact-plus-company enrichment bundle.

#### Free

- Up to 25 imported enrichments/month.
- The hard monthly cap is also 25.
- Active-lead cap: 100.

#### Starter

- Up to 300 imported enrichments/month may be funded from the included monthly credit allowance.
- At 4 credits each, this uses 1,200 of the 2,000 included credits.
- This preserves at least 800 included credits for other Arcova actions.
- Purchased credits can fund additional imported enrichment.
- The absolute hard cap is 500 imported enrichments/month.
- Active-lead cap: 5,000.

#### Growth

- Up to 1,400 imported enrichments/month may be funded from the included credit allowance.
- At 4 credits each, this uses 5,600 of the 8,000 included credits.
- This preserves at least 2,400 included credits for other actions.
- Purchased credits can fund additional imported enrichment.
- The absolute hard cap is 5,000 imported enrichments/month.
- Active-lead cap: 10,000.

Purchased credits add spending power but do not override the plan's hard enrichment cap.

### 5. Work with enriched leads

| Action | Arcova credits | Limit behavior |
|---|---:|---|
| Imported lead enrichment | 4 | Included allocation plus tier hard cap |
| Company-only enrichment | 3 | Shared balance |
| Email validation | 0.5 | Shared balance |
| Find a new email | 11 | Shared balance plus daily provider guardrail |
| Phone reveal | 20 | Shared balance plus daily provider guardrail |
| Net-new enriched lead | 4 | Shared balance plus monthly delivered-lead cap |
| Manual lead refresh | 4 | Shared balance |
| Seven-touch outreach sequence | 5 | Shared balance plus rolling 24-hour cap |
| Scheduled monitoring | 0 | Included within active-lead cap |
| Confirmed job-change refresh | 0 | Included maintenance of an active lead |

Before a paid action, Arcova should show the estimated credit cost.

Credits should be reserved before the provider call and settled only on a billable result. Failed calls, duplicates and fresh cache hits should be refunded or never finalized.

### 6. Phone reveal

- Phone reveal is always a deliberate user click.
- It must never run automatically during enrichment.
- The UI shows that the request costs **20 credits**.
- Apollo currently charges eight provider credits per reveal.
- At Apollo rates of $0.016–$0.025 per credit, Arcova's provider replacement cost is approximately $0.128–$0.20.
- Twenty Arcova credits represent the conservative $0.20 replacement cost.
- Initial safety caps:
  - Free: 2 requests/day.
  - Starter: 50 requests/day.
  - Growth: 200 requests/day.

### 7. Buy net-new data

- Searching and previewing potential records is free.
- Arcova checks owned and canonical cached data before spending provider credits.
- The UI shows how many genuinely new leads will be delivered and the maximum credit reservation.
- Each successfully delivered enriched lead costs **4 credits**.
- Failed, duplicate or fresh-cache records do not consume credits.
- Initial monthly delivered-lead caps:
  - Free: 10.
  - Starter: 2,500.
  - Growth: 10,000.

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

### 9. Outreach sequence generation

Arcova generates a complete seven-touch sequence and stages/sends it to Lemlist.

- Arcova does not generate or send one-off emails.
- Lemlist controls sending inboxes, daily send limits, campaign timing, deliverability and reply stops.
- One generated sequence costs **5 credits**.
- Free: maximum 1 sequence per rolling 24 hours.
- Starter: maximum 3 sequences per rolling 24 hours.
- Growth: maximum 10 sequences per rolling 24 hours.
- There is no separate monthly sequence cap. The shared credit balance constrains total use.
- Buying additional credits does not bypass the rolling 24-hour generation cap.
- Editing generated copy manually is free.
- A failed Arcova generation should be retried for free.

Steady-state sending context:

- 3 new seven-touch sequences/day eventually imply roughly 21 scheduled emails/day before reply stops.
- 10 new sequences/day imply roughly 70 scheduled emails/day.
- Actual delivery remains governed by the user's Lemlist configuration.

### 10. Exports

- Customers may export all data they have legitimately imported, enriched or purchased.
- Exporting does not consume credits.
- There is no commercial CSV export cap.
- Technical rate limits may protect infrastructure but should not be presented as a plan entitlement.
- Arcova's retention should come from freshness, monitoring, signals and workflow—not data imprisonment.

## Credit accounting

### One balance, multiple entitlement counters

The user sees one shared Arcova credit balance.

The app also shows action-specific counters such as:

- imported enrichment: `184 / 300 included this month`;
- imported enrichment hard cap: `184 / 500`;
- triage: `6,200 / 10,000 records this month`;
- active leads: `3,810 / 5,000`;
- sequence generation: `2 / 3 in the current rolling 24-hour window`.

These counters do not create separate currencies. They prevent one action from consuming the entire plan or causing uncontrolled provider exposure.

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
- Monthly and daily action-throughput limits still apply.
- Active-lead caps and monitoring cadence remain unchanged.
- Purchased credits expire 12 months after their individual purchase date.

### Spending order and UI

Arcova should consume the credit bucket that expires soonest.

The UI must distinguish balances, for example:

- `1,420 included monthly credits — expire 18 July 2026`
- `3,000 purchased credits — expire 4 February 2027`

Annual customers should see:

- `18,400 annual included credits — expire 18 June 2027`
- any purchased-credit buckets separately.

## Why the guardrails exist

- **Triage allowance:** allows full-database ranking without making a 30,000-record import equivalent to a 100-record import.
- **Imported-enrichment allocation:** preserves included credits for the rest of the product.
- **Imported-enrichment hard cap:** protects provider throughput and creates a clear Starter-to-Growth boundary.
- **Active-lead cap:** bounds recurring monitoring COGS accumulated over many months.
- **Sequence rolling cap:** prevents burst LLM usage and keeps generated campaign volume aligned with plausible Lemlist capacity.
- **Phone and finder daily caps:** protect expensive provider endpoints.
- **Annual throughput limits:** prevent an annual customer from spending the entire annual grant in one provider spike.

## Required implementation changes

1. Separate raw import from paid enrichment. The current import route enriches every non-duplicate row.
2. Add the pre-enrichment triage stage.
3. Implement the included imported-enrichment allocation and monthly hard cap.
4. Stop automatic Apollo phone reveal in the enrichment pipeline.
5. Add a unified credit ledger with pending, settled and refunded states.
6. Add separately expiring monthly, annual and purchased credit buckets.
7. Add workspace-level action counters for triage, imported enrichment, active leads, net-new leads, sequences, phone reveals and email finding.
8. Add the active-lead universe cap to scheduled monitoring.
9. Preserve free cached ICP re-evaluation behavior.
10. Expose credit costs and cap status before every deliberate paid action.
