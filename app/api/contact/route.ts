import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase-admin';
import { sendAuthEmail, isResendConfigured, escapeHtml, buildContactAckEmail } from '@/lib/auth-email';

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(200).optional().default(''),
  message: z.string().trim().min(1).max(5_000),
  website: z.string().max(0).optional(),
  turnstileToken: z.string().max(2_048).optional(),
});

export async function POST(req: NextRequest) {
  const rate = await checkRateLimit(`contact-form:${clientIp(req)}`, 5, 60 * 60, {
    failOpen: false,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many submissions. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  try {
    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 16_000) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }

    const parsed = contactSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 400 });
    }
    const { name, email, company, message, website, turnstileToken } = parsed.data;
    // Hidden honeypot field: bots commonly populate it; humans never see it.
    if (website) return NextResponse.json({ success: true });

    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
    if (process.env.NODE_ENV === 'production' && !turnstileSecret) {
      console.error('[contact] TURNSTILE_SECRET_KEY is not configured');
      return NextResponse.json({ error: 'Contact form is temporarily unavailable.' }, { status: 503 });
    }
    if (turnstileSecret) {
      if (!turnstileToken) {
        return NextResponse.json({ error: 'Please complete the security check.' }, { status: 400 });
      }
      const verification = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: turnstileSecret,
            response: turnstileToken,
            remoteip: clientIp(req),
            idempotency_key: crypto.randomUUID(),
          }),
          signal: AbortSignal.timeout(8_000),
        },
      ).then((response) => response.json() as Promise<{ success?: boolean }>);
      if (!verification.success) {
        return NextResponse.json({ error: 'Security check failed. Please try again.' }, { status: 400 });
      }
    }

    const admin = createAdminClient();
    const { error: insertError } = await admin.from('contact_submissions').insert({
      name,
      email,
      company: company || null,
      message,
    });

    if (insertError) {
      console.error('[contact] could not store submission', { message: insertError.message });
      return NextResponse.json({ error: 'Could not submit the form. Please try again.' }, { status: 502 });
    }

    // Best-effort emails (replace the old Airtable -> Zapier flow). The submission
    // is already saved, so an email failure must never fail the request.
    if (isResendConfigured()) {
      const notifyTo = process.env.CONTACT_NOTIFY_EMAIL || 'emma@arcova.bio';
      const bookingUrl = process.env.CONTACT_BOOKING_URL || 'https://calendly.com/emma-arcova/30min';
      const cell = 'font:14px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;';

      // 1) Internal notification to the team (Reply-To the lead, so a reply goes straight to them).
      try {
        const internalHtml = `
          <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(name)} just submitted the contact form.</div>
          <p style="font:600 16px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0d3547;">New contact form submission</p>
          <p style="${cell}"><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p style="${cell}"><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p style="${cell}"><strong>Company:</strong> ${escapeHtml(company || 'Not provided')}</p>
          <p style="${cell}"><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
          <p style="font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#94a3b8;">Reply to this email to respond to ${escapeHtml(name)} directly.</p>`;
        const sent = await sendAuthEmail({
          to: notifyTo,
          replyTo: email,
          subject: `New website enquiry: ${name}${company ? `, ${company}` : ''}`,
          html: internalHtml,
        });
        if (!sent.ok) console.error('[contact] notification email failed', { error: sent.error });
      } catch (mailError) {
        console.error('[contact] notification email threw', mailError);
      }

      // 2) Acknowledgment to the person who submitted (Reply-To the team inbox).
      try {
        const ack = buildContactAckEmail({ name, bookingUrl });
        const sent = await sendAuthEmail({ to: email, replyTo: notifyTo, subject: ack.subject, html: ack.html });
        if (!sent.ok) console.error('[contact] acknowledgment email failed', { error: sent.error });
      } catch (mailError) {
        console.error('[contact] acknowledgment email threw', mailError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[contact] submission failed', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not submit the form. Please try again.' }, { status: 500 });
  }
}

// Only allow POST
export const dynamic = 'force-dynamic';
