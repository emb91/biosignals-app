/**
 * GET /api/outreach/tone  → the current user's outreach settings:
 *   { guidance, examples[], ctaUrl, ctaLabel, updatedAt }
 * PUT /api/outreach/tone  → partial upsert. Only the keys PRESENT in the body
 *   are written, so the tone modal ({guidance, examples}) and the CTA card
 *   ({ctaUrl, ctaLabel}) can save independently without clobbering each other.
 *
 * examples[] shape: [{subject: string, body: string}]. Legacy plain-string
 * values (from before the subject field existed) are tolerated on read via
 * coerceExamples() in lib/outreach-tone.ts.
 *
 * Tone guidance + examples are injected into the sequence generation prompt
 * (lib/outreach-tone.ts). The CTA link is offered as an opt-in per-message
 * insert in the /outreach editor — it is NOT auto-added to generated copy.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { coerceExamples } from '@/lib/outreach-tone';

const MAX_GUIDANCE = 2000;
const MAX_EXAMPLES = 6;
const MAX_SUBJECT_LEN = 200;
const MAX_EXAMPLE_LEN = 1500;
const MAX_CTA_URL = 500;
const MAX_CTA_LABEL = 120;

/** Light normalisation: trim, and prepend https:// when no scheme is present. */
function normalizeUrl(raw: string): string {
  const t = raw.trim().slice(0, MAX_CTA_URL);
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('user_outreach_settings')
    .select('tone_guidance, tone_examples, cta_url, cta_label, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    guidance: data?.tone_guidance ?? '',
    examples: coerceExamples(data?.tone_examples ?? []),
    ctaUrl: data?.cta_url ?? '',
    ctaLabel: data?.cta_label ?? '',
    updatedAt: data?.updated_at ?? null,
  });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    guidance?: unknown;
    examples?: unknown;
    ctaUrl?: unknown;
    ctaLabel?: unknown;
  };

  // Build a partial payload — only include columns whose key is present in the
  // request, so a CTA-only save doesn't wipe tone, and vice versa. (Supabase
  // upsert SETs only the provided columns on conflict; omitted ones are left
  // untouched.)
  const payload: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  const out: Record<string, unknown> = {};

  if ('guidance' in body) {
    const guidance =
      typeof body.guidance === 'string' ? body.guidance.trim().slice(0, MAX_GUIDANCE) : '';
    payload.tone_guidance = guidance || null;
    out.guidance = guidance;
  }
  if ('examples' in body) {
    // Accept [{subject, body}] objects; coerceExamples handles legacy plain strings too.
    const raw = coerceExamples(body.examples)
      .slice(0, MAX_EXAMPLES)
      .map((e) => ({
        subject: e.subject.slice(0, MAX_SUBJECT_LEN),
        body: e.body.slice(0, MAX_EXAMPLE_LEN),
      }))
      .filter((e) => e.body.length > 0);
    payload.tone_examples = JSON.stringify(raw);
    out.examples = raw;
  }
  if ('ctaUrl' in body) {
    const ctaUrl = typeof body.ctaUrl === 'string' ? normalizeUrl(body.ctaUrl) : '';
    payload.cta_url = ctaUrl || null;
    out.ctaUrl = ctaUrl;
  }
  if ('ctaLabel' in body) {
    const ctaLabel =
      typeof body.ctaLabel === 'string' ? body.ctaLabel.trim().slice(0, MAX_CTA_LABEL) : '';
    payload.cta_label = ctaLabel || null;
    out.ctaLabel = ctaLabel;
  }

  const { error } = await supabase
    .from('user_outreach_settings')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    return NextResponse.json({ error: 'Failed to save', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...out });
}
