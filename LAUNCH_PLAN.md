# Launch plan — what's left, who does what

One checklist pulling together the work scattered across `EMAIL_SETUP.md`,
`BILLING_PLAN.md`, `HUBSPOT_WEBHOOK_PLAN.md`, `ROLLBACK_RUNBOOK.md`, and `BACKLOG.md`.
**🟩 = Emma (dashboard/infra/decision) · 🟦 = Claude (code).** Phases are ordered by
the critical path; B and D can run in parallel with A.

---

## ✅ Already shipped (this session — code done + verified)
- Auth email: **invites + password reset** live via Resend from the verified `mail.arcova.bio` (EU). Signup **ZeroBounce** deliverability check. `/auth/confirm` token-hash + short-code sign-in. Email-change flow on /my-profile.
- Billing: Stripe org billing phases 1–6 + billing-exempt orgs + batched import metering. **Shadow mode** (nothing enforced yet).
- HubSpot: real-time **webhook receiver** built + verified; sync-status UI in Settings. (Foundation was already ~80% built.)
- Ops: deployment rollback runbook.

---

## Phase A — Finish auth email (≈30 min, unblocks signup + email-change)
**🟩 Emma — Supabase dashboard:**
1. Auth → URL Configuration: set **Site URL** (prod) + add `…/auth/confirm` & `…/auth/callback` to redirect allow-list (prod + localhost).
2. Auth → Email Templates: point **Confirm signup** (and Recovery / Magic Link / Change Email as fallback) at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/today` (type per template — see EMAIL_SETUP.md Part A).
3. Project Settings → Auth → **SMTP**: enable custom SMTP → `smtp.resend.com`, user `resend`, password = a Resend API key, sender `noreply@mail.arcova.bio`. Then **raise the auth rate limit** off the 2/hour default.
4. Vercel: set `RESEND_AUTH_FROM=Arcova <noreply@mail.arcova.bio>` (prod).

**🟦 Claude:** once SMTP + template are in, re-test **signup confirmation** and **email-change** end-to-end through the connected inbox (same as I did for invites/reset). Report pass/fail.

**Gate:** all four auth-email flows deliver from `mail.arcova.bio` with working links.

---

## Phase B — Turn on HubSpot real-time (≈20 min; parallel with A)
**🟩 Emma — HubSpot app + Vercel:**
1. Confirm `HUBSPOT_CLIENT_SECRET` is set in Vercel (it's the webhook signing key).
2. HubSpot developer app → **Webhooks**: target `https://<app>/api/hubspot/webhook`, subscribe to `contact.creation`, `contact.propertyChange`, `deal.propertyChange`.
3. **Reconnect HubSpot once** in Settings so the existing connection backfills its `hubspot_portal_id` (new connections capture it automatically).

**🟦 Claude:** verify a real event flows end-to-end (signal lands in `signal_source_events`, readiness recomputes, dedup holds) — I can drive a test change via the HubSpot MCP.

**Gate:** a contact/deal change in HubSpot triggers a readiness resync within ~2 min (cron remains the safety net).

---

## Phase C — Billing go-live (when you're ready to charge)
**🟩 Emma:**
1. Let it **shadow-meter ~1 week**; sanity-check `org_billable_contact_events` vs real usage.
2. Decide final price points (or keep current Team $199 / Scale $499 / pack $149).
3. Stripe **live mode**: create live keys → run `node scripts/stripe-bootstrap.mjs` (prints live price IDs) → set `STRIPE_SECRET_KEY` + price IDs in Vercel.
4. Stripe dashboard → **webhook endpoint** → `https://<app>/api/stripe/webhook`, copy signing secret → `STRIPE_WEBHOOK_SECRET` in Vercel.
5. Flip `BILLING_ENFORCEMENT=true` (after the shadow week + the hardening below).

**🟦 Claude:** before enforcement — the import-gate **enforcement-readiness hardening** (already flagged) and a **live-mode Stripe test-clock pass**. Then I verify the full subscribe→limit→pack→renew→cancel lifecycle.

**Gate:** real cards charged; over-limit imports/enrichment correctly gated.

---

## Phase D — Pre-launch ops gates (before public traffic)
**🟩 Emma — infra:**
1. **Backups:** enable Supabase automated backups + **PITR**; test a restore.
2. **Staging/prod split:** separate Supabase project + Vercel env (also fixes cron-only-on-prod gaps).
3. **Sentry:** create a project, grab the DSN.
4. **CAPTCHA:** enable hCaptcha/Turnstile on Supabase auth (signup).
5. **Senior architecture review** (5–10 hrs): data model, RLS/multi-tenancy, enrichment cost paths, sync reliability.
6. Delete the stale **Firebase** records off `arcova.app`.

**🟦 Claude:**
- **Wire Sentry** once you give me the DSN (`@sentry/wizard`, ~15 min) — app + API routes + crons, alerting on new/spiking errors.
- Fill the **rollback runbook** placeholders (Vercel project, on-call name, incidents channel) — give me those.

**Gate:** errors are visible, data is recoverable, changes are validated in staging first.

---

## Recommended order
- **This week:** Phase A + Phase B (auth + HubSpot real-time) — both are ~30-min dashboard passes that unblock the product's core loops, and I close them out with end-to-end tests.
- **Before any public/charging launch:** Phase D ops gates (backups, Sentry, staging) — these are the "can't launch without" items.
- **When ready to monetize:** Phase C (after the shadow week).

## What I need from you to keep moving (no waiting on the rest)
- A **Sentry DSN** → I wire error monitoring now.
- The **runbook specifics** (Vercel project name, on-call, incidents channel) → I finalize it.
- Otherwise: do the Phase A + B dashboard steps whenever, then ping me and I'll run the end-to-end verifications.
