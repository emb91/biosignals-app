/**
 * POST /api/outreach/lemlist/ensure-template
 *
 * Idempotent: returns the campaignId of the "Arcova Multichannel" template
 * on the user's lemlist account, creating it (with the canonical 7-step
 * shape + {{subject_N}}/{{body_N}} interpolation tokens) if it doesn't exist.
 *
 * Called from /outreach's "Send to lemlist" modal — gives the customer a
 * "Use Arcova default template" button so they don't have to hand-build
 * a campaign in lemlist's UI before they can dispatch anything.
 *
 * Output: { campaignId, created, name }
 */
import { NextResponse } from 'next/server';
import { ARCOVA_TEMPLATE_NAME, ensureArcovaTemplate, getLemlistKeyForCurrentUser, LemlistError } from '@/lib/lemlist';

export async function POST() {
  const apiKey = await getLemlistKeyForCurrentUser();
  if (!apiKey) {
    return NextResponse.json({ error: 'lemlist not connected' }, { status: 400 });
  }

  try {
    const { campaignId, created } = await ensureArcovaTemplate(apiKey);
    return NextResponse.json({ campaignId, created, name: ARCOVA_TEMPLATE_NAME });
  } catch (err) {
    if (err instanceof LemlistError) {
      return NextResponse.json(
        { error: 'lemlist API error', detail: err.body },
        { status: err.status === 401 ? 401 : 500 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
