# Production email setup

> **Purpose:** dashboard instructions for `LAUNCH_PLAN.md` Phase A.
> **Owner:** Emma completes the settings; Codex verifies the flows.
> **Do this once:** before public signup.
> **Finished when:** signup confirmation, invite, password reset, and email
> change all arrive from `mail.arcova.bio` and their links work.

## What Emma needs to do

### 1. Configure production URLs in Supabase

Supabase dashboard → **Authentication → URL Configuration**:

- Set **Site URL** to the production app origin.
- Add these paths to the redirect allow-list for production and any retained
  local/staging origins:
  - `/auth/confirm`
  - `/auth/callback`

### 2. Update the signup confirmation template

Supabase dashboard → **Authentication → Email Templates → Confirm signup**.

Use this link:

```html
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/today
```

The `type=signup` value must match the template.

Optional fallback templates, if you keep Supabase delivery enabled for them:

| Template | Link |
|---|---|
| Invite user | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/today` |
| Magic Link | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/today` |
| Reset Password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` |
| Change Email | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/today` |

Invites and password resets normally use Arcova's custom Resend routes, so the
fallback templates are not part of the primary flow.

### 3. Enable Resend SMTP for Supabase Auth

Supabase dashboard → **Project Settings → Authentication → SMTP Settings**:

- Host: `smtp.resend.com`
- Port: `465` or `587`
- Username: `resend`
- Password: a Resend SMTP API key
- Sender email: `noreply@mail.arcova.bio`
- Sender name: `Arcova`

Then raise the Supabase auth email rate limit above its built-in-sender default.

### 4. Set the production sender in Vercel

Vercel → `biosignals-app` → production environment variables:

```text
RESEND_AUTH_FROM=Arcova <noreply@mail.arcova.bio>
```

Redeploy after changing the variable.

### 5. Enable signup abuse protection

Before public traffic, enable hCaptcha or Turnstile in Supabase Auth.

## Then hand back to Codex

Send:

> Email production setup is done—verify signup confirmation and email change.

Codex will test:

- signup confirmation;
- email change;
- password reset;
- organization invite;
- sender and inbox placement;
- `/auth/confirm` link behavior.

## Already completed—do not repeat

- `mail.arcova.bio` is verified in Resend.
- DNS/DKIM for the sending domain is installed.
- Organization invites use the custom Resend flow.
- Password reset uses the custom Resend flow.
- `/auth/confirm` supports the short-code and token-hash flows.
- Signup email deliverability validation and public-endpoint rate limiting are implemented.

## Checklist

- [ ] Production Site URL and redirect allow-list configured.
- [ ] Confirm-signup template updated.
- [ ] Resend SMTP enabled in Supabase.
- [ ] Supabase auth email rate limit raised.
- [ ] `RESEND_AUTH_FROM` set in Vercel production and redeployed.
- [ ] CAPTCHA enabled before public signup.
- [ ] Codex verification passed.
