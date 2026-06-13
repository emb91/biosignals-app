# Billing implementation plan (Stripe, org-level)

Status: **Phases 1–5 built** (2026-06-13): schema + entitlements, checkout/portal/webhook, enforcement wired at all choke points (SHADOW MODE — set `BILLING_ENFORCEMENT=true` to enforce), and the Settings "Plan & billing" card. The meter RPC's five outcomes are DB-tested. Remaining: phase 6 hardening (Stripe test-clock run-through once keys exist), then flip enforcement on after ~a week of shadow metering.

**To activate billing** (Stripe keys were not present in this repo's .env.local):
1. Add `STRIPE_SECRET_KEY=sk_test_…` to `.env.local`.
2. Run `node scripts/stripe-bootstrap.mjs` — creates products/prices (idempotent), prints the five `STRIPE_PRICE_*` env lines to paste in.
3. `stripe listen --forward-to localhost:3000/api/stripe/webhook` → set `STRIPE_WEBHOOK_SECRET`.
Until then every org behaves as free tier and billing routes return 503.

## Price points (v1, from measured COGS)

Blended direct COGS ≈ **$0.10–0.12 per fully enriched contact** (Apify $0.006 + Apollo ~2 credits ≈ $0.06 at an assumed $0.03/credit paid plan + ZeroBounce ~$0.03 + LLM ~$0.01), plus ~$15–30/mo org-level LLM overhead. Biggest uncertainty: Apollo paid-tier credit price (currently on Free plan).

| Tier | Price | Seats | Contacts |
|---|---|---|---|
| Free | $0 | 1 | 50 lifetime |
| Team | $199/mo | 3 (+$49/seat) | 1,000/mo |
| Scale | $499/mo | 10 (+$39/seat) | 3,000/mo |
| Contact pack | $149 one-time | — | +1,000, rolls over |

All values live in `lib/billing/config.ts` (one-line changes; Stripe prices are immutable, so a price change = new price via bootstrap script + env update).

## Pricing model (the decision)

- **Billable entity**: the organization. One Stripe Customer per org (`organizations.stripe_customer_id`). Only owner/admin can manage billing.
- **Free tier**: 50 enriched contacts *lifetime*, 1 seat. This is the trial.
- **Paid plan(s)**: flat monthly base fee that includes K seats and **M new enriched contacts per month**. Allowance resets each billing period.
- **Extra seats**: per-seat add-on price, billed as a second subscription item with `quantity = max(0, members - included_seats)`. Synced when invites are accepted / members removed.
- **Overage**: **prepaid contact packs** (+1,000 contacts, one-time Checkout purchase). Packs draw down after the monthly allowance is exhausted and roll over until used. NOT Stripe metered billing in v1 (bill shock + dunning + engineering cost); the usage events needed to graduate to metered later are already recorded.
- **Data add-on**: separate Stripe product, one-time invoice / payment link per deal, manual fulfillment for MVP.
- **Feature access**: everything included on all plans. We gate on quantity (contacts, seats) only.

### The billable unit

A contact is **billable the first time it reaches enriched state within the org** (imported-then-enriched or sourced via data acquisition). Dedupe via the canonical `people` table: if another user in the same org already paid for that person, adding them again is free. Internal credit weights (`lib/data-acquisition-metering.ts`) remain the internal COGS model for setting price points — never user-facing (no "credits", no vendor names in UI copy).

Open price points (Emma to set): base fee, included seats, included monthly contacts, per-seat price, pack price. Suggested starting frame: price a contact at ≥4–5× blended enrichment COGS (derivable from `/admin/llm-usage` data-cost view).

## Phase 1 — Schema + entitlements core

New migration:

- `organizations.stripe_customer_id text unique`
- `org_subscriptions`: org_id PK/FK, stripe_subscription_id, status, plan_key, included_seats, included_monthly_contacts, current_period_start/end, cancel_at_period_end, updated_at. RLS: org members read, nobody writes (service role only).
- `org_contact_packs`: id, org_id, stripe_payment_intent_id (idempotency), contacts_purchased, contacts_remaining, purchased_at.
- `org_billable_contact_events`: id, org_id, person_id, user_contact_id, source ('import'|'acquisition'|'enrichment'), created_at, **UNIQUE(org_id, person_id)** — this constraint IS the dedupe + idempotency for the meter.
- View or function `org_contact_usage(org_id)` → contacts used this period, allowance, pack balance.

Entitlement resolution helper `lib/billing/entitlements.ts`:
- `getOrgEntitlements(orgId)` → { planKey, seatLimit, monthlyContactAllowance, contactsUsedThisPeriod, packBalance, status }
- Free tier = no `org_subscriptions` row → defaults (1 seat, 50 lifetime contacts).
- Supersedes/absorbs `org_billing_limits` for the contact dimension (keep internal credit cap as an abuse backstop).

## Phase 2 — Stripe objects + checkout + portal

- Create Products/Prices via Stripe MCP: base plan (monthly flat), seat add-on (monthly, quantity-based), contact pack (one-time), data add-on (placeholder). Record price IDs in a single `lib/billing/stripe-config.ts`.
- `POST /api/billing/checkout` — creates Checkout Session (subscription mode for plan, payment mode for packs), `client_reference_id = org_id`, owner/admin only.
- `POST /api/billing/portal` — Stripe Customer Portal session (card update, invoices, cancel).
- Lazy-create the Stripe Customer on first checkout; store id on `organizations`.

## Phase 3 — Webhook + state sync

- `POST /api/stripe/webhook` (Next route handler, **raw body** for signature verification, `STRIPE_WEBHOOK_SECRET`).
- Handle: `checkout.session.completed` (pack purchases → insert `org_contact_packs`, idempotent on payment_intent), `customer.subscription.created/updated/deleted` (upsert `org_subscriptions`), `invoice.payment_failed` / `invoice.paid` (status → past_due / active).
- Idempotency: event-id dedupe table or natural keys; webhooks are at-least-once.
- Local dev: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Phase 4 — Enforcement at the choke points

One helper, called everywhere: `consumeContactAllowance(orgId, n)` — atomically checks allowance + pack balance, records `org_billable_contact_events`, returns allowed/denied with a user-presentable reason. Order of draw-down: monthly allowance → packs → deny.

Choke points (all already identified):
1. **CSV import** — `lib/import-ingestion.ts` around the `import_upsert_contact` RPC (~line 452): preflight the batch, partial-accept with a clear "X of Y imported, upgrade for the rest" result.
2. **Data acquisition jobs** — extend the existing preflight in `/app/api/data-acquisition/jobs/[id]/run` (currently checks internal credits) to also check contact allowance.
3. **Enrichment pipeline** — `lib/enrichment-pipeline.ts` entry: only *first-time* enrichment of a person not yet in `org_billable_contact_events` consumes allowance; refreshes of already-billed contacts are free to the user.
4. **Seats** — `/api/org/invite` + invite-accept path: block when `members + pending >= seatLimit` with upgrade prompt; on accept/remove, sync Stripe subscription seat quantity.

Failure states: `past_due` → grace period (7 days, banner) → soft-lock: no new contacts/enrichment, read-only access preserved. **Never delete or hide data over billing.**

## Phase 5 — Billing UI (Settings)

New "Plan & billing" section in `app/settings/page.tsx` (same card pattern, near Team):
- Current plan, renewal date, seat usage (X of Y), contact usage bar ("412 of 1,000 contacts this month" + pack balance).
- Buttons: Upgrade / Buy contacts (Checkout), Manage billing (Portal). Owner/admin only; members see read-only usage.
- Upgrade prompts inline at the three denial surfaces (import result, sourcing job, invite form).
- Copy rules: plain customer language only — "contacts", "seats", "plan". No credits, vendors, or schema names.

## Phase 6 — Hardening + launch

- `npm run` test for entitlements + the UNIQUE-constraint dedupe path; webhook handler tests with Stripe fixture events.
- Stripe test-clock run-through: subscribe → use allowance → hit wall → buy pack → renew → payment-fail → grace → recover.
- Backfill: existing orgs grandfathered (seed `org_billable_contact_events` from current enriched contacts OR start everyone's meter at zero — recommend starting at zero, simpler and generous).
- Admin: extend `/admin/llm-usage` with per-org revenue vs. COGS so pricing can be checked against reality.

## Sequencing & estimates

Phases 1→3 are one coherent PR (schema + Stripe plumbing, no user impact). Phase 4 is the risky one (touches import + enrichment paths) — own PR, behind a `BILLING_ENFORCEMENT` env flag so metering can run in shadow mode (record events, never deny) for a week before flipping on. Phase 5 UI can land in parallel with 4. 

## Deferred (post-MVP)

- True metered/postpaid billing via Stripe Billing Meters (events already recorded).
- Annual billing + discount.
- Self-serve data add-on purchase.
- Per-feature entitlements table (if feature gating is ever wanted).
- Multi-org users (blocked on UNIQUE(org_members.user_id) removal).
