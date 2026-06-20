import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

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

    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
    const AIRTABLE_CONTACT_TABLE_ID = process.env.AIRTABLE_CONTACT_TABLE_ID;

    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_CONTACT_TABLE_ID) {
      console.error('[contact] destination is not configured');
      return NextResponse.json({ error: 'Contact form is temporarily unavailable.' }, { status: 503 });
    }

    const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CONTACT_TABLE_ID}`;
    const fields: Record<string, string> = {
      'Name': name,
      'Email': email,
      'Company name (optional)': company || '',
      'What\'s on your mind?': message,
    };

    const airtableRes = await fetch(airtableUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (!airtableRes.ok) {
      console.error('[contact] destination rejected submission', { status: airtableRes.status });
      return NextResponse.json({ error: 'Could not submit the form. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[contact] submission failed', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not submit the form. Please try again.' }, { status: 500 });
  }
}

// Only allow POST
export const dynamic = 'force-dynamic';
