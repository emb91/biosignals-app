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
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: resendFrom(), to: [params.to], subject: params.subject, html: params.html }),
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

/** Minimal, on-brand transactional shell. `cta` is the button; `intro` the lead line. */
function authEmailShell(params: { heading: string; intro: string; ctaLabel: string; ctaUrl: string; footnote?: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f7;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:36px;border:1px solid #e2e8f0;">
          <tr><td style="font-size:18px;font-weight:700;color:${BRAND_NAVY};padding-bottom:18px;">Arcova</td></tr>
          <tr><td style="font-size:20px;font-weight:600;color:#0f172a;padding-bottom:10px;">${params.heading}</td></tr>
          <tr><td style="font-size:15px;line-height:22px;color:#475569;padding-bottom:24px;">${params.intro}</td></tr>
          <tr><td style="padding-bottom:24px;">
            <a href="${params.ctaUrl}" style="display:inline-block;background:${BRAND_NAVY};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px;">${params.ctaLabel}</a>
          </td></tr>
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
  const subject = `You're invited to ${workspace} on Arcova`;
  const intro = `${inviter ? `${escapeHtml(inviter)} invited you` : 'You\'ve been invited'} to join <strong>${escapeHtml(workspace)}</strong> on Arcova. Accept to set up your account and start working alongside your team.`;
  return {
    subject,
    html: authEmailShell({
      heading: 'Join your team on Arcova',
      intro,
      ctaLabel: 'Accept the invite',
      ctaUrl: params.acceptUrl,
      footnote: 'This invite link signs you in directly. If you weren\'t expecting it, you can ignore this email.',
    }),
  };
}

export function buildPasswordResetEmail(params: { resetUrl: string }): { subject: string; html: string } {
  return {
    subject: 'Reset your Arcova password',
    html: authEmailShell({
      heading: 'Reset your password',
      intro:
        'We got a request to reset your Arcova password. Click below to choose a new one — the link signs you in to set it. It expires shortly.',
      ctaLabel: 'Reset password',
      ctaUrl: params.resetUrl,
      footnote: "If you didn't request this, you can safely ignore this email — your password won't change.",
    }),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
