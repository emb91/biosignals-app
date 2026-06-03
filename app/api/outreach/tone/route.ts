/**
 * GET  /api/outreach/tone  → the current user's tone-of-voice settings.
 * PUT  /api/outreach/tone  → upsert { guidance, examples }.
 *
 * Tone guidance + worked examples are injected into the hook + sequence
 * generation prompts (see lib/outreach-tone.ts and app/api/outreach/sequence)
 * so generated copy sounds like the customer, not a generic model default.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

const MAX_GUIDANCE = 2000;
const MAX_EXAMPLES = 5;
const MAX_EXAMPLE_LEN = 1500;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('user_outreach_settings')
    .select('tone_guidance, tone_examples, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    guidance: data?.tone_guidance ?? '',
    examples: (data?.tone_examples ?? []) as string[],
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
  };

  const guidance =
    typeof body.guidance === 'string' ? body.guidance.trim().slice(0, MAX_GUIDANCE) : '';
  const examples = Array.isArray(body.examples)
    ? (body.examples.filter((e) => typeof e === 'string') as string[])
        .map((e) => e.trim())
        .filter((e) => e.length > 0)
        .slice(0, MAX_EXAMPLES)
        .map((e) => e.slice(0, MAX_EXAMPLE_LEN))
    : [];

  const { error } = await supabase
    .from('user_outreach_settings')
    .upsert(
      {
        user_id: user.id,
        tone_guidance: guidance || null,
        tone_examples: examples,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    return NextResponse.json({ error: 'Failed to save', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, guidance, examples });
}
