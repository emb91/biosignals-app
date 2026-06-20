# Launch plan — what's left, who does what

> **THIS IS THE MASTER LAUNCH CHECKLIST.**
>
> Work from this file—not the supporting documents. Complete the Emma-owned
> dashboard/infra steps, then tell Codex which phase is done so it can perform
> the verification or implementation step.

One checklist pulling together the work scattered across `EMAIL_SETUP.md`,
`strategy/pricing/pricing-model-codex-20260619/BILLING_PLAN.md`,
`strategy/pricing/pricing-model-codex-20260619/ARCOVA_PRICING_AND_CREDIT_SPEC.md`,
`HUBSPOT_WEBHOOK_PLAN.md`, `ROLLBACK_RUNBOOK.md`, and `BACKLOG.md`.
**🟩 = Emma (dashboard/infra/decision) · 🟦 = Codex (code/verification).** Phases are ordered by
the critical path; B and D can run in parallel with A.

---

## How to use the supporting files

| File | What you do with it |
|---|---|
| `EMAIL_SETUP.md` | Follow it while completing Phase A in Supabase and Vercel. Then ask Codex to verify email end to end. |
| `HUBSPOT_WEBHOOK_PLAN.md` | Follow its short activation checklist for Phase B. Then ask Codex to verify a real event. |
| `ROLLBACK_RUNBOOK.md` | Fill its one-time placeholders before launch. Keep it for incidents; do not run it during normal setup. |
| Pricing folder | Reference for commercial rules and billing rollout; Phase C tells you when to use it. |
| `BACKLOG.md` | Deferred work—not the launch-day checklist. |

## Emma's immediate sequence

1. Complete Phase A.
2. Complete Phase B.
3. Send: **“Phase A and B dashboard setup is done; verify both end to end.”**
4. Complete Phase D before public traffic.
5. Start Phase C only after at least seven days of billing shadow data.

---

## ✅ Already shipped (this session — code done + verified)
- Auth email: **invites + password reset** live via Resend from the verified `mail.arcova.bio` (EU). Signup **ZeroBounce** deliverability check. `/auth/confirm` token-hash + short-code sign-in. Email-change flow on /my-profile.
- Billing: workspace credit ledger, usage caps, annual grants, credit packs, Stripe lifecycle, and
  provider-cost telemetry are implemented. Growth is **$799/month**. **Shadow mode** remains on.
- HubSpot: real-time **webhook receiver** built + verified; sync-status UI in Settings. (Foundation was already ~80% built.)
- Ops: deployment rollback runbook.
- Launch hardening: paid-provider setup routes require authentication and fail-closed
  rate limiting; privileged photo backfill is admin-only; Lemlist webhook fails closed.
- Organization ownership transfer is atomic in Postgres
  (`20260620020000_atomic_org_ownership_transfer.sql`, applied to development).
- Next.js, Nango, Anthropic, Sentry, and transitive packages are patched; production
  dependency audit reports zero vulnerabilities.
- Production build, TypeScript, 88 unit tests, and four Playwright launch smokes pass.
- `/api/health`, security headers, production environment preflight, CI, and Sentry
  instrumentation are implemented.
- Every configured cron now records durable status/duration/output metadata, failed
  jobs report to Sentry, and an hourly launch-health cron checks operational invariants.
- `/admin/launch-readiness` separates operational health from paid-launch evidence.
- `npm run test:billing-ledger` verifies reservation idempotency, partial settlement,
  refunds, and credit conservation against a temporary development workspace.
- `npm run test:stripe-lifecycle` verifies the test-mode Stripe catalog, subscription
  activation, initial and renewal grants, webhook replay idempotency, credit-pack
  fulfillment, payment failure/grace, recovery, and cancellation.
- `landing-test-6` is promoted to `/`; the design route remains available and is no-index.
- Current SaaS Terms and Privacy Policy are published in code. Obtain legal review before
  relying on them as final customer contracts.

---

## Phase A — Finish auth email (≈30 min, unblocks signup + email-change)
**🟩 Emma — Supabase dashboard:**
1. Auth → URL Configuration: set **Site URL** (prod) + add `…/auth/confirm` & `…/auth/callback` to redirect allow-list (prod + localhost).
2. Auth → Email Templates: point **Confirm signup** (and Recovery / Magic Link / Change Email as fallback) at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/today` (see `EMAIL_SETUP.md`).
3. Project Settings → Auth → **SMTP**: enable custom SMTP → `smtp.resend.com`, user `resend`, password = a Resend API key, sender `noreply@mail.arcova.bio`. Then **raise the auth rate limit** off the 2/hour default.
4. Vercel: set `RESEND_AUTH_FROM=Arcova <noreply@mail.arcova.bio>` (prod).

**🟦 Codex:** once SMTP + template are in, re-test **signup confirmation** and **email-change** end-to-end through the connected inbox. Report pass/fail.

**Gate:** all four auth-email flows deliver from `mail.arcova.bio` with working links.

---

## Phase B — Turn on HubSpot real-time (≈20 min; parallel with A)
**🟩 Emma — HubSpot app + Vercel:**
1. Confirm `HUBSPOT_CLIENT_SECRET` is set in Vercel (it's the webhook signing key).
2. HubSpot developer app → **Webhooks**: target
   `https://YOUR-PRODUCTION-DOMAIN/api/hubspot/webhook`; subscribe to
   `contact.creation`, `contact.propertyChange`, `deal.creation`, and `deal.propertyChange`.
3. **Reconnect HubSpot once** in Settings so the existing connection backfills its `hubspot_portal_id` (new connections capture it automatically).

**🟦 Codex:** verify a real event flows end-to-end (signal lands in `signal_source_events`, readiness recomputes, dedup holds).

**Gate:** a contact/deal change in HubSpot triggers a readiness resync within ~2 min (cron remains the safety net).

---

## Phase C — Billing go-live (when you're ready to charge)
**🟩 Emma:**
1. Let it **shadow-meter for at least 7 days**; reconcile `org_credit_transactions`,
   `apify_run_usage`, usage counters, refunds, and monitoring coverage.
2. Use the agreed catalog: **Starter $149/month or $1,490/year; Growth $799/month or
   $7,990/year; Starter packs $100/1,000 credits; Growth packs $70/1,000 credits.**
3. Stripe **live mode**: create live keys → run `node scripts/stripe-bootstrap.mjs` → set
   `STRIPE_SECRET_KEY` and the six workspace/annual/credit-pack price IDs in Vercel.
4. Stripe dashboard → **webhook endpoint** →
   `https://YOUR-PRODUCTION-DOMAIN/api/stripe/webhook`, copy signing secret →
   `STRIPE_WEBHOOK_SECRET` in Vercel.
5. Enable selected actions with `ARCOVA_CREDIT_ENFORCEMENT_ACTIONS`, then flip
   `ARCOVA_CREDIT_ENFORCEMENT=true` only after reconciliation.

**🟦 Codex:** before enforcement — verify real provider success/failure/refund paths, monitoring
coverage at the promised cadence, and a live-mode Stripe test-clock pass. Then verify the full
subscribe → credit grant → limit → pack → renew → payment failure/grace → recovery → cancel lifecycle.

**Gate:** real cards charged; credits granted exactly once; over-limit actions correctly gated;
failed actions refund correctly; provider names remain internal.

---

## Phase D — Pre-launch ops gates (before public traffic)
**🟩 Emma — infra:**
1. **Backups:** enable Supabase automated backups + **PITR**; test a restore.
2. **Staging/prod split:** separate Supabase project + Vercel env (also fixes cron-only-on-prod gaps).
3. **Sentry:** create a project and set `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`,
   `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` in Vercel. The code integration is complete.
4. **CAPTCHA:** enable hCaptcha/Turnstile on Supabase auth (signup).
5. **Senior architecture review** (5–10 hrs): data model, RLS/multi-tenancy, enrichment cost paths, sync reliability.
6. Delete the stale **Firebase** records off `arcova.app`.

**🟦 Codex:**
- Verify a deliberate staging error appears in Sentry, source maps resolve, and alerts fire.
- Fill the **rollback runbook** placeholders (Vercel project, on-call name, incidents channel) — give me those.

**Gate:** errors are visible, data is recoverable, changes are validated in staging first.

### Release commands

- Code-only rehearsal: `npm run release:verify:code`
- Staging rehearsal including temporary database tests: `npm run release:verify:staging`
- Production environment + code rehearsal: `npm run release:verify:prod`
- Development credit-ledger proof: `npm run test:billing-ledger`
- Stripe test-clock lifecycle proof: `npm run test:stripe-lifecycle`
- Development RLS/tenancy proof: `npm run test:org-tenancy`
- Live operational view after sign-in: `/admin/launch-readiness`

---

## Recommended order
- **This week:** Phase A + Phase B (auth + HubSpot real-time) — both are ~30-min dashboard passes that unblock the product's core loops, and I close them out with end-to-end tests.
- **Before any public/charging launch:** Phase D ops gates (backups, Sentry, staging) — these are the "can't launch without" items.
- **When ready to monetize:** Phase C (after the shadow week).

## Billing and monitoring test run before paid customers

Use one internal Starter workspace and one internal Growth workspace.

1. Keep `ARCOVA_CREDIT_ENFORCEMENT=false`.
2. Import representative duplicate, cached, invalid, and fresh records.
3. Exercise every billable action, including provider failure and partial-success cases.
4. Confirm transactions reserve, settle, and refund the correct credit buckets.
5. Activate monitored contacts and accounts close to each tier cap.
6. Run contact and company dispatchers repeatedly until a complete monthly/weekly cycle
   is represented. Confirm due, processed, failed, overdue, and provider-cost telemetry.
7. Reconcile customer actions against `org_credit_transactions`, `org_usage_events`,
   `apify_run_usage`, and monitoring records daily for seven days.
8. In Stripe test mode, exercise monthly and annual signup, webhook replay, renewal,
   credit-pack purchase, failed payment/grace, recovery, cancellation, and annual expiry.
9. Enable enforcement for one internal workspace/action at a time before enabling it globally.

Paid launch gate: no double charges, no lost refunds, monitoring meets cadence, actual COGS
matches telemetry, and every Stripe lifecycle event is idempotent.

## What I need from you to keep moving (no waiting on the rest)
- A **Sentry project/DSN** → I verify the completed integration and configure alert tests.
- The **runbook specifics** (Vercel project name, on-call, incidents channel) → I finalize it.
- Otherwise: do the Phase A + B dashboard steps whenever, then ping me and I'll run the end-to-end verifications.
