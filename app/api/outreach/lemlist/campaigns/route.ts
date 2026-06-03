import { NextResponse } from 'next/server';
import { getLemlistKeyForCurrentUser, listCampaigns, LemlistError } from '@/lib/lemlist';

export async function GET() {
  const apiKey = await getLemlistKeyForCurrentUser();
  if (!apiKey) return NextResponse.json({ error: 'lemlist not connected' }, { status: 400 });

  try {
    const campaigns = await listCampaigns(apiKey);
    return NextResponse.json({ campaigns });
  } catch (err) {
    if (err instanceof LemlistError) {
      return NextResponse.json({ error: 'lemlist API error', detail: err.body }, { status: err.status });
    }
    throw err;
  }
}
