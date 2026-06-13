# Email setup — auth links + Resend SMTP

Two independent things. **Part A** makes emailed auth links actually work (the invite
dead-end bug) and needs no Resend. **Part B** moves sending to Resend so we drop
Supabase's ~2-emails/hour cap and the bounce-suspension risk.

Domain split (deliberate): **`arcovabio.com` is reserved for outbound/sales warming — do
NOT put auth email on it.** Auth email goes on a subdomain of the product domain:
**`auth.arcova.bio`**. Keeps transactional reputation isolated from the warmed outbound domain.

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
Once the MCP is loaded, Claude can create `auth.arcova.bio` and read back the exact DNS records.
(Or do it in the Resend dashboard → Domains → Add Domain.) Resend returns a set of records:
- **SPF**: MX + TXT on a `send.auth.arcova.bio` subdomain
- **DKIM**: a TXT record (`resend._domainkey…`)
- Optional **DMARC** TXT

### B3. Add the DNS records
`arcova.bio` is on **Google Cloud DNS** (nameservers `ns-cloud-b*.googledomains.com`). Add the
records from B2 in that zone. If the zone lives in the same GCP project as our service account,
Claude may be able to add them via the Cloud DNS API — ask, and confirm the project/zone first.
Otherwise add them in the Google Cloud console. Wait for Resend to show the domain **Verified**.

### B4. Point Supabase at Resend (SMTP)
**Supabase dashboard → Project Settings → Authentication → SMTP Settings → Enable custom SMTP:**
- Host: `smtp.resend.com`
- Port: `465` (or `587`)
- Username: `resend`
- Password: a Resend **SMTP** API key
- Sender email: `noreply@auth.arcova.bio` · Sender name: `Arcova`
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
- [ ] `auth.arcova.bio` created + DNS verified
- [ ] Supabase custom SMTP enabled + rate limit raised
- [ ] End-to-end invite re-test (Claude, via connected inbox)
