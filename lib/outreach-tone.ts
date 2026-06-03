/**
 * Tone-of-voice settings (user_outreach_settings) → prompt fragment.
 *
 * The customer authors free-text guidance + a few worked examples in Settings;
 * we fold them into the hook + sequence generation prompts so generated copy
 * mirrors their voice instead of the model's default. Pure helpers — the
 * caller fetches with its own authed supabase client.
 */

export type OutreachTone = {
  guidance: string;
  examples: string[];
};

// Loose structural type — the real @supabase/supabase-js client has a deeply
// generic `from()` that triggers "excessively deep" instantiation if we try to
// model the query chain precisely. We only need `from`, so accept any builder.
type SupabaseLike = { from: (table: string) => { select: (cols: string) => any } };

type ToneRow = { tone_guidance: string | null; tone_examples: string[] | null };

/**
 * Best-effort fetch of the user's tone settings. Returns null if none set or on
 * any error — generation then proceeds with no tone block (current behaviour).
 */
export async function fetchOutreachTone(
  supabase: SupabaseLike,
  userId: string,
): Promise<OutreachTone | null> {
  try {
    const { data } = (await supabase
      .from('user_outreach_settings')
      .select('tone_guidance, tone_examples')
      .eq('user_id', userId)
      .maybeSingle()) as { data: ToneRow | null };
    if (!data) return null;
    const guidance = (data.tone_guidance ?? '').trim();
    const examples = (data.tone_examples ?? []).map((e) => e.trim()).filter(Boolean);
    if (!guidance && examples.length === 0) return null;
    return { guidance, examples };
  } catch {
    return null;
  }
}

/**
 * Render the tone settings as a prompt block. Empty string when there's nothing
 * to inject, so callers can interpolate unconditionally. The block is framed as
 * an OVERRIDE on default voice rules so the model prioritises the customer's
 * stated preferences over the generic guidance baked into the base prompt.
 */
export function renderToneBlock(tone: OutreachTone | null): string {
  if (!tone) return '';
  const parts: string[] = [
    '═══ TONE OF VOICE (the user set this in Settings — it OVERRIDES the generic voice rules above where they conflict) ═══',
  ];
  if (tone.guidance) {
    parts.push(`GUIDANCE:\n${tone.guidance}`);
  }
  if (tone.examples.length > 0) {
    parts.push(
      'EXAMPLES the user likes (mirror their phrasing, cadence, and sign-off — do NOT copy the content):',
      ...tone.examples.map((ex, i) => `Example ${i + 1}:\n"${ex}"`),
    );
  }
  return parts.join('\n\n');
}
