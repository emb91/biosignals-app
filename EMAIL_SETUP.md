# Email setup — auth links + Resend SMTP

**Done in code, verified end-to-end against a real inbox (no action needed):**
- **Org invites** — `app/api/org/invite` generates the `/auth/confirm` link itself, stores it behind
  a short one-time code, and emails it via Resend (`lib/auth-email.ts` + `lib/auth-links.ts`).
- **Password reset** — `app/api/auth/reset` does the same with a recovery token; `/auth/confirm`
  establishes the recovery session server-side before `/reset-password` loads.

Both bypass Supabase's ~2/hour cap and its broken default template entirely. They deliver from the
verified `auth.arcovabio.com` sender and were each tested through the connected inbox (invite signs
the member in; reset changes the password — new works, old rejected). The short-code indirection
exists because a raw 56-char token in the URL gets corrupted by email line-wrapping.

**Still needs the dashboard — signup confirmation only:** signup is the public front door, so it
stays on Supabase's `signUp` to keep its built-in rate-limit + CAPTCHA protections against mass
account creation / email-bombing (the abuse + bounce surface that flagged the project). Routing it
through an admin endpoint would lose those. So signup keeps Supabase's sender and just needs **Part
A** (point the Confirm-signup template at `/auth/confirm`) to stop dead-ending, and benefits from
**Part B** (SMTP) to escape the 2/hour cap.

**Sender domain — FINAL: `auth.arcova.bio`** (currently live on `auth.arcovabio.com` as interim;
flip pending Emma verifying the new domain). Customers sign up at arcova.bio, so auth from
`auth.arcova.bio` is the exact brand-match. The bare `arcova.bio` root still sends nothing — only the
`auth.` (and future `notify.`) subdomain sends, each with its own DKIM/reputation. Auth + product
notifications are low-risk transactional, safe on the brand domain; cold outreach is quarantined on
the separate `arcovabio.com`. Move = verify `auth.arcova.bio` in Resend → DNS into the arcova.bio
zone (`ns-cloud-b*`) → flip `RESEND_AUTH_FROM`. (`arcova.app` drops out of the email plan — web only.)

---

## Part A — Auth email templates (signup-confirmation only; reset + invites are handled in code)

`/auth/confirm` (committed) signs users in from email links via the `token_hash` pattern. The
default Supabase templates use `{{ .ConfirmationURL }}`, which routes through `/auth/v1/verify` and
returns the session in the URL **fragment** — invisible to the server, so those links dead-ended at
`/login`. Point the templates at `/auth/confirm` instead. (Invites already bypass this entirely; the
Invite-user row below is only needed if you ever fall back to Supabase-sent invites.)

**Supabase dashboard → Authentication → URL Configuration**
- Site URL: the running origin (prod URL; for local testing `http://localhost:3000`).
- Redirect URLs allow-list: add `…/auth/confirm` and `…/auth/callback` for each origin you use
  (prod + `http://localhost:3000` + `http://localhost:3001`).

**Supabase dashboard → Authentication → Email Templates** — replace the link in each template
so its `href` is (keep your own surrounding copy/branding):

| Template | href |
|---|---|
| Invite user | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/today` |
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/today` |
| Magic Link | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/today` |
| Reset Password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` |
| Change Email | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/today` |

Minimal Invite template body, for example:
```html
<h2>You're invited to Arcova</h2>
<p>Follow this link to accept the invite and set up your account:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/today">Accept the invite</a></p>
```

The `type` MUST match the template — it's passed to `verifyOtp`. Mismatch = "auth_failed".

---

## Part B — Resend as Supabase's SMTP provider

### B1. Install the Resend MCP (lets Claude create the domain + read DNS records)
Run yourself (the harness won't let Claude embed a key + auto-install). Use a **Full access**
key, not the send-only one — domain tools 403 on send-only keys:
```bash
claude mcp add resend -e RESEND_API_KEY=re_yourFULLaccessKey -- npx -y resend-mcp
```
Package is official: `github.com/resend/resend-mcp` (v2.6.1, maintained by the Resend team).
Restart Claude Code afterward so the tools load into the session.

### B2. Create + verify the sending domain
Create **`auth.arcovabio.com`** in Resend (dashboard → Domains → Add Domain, ~30s — or Claude via
the MCP / a full-access key). Resend returns records to add:
- **SPF**: MX + TXT on a `send.auth.arcovabio.com` subdomain
- **DKIM**: a TXT record (`resend._domainkey.auth.arcovabio.com`)
- Optional **DMARC** TXT
The exact DKIM value is generated per-domain at creation, so the records can't be pre-written — they
come from this step.

### B3. Add the DNS records
`arcovabio.com` is on **Google Cloud DNS** (nameservers `ns-cloud-c*.googledomains.com` — note: a
DIFFERENT zone from arcova.bio's `ns-cloud-b*`). The root already has Google Workspace records
(MX `smtp.google.com`, SPF `v=spf1 include:_spf.google.com ~all`, a google-site-verification TXT) —
the new records are all on the `auth`/`send.auth` subdomain, so they don't touch those. Add them in
the Google Cloud console, or Claude can add them via the Cloud DNS API IF that zone is in the same
GCP project as our service account (unconfirmed — needs a check). Wait for Resend to show **Verified**.

### B4. Point Supabase at Resend (SMTP)
**Supabase dashboard → Project Settings → Authentication → SMTP Settings → Enable custom SMTP:**
- Host: `smtp.resend.com`
- Port: `465` (or `587`)
- Username: `resend`
- Password: a Resend **SMTP** API key
- Sender email: `noreply@auth.arcovabio.com` · Sender name: `Arcova`
- Raise the auth rate limit (Authentication → Rate Limits) once SMTP is live — the default 2/hour
  is the Supabase built-in-sender cap we kept hitting. (This covers signup-confirm + reset; invites
  already send via Resend's API, not this SMTP path.)

### B4b. Flip the Resend sender to `auth.arcova.bio` (one env var)
Invites + password reset send via Resend's HTTP API using `RESEND_AUTH_FROM` (currently
`Arcova <noreply@auth.arcovabio.com>`, the verified interim domain). Once **`auth.arcova.bio`** shows
Verified in Resend, set in `.env.local` (and Vercel):
```
RESEND_AUTH_FROM=Arcova <noreply@auth.arcova.bio>
```
No code change. Don't set it before the domain is Verified — sending from an unverified domain 403s.

### B5. Verify end-to-end
Claude re-sends invite + reset to the connected inbox (`emma@arcovabio.com`) and confirms they arrive
and the `/auth/confirm` link works. QA owner fixture `emma+qa2@arcova.bio` (pw retained) is standing
by to send the invite.

---

## Status
- [x] `/auth/confirm` sign-in route (short `?code` + direct `?token_hash`) + `?error=auth_failed` on /login
- [x] `auth.arcovabio.com` created in Resend + DNS verified (Emma)
- [x] `RESEND_AUTH_FROM` set to `Arcova <noreply@auth.arcovabio.com>`
- [x] **Org invites: DONE end-to-end** via Resend (verified sender → inbox → short `?code` link →
      signs member in). Tested against the real inbox.
- [x] **Password reset: DONE end-to-end** via Resend (`/api/auth/reset` → `/auth/confirm` recovery
      session → `/reset-password`). Tested: new password works, old rejected. Rate-limited + no enumeration.
- [ ] **Move sender to `auth.arcova.bio`** (Emma verifies domain → Claude flips `RESEND_AUTH_FROM`, B4b)
- [ ] **Part A template — signup confirmation only** (Emma, dashboard). Reset + invites no longer need it.
- [ ] Supabase custom SMTP + raise rate limit (B4) — for signup confirmation (the one flow still on Supabase)
- [ ] Delete stale Firebase records off `arcova.app` (Emma, housekeeping)
