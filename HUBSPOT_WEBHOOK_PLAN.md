# HubSpot real-time webhook activation

> **Purpose:** activation instructions for `LAUNCH_PLAN.md` Phase B.
> **Status:** the Arcova receiver and database support are already built.
> **Owner:** Emma registers it in HubSpot/Vercel; Codex verifies a real event.
> **Finished when:** a real HubSpot change reaches Arcova, emits the expected
> signal, recomputes readiness, and duplicate delivery is harmless.

## What Emma needs to do

### 1. Confirm the signing secret in Vercel

Vercel → `biosignals-app` → production environment variables:

```text
HUBSPOT_CLIENT_SECRET
```

This must be the client secret for the HubSpot developer app delivering the
webhooks. Redeploy if you add or change it.

### 2. Register the webhook receiver

HubSpot developer app → **Webhooks**:

```text
https://YOUR-PRODUCTION-DOMAIN/api/hubspot/webhook
```

Replace `YOUR-PRODUCTION-DOMAIN` with the actual production app hostname.

Add these subscriptions:

| Subscription | Relevant properties/action |
|---|---|
| `contact.creation` | Pull the newly created contact. |
| `contact.propertyChange` | Subscribe for `jobtitle`, `company`, and `lifecyclestage`. |
| `deal.creation` | Pull and evaluate the new deal. |
| `deal.propertyChange` | Subscribe for `dealstage`. |

Keep the existing daily HubSpot cron enabled. It is the recovery/safety net.

### 3. Refresh the existing connection

In Arcova Settings, reconnect HubSpot once. This stores the HubSpot portal ID
needed to map incoming events to the correct workspace. New connections capture
it automatically.

## Then hand back to Codex

Send:

> HubSpot webhook is registered and reconnected—verify a real event.

Codex will verify:

- HubSpot receives a `2xx` response;
- the portal resolves to the correct Arcova workspace;
- the event is recorded and deduplicated;
- a contact/deal signal lands in `signal_source_events`;
- readiness recomputes;
- repeated delivery does not duplicate the effect.

## What is already built

- `app/api/hubspot/webhook/route.ts`
- HubSpot v3 signature and timestamp verification
- event idempotency storage
- portal-ID capture during connection
- contact and deal readiness dispatch
- daily pull/push cron as a safety net
- sync-status UI in Settings

## Checklist

- [ ] `HUBSPOT_CLIENT_SECRET` confirmed in Vercel production.
- [ ] Production webhook URL registered in HubSpot.
- [ ] Contact subscriptions added.
- [ ] Deal subscriptions added.
- [ ] HubSpot reconnected once in Arcova.
- [ ] Codex real-event verification passed.
