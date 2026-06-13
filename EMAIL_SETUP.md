# Email setup — auth links + Resend SMTP

Two independent things. **Part A** makes emailed auth links actually work (the invite
dead-end bug) and needs no Resend. **Part B** moves sending to Resend so we drop
Supabase's ~2-emails/hour cap and the bounce-suspension risk.

Domain decision (Emma, 2026-06-13): auth email sends from **`auth.arcovabio.com`** — a
subdomain of the outbound domain. Rationale isn't reputation "isolation" (that's partial and
debated); it's **stream hygiene**: keep must-always-deliver auth mail off the same identity that's
being actively warmed for risky cold outbound, so a bad outbound week can't knock out logins. The
root `arcovabio.com` already carries Google Workspace human mail (MX → Google, SPF →
`_spf.google.com`) **and** the outbound warming — a subdomain keeps Resend's machine-sent
transactional cleanly apart from both.

---

## Part A — Auth email templates (do this first; fixes invites today)

The app now has `/auth/confirm` (committed) which signs users in from email links via the
`token_hash` pattern. The default Supabase templates use `{{ .ConfirmationURL }}`, which routes
through `/auth/v1/verify` and returns the session in the URL **fragment** — invisible to the
server, so every emailed link dead-ended at `/login`. Point the templates at `/auth/confirm`
instead.

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
  is the Supabase built-in-sender cap we kept hitting.

### B5. Verify end-to-end
Claude re-sends an invite to a real inbox (`emma@arcovabio.com`, connected here) and confirms the
emailed `/auth/confirm` link lands signed-in on `/today`. A retained QA owner fixture
(`emma+qa2@arcova.bio`) is standing by to send that invite.

---

## Status
- [x] `/auth/confirm` route shipped (token_hash sign-in) + `?error=auth_failed` surfaced on /login
- [ ] Part A templates pasted (Emma — dashboard)
- [ ] Resend MCP installed w/ full-access key + restart (Emma)
- [ ] `auth.arcovabio.com` created in Resend + DNS verified
- [ ] Supabase custom SMTP enabled + rate limit raised
- [ ] End-to-end invite re-test (Claude, via connected inbox)
