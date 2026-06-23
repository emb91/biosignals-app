/**
 * Transactional auth email via Resend's HTTP API.
 *
 * Why this exists: Supabase's built-in sender is rate-limited (~2/hour) and its
 * default templates route through /auth/v1/verify, which returns the session in
 * the URL *fragment* — invisible to the server, so emailed links dead-ended at
 * /login. Instead we generate the sign-in link ourselves (admin generateLink →
 * token_hash → /auth/confirm) and send it through Resend. This bypasses the
 * rate limit, needs no dashboard template edits, and only requires a send-scoped
 * RESEND_API_KEY.
 *
 * Sender: RESEND_AUTH_FROM. Production uses
 * Arcova <noreply@mail.arcova.bio>.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function resendFrom(): string {
  return process.env.RESEND_AUTH_FROM || 'Arcova <onboarding@resend.dev>';
}

export async function sendAuthEmail(params: {
  to: string;
  subject: string;
  html: string;
  /** Optional Reply-To (e.g. so a contact-form notification replies to the lead). */
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: resendFrom(),
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const BRAND_NAVY = '#0d3547';

/**
 * Minimal, on-brand transactional shell.
 * `ctaLabel`/`ctaUrl` is the button; `intro` the lead line.
 * `preheader` is the hidden inbox preview snippet; a plain-text fallback link
 * is rendered under the button for clients that strip buttons.
 */
function authEmailShell(params: {
  heading: string;
  intro: string;
  ctaLabel: string;
  ctaUrl: string;
  footnote?: string;
  preheader?: string;
  fallbackLabel?: string;
}): string {
  const preheader = params.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(params.preheader)}</div>`
    : '';
  const fallbackLabel = params.fallbackLabel ?? 'Button not working? Paste this link into your browser:';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    ${preheader}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f7;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e2e8f0;">
          <tr><td style="font-size:18px;font-weight:700;color:${BRAND_NAVY};padding-bottom:18px;">Arcova</td></tr>
          <tr><td style="font-size:20px;font-weight:600;color:#0f172a;padding-bottom:10px;">${params.heading}</td></tr>
          <tr><td style="font-size:15px;line-height:22px;color:#475569;padding-bottom:24px;">${params.intro}</td></tr>
          <tr><td style="padding-bottom:14px;">
            <a href="${params.ctaUrl}" style="display:inline-block;background:${BRAND_NAVY};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px;">${params.ctaLabel}</a>
          </td></tr>
          <tr><td style="font-size:12px;line-height:18px;color:#94a3b8;padding-bottom:24px;word-break:break-all;">${fallbackLabel}<br><a href="${params.ctaUrl}" style="color:${BRAND_NAVY};">${params.ctaUrl}</a></td></tr>
          <tr><td style="font-size:13px;line-height:20px;color:#94a3b8;">${params.footnote ?? "If you didn't expect this email, you can safely ignore it."}</td></tr>
        </table>
        <table role="presentation" width="480" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:12px;color:#94a3b8;padding:16px 8px 0;">Arcova · GTM intelligence for life science</td>
        </tr></table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildOrgInviteEmail(params: {
  acceptUrl: string;
  orgName: string | null;
  inviterName: string | null;
}): { subject: string; html: string } {
  const workspace = params.orgName?.trim() || 'a workspace on Arcova';
  const inviter = params.inviterName?.trim();
  const subject = inviter
    ? `${inviter} invited you to ${workspace} on Arcova`
    : `You're invited to ${workspace} on Arcova`;
  const intro = `${inviter ? `${escapeHtml(inviter)} invited you` : 'You\'ve been invited'} to join <strong>${escapeHtml(workspace)}</strong> on Arcova, the revenue engine that watches your life-science market for buying signals, ranks who to reach out to, and drafts the outreach.<br><br>Accept below to set up your account. The link signs you in directly, so there's no password to create.`;
  return {
    subject,
    html: authEmailShell({
      preheader: 'Accept to set up your account and start working with your team.',
      heading: 'Join your team on Arcova',
      intro,
      ctaLabel: 'Accept the invite',
      ctaUrl: params.acceptUrl,
      footnote: 'This invite is just for you, so keep the link private. It expires in 7 days. If you weren\'t expecting it, you can safely ignore this email.',
    }),
  };
}

export function buildPasswordResetEmail(params: { resetUrl: string }): { subject: string; html: string } {
  return {
    subject: 'Reset your Arcova password',
    html: authEmailShell({
      preheader: 'Set a new password. This link expires shortly and works once.',
      heading: 'Reset your password',
      intro:
        'We got a request to reset the password for your Arcova account. Choose a new one below. The link signs you in to set it, then expires shortly.',
      ctaLabel: 'Reset password',
      ctaUrl: params.resetUrl,
      footnote: "Didn't request this? You can safely ignore this email. Your password won't change. For your security, the link expires shortly and can only be used once.",
    }),
  };
}

export function buildContactAckEmail(params: { name: string; bookingUrl: string }): { subject: string; html: string } {
  const intro = `Hi ${escapeHtml(params.name)}, thanks for getting in touch with Arcova. We've got your message and someone from our team will get back to you shortly.<br><br>Prefer to skip the back and forth? Grab a time that suits you and we'll talk it through.`;
  return {
    subject: 'Thanks for reaching out to Arcova',
    html: authEmailShell({
      preheader: "We got your message and we'll be in touch shortly.",
      heading: 'Thanks for reaching out',
      intro,
      ctaLabel: 'Book a 30-minute call',
      ctaUrl: params.bookingUrl,
      fallbackLabel: 'Or paste this link into your browser:',
      footnote: "You're receiving this because you submitted the contact form at arcova.bio. If that wasn't you, you can ignore this email.",
    }),
  };
}

export function buildSignupConfirmEmail(params: { confirmUrl: string }): { subject: string; html: string } {
  return {
    subject: 'Confirm your email to start using Arcova',
    html: authEmailShell({
      preheader: 'One click to verify your email and finish setting up.',
      heading: 'Confirm your email',
      intro:
        'Welcome to Arcova. Confirm your email below to finish setting up your account and start mapping your market.',
      ctaLabel: 'Confirm my email',
      ctaUrl: params.confirmUrl,
      footnote: "If you didn't create an Arcova account, you can safely ignore this email.",
    }),
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
