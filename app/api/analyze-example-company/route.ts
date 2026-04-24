import { NextResponse } from 'next/server';
import { enrichTargetCompany } from '@/lib/target-company-enrichment';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body as { url?: string };

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const result = await enrichTargetCompany(url);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[analyze-example-company] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
