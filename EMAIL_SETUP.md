# Email setup — auth links + Resend SMTP

**What's already fixed in code (no action needed):** org **invites** no longer touch Supabase's
sender or templates at all — the app generates the `/auth/confirm` sign-in link itself and sends a
branded email via Resend (`lib/auth-email.ts`, `app/api/org/invite`). Verified end-to-end: invite →
user created + attached to org → link signs the member in. So the invite dead-end + rate-limit bugs
are **resolved in code**; the only upgrade left for invites is swapping the sender from the shared
`onboarding@resend.dev` to your own `auth.arcovabio.com` (Part B) for reliable inbox delivery.

**What still needs the dashboard:** **signup-confirmation** and **password-reset** emails still go
through Supabase's own sender + templates (they're client-initiated; routing them through admin
endpoints would add an account-creation/email-bombing abuse surface, so they're intentionally left
on Supabase). Those two need **Part A** to stop dead-ending. **Part B** (Resend SMTP) then drops the
~2/hour cap and bounce risk for them too.

Domain note for the verified sender below: it lives in Resend; see the domain rationale at the foot.

Domain decision (Emma, 2026-06-13): auth email sends from **`auth.arcovabio.com`** — a
subdomain of the outbound domain. Rationale isn't reputation "isolation" (that's partial and
debated); it's **stream hygiene**: keep must-always-deliver auth mail off the same identity that's
being actively warmed for risky cold outbound, so a bad outbound week can't knock out logins. The
root `arcovabio.com` already carries Google Workspace human mail (MX → Google, SPF →
`_spf.google.com`) **and** the outbound warming — a subdomain keeps Resend's machine-sent
transactional cleanly apart from both.

---

## Part A — Auth email templates (fixes signup-confirm + password-reset links)

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

### B4b. Flip the invite sender to the verified domain (one env var)
Invites send via Resend's HTTP API using `RESEND_AUTH_FROM` (currently `Arcova <onboarding@resend.dev>`,
the shared sandbox sender — which Google Workspace filters, so test invites don't land). Once
`auth.arcovabio.com` shows **Verified**, set in `.env.local` (and Vercel):
```
RESEND_AUTH_FROM=Arcova <noreply@auth.arcovabio.com>
```
Then invites deliver from our own domain. No code change.

### B5. Verify end-to-end
Claude re-sends an invite to a real inbox (`emma@arcovabio.com`, connected here) and confirms it
arrives + the `/auth/confirm` link lands signed-in on `/today`. The QA owner fixture
(`emma+qa2@arcova.bio` / pw retained) is standing by to send that invite.

---

## Status
- [x] `/auth/confirm` token_hash sign-in route + `?error=auth_failed` surfaced on /login
- [x] **Invites rebuilt to send via Resend** (self-generated link) — no template/rate-limit dependency;
      verified end-to-end (user created + attached + link signs in). Sends from `resend.dev` until B4b.
- [ ] Part A templates pasted — for **signup-confirm + password-reset** only (Emma, dashboard)
- [ ] `auth.arcovabio.com` created in Resend + DNS records added to Google Cloud DNS + Verified
- [ ] `RESEND_AUTH_FROM` flipped to the verified domain (B4b)
- [ ] Supabase custom SMTP enabled + rate limit raised (B4) — for signup-confirm + reset
- [ ] Final inbox-delivery re-test once the domain is verified (Claude, via connected inbox)
