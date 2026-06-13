# HubSpot real-time webhook — implementation plan

The HubSpot sync foundation is **already ~80% built**: org-scoped Nango OAuth, 40
custom `arcova_*` properties, daily push+pull cron (`app/api/cron/hubspot-daily`),
readiness signal emission from contacts/deals (`lib/signals/readiness-hubspot-*`),
and full logging (`hubspot_sync_events`). The one missing piece for the BACKLOG's
**"webhooks as primary, nightly pull as safety net"** model is the real-time
**inbound webhook receiver**. This is the plan for it. It's deliberately *not*
built yet because it has an architecture fork + a connect-flow change that
shouldn't be decided unilaterally — this doc settles those.

## Decisions

**1. Direct HubSpot webhook (recommended) vs Nango-forwarded.**
We own the HubSpot app (own `HUBSPOT_CLIENT_ID/SECRET`, used as a custom Nango
integration), so HubSpot can POST directly to us and we verify with the app
client secret — no dependency on Nango's webhook plumbing. **Recommend direct.**
(Nango forwarding is the alternative if we ever move to Nango-managed apps; it'd
change only the receiver's auth check.)

**2. Org resolution — the hard part.** A webhook payload has `portalId` + object
id, no session. Resolve org by **HubSpot portal id**:
- Add `hubspot_portal_id bigint` to `nango_connections` (or a `hubspot_connections`
  view). Populate it **on connect**: after the Nango connection is saved
  (`app/api/nango/connection/route.ts`), call HubSpot `GET /account-info/v3/details`
  with the token and store `portalId`.
- Webhook → look up the connection by `portalId` → that's the org. One indexed lookup.
- (Backfill existing connections once with the same account-info call.)

**3. Idempotency + signature — mirror the Stripe webhook** (`app/api/stripe/webhook`):
- `hubspot_webhook_events(id text pk, type text, received_at timestamptz)` — insert
  first; 23505 = duplicate → ack and drop. (HubSpot batches events; dedupe per
  `eventId`.)
- **Signature (v3):** `base64( HMAC-SHA256( clientSecret, method + uri + body + timestamp ) )`
  in `X-HubSpot-Signature-v3`, with `X-HubSpot-Request-Timestamp`. Reject if the
  timestamp is older than 5 min (replay guard) or the HMAC mismatches → 401.
- Raw body needed for the HMAC (same `await request.text()` pattern as Stripe).

## What to build

1. **Migration** — `hubspot_webhook_events` table + `nango_connections.hubspot_portal_id` column (indexed).
2. **`app/api/hubspot/webhook/route.ts`** (runtime nodejs, raw body):
   - Verify v3 signature → 401 on fail.
   - For each event in the batch: dedupe on `eventId`; resolve org via `portalId`;
     dispatch by subscription type.
3. **Connect-flow addition** — store `hubspot_portal_id` on connect + a one-off backfill.
4. **Env** — none new (signature uses the existing `HUBSPOT_CLIENT_SECRET`).

## Event subscriptions (register in the HubSpot app → Webhooks)
| Subscription | Handler action |
|---|---|
| `contact.creation` | enqueue pull/enrich for the new contact (reuse `pullNewFromHubSpot` path, single-contact) |
| `contact.propertyChange` (jobtitle, company, lifecyclestage) | emit readiness signals immediately via `lib/signals/readiness-hubspot-contacts` (title_change / recently_changed_company / new_internal_role / lifecycle) → recompute readiness |
| `deal.creation` / `deal.propertyChange` (dealstage) | emit `open_opportunity_in_crm` / `closed_lost_in_crm` via `lib/signals/readiness-hubspot-deals` → recompute readiness |

Each handler reuses the **existing** signal-emission libs — the webhook just makes
them fire in real time instead of waiting for the daily cron. **Keep the cron** as
the safety net (catches anything missed during downtime/rate-limits).

## What Emma does (dashboard, after the code ships)
- HubSpot developer app → **Webhooks**: set target URL `https://<app>/api/hubspot/webhook`,
  add the subscriptions above, set the throttling/concurrency HubSpot recommends.
- Confirm the app has the contact/deal read scopes (it already does for the cron).

## Verification
- Local: `hubspot` CLI / a manual signed POST replaying a sample `contact.propertyChange`
  batch → assert org resolves, signal row lands in `signal_source_events`, readiness recomputes, dedupe holds.
- Mirror the Stripe webhook's test approach (sign locally with the secret, POST to the route).

## Scope / risk
Net-new files + a small additive connect-flow change + one migration; it reuses the
mature signal libs and doesn't modify push/pull/cron. Main untestable-by-Claude bit
is the HubSpot-side registration (Emma's dashboard) and real event delivery — same
shape as the Stripe webhook, which we test-clock-verified. Estimate: ~1 focused day.
