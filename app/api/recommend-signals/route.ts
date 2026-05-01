import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { COMPANY_SIGNALS } from '@/lib/signals/catalog';

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        { error: 'Anthropic API key not configured' },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const body = await request.json();
    const { companyType, companySizes, therapeuticAreas, modalities, developmentStages, fundingStages } = body;

    const signalList = COMPANY_SIGNALS.map(
      (signal) => `- ${signal.id}: ${signal.displayName} (${signal.category})`
    ).join('\n');

    const prompt = `You are helping a B2B sales team in the life sciences industry select the most relevant buying signals to track for their ideal customer profile.

Their ICP criteria:
- Company Type: ${companyType || 'Not specified'}
- Company Sizes: ${companySizes?.join(', ') || 'Any'}
- Therapeutic Areas: ${therapeuticAreas?.join(', ') || 'Any'}
- Modalities: ${modalities?.join(', ') || 'Any'}
- Development Stages: ${developmentStages?.join(', ') || 'Any'}
- Funding Stages: ${fundingStages?.join(', ') || 'Any'}

Available signals to choose from:
${signalList}

Based on this ICP, select every signal from the list above that is at least moderately relevant to tracking buying intent for this profile—be inclusive; do not cap the count. Omit only signals that are clearly a poor fit. Order by importance (strongest buying-window indicators first). Consider:
- What events typically precede purchasing decisions for this type of customer?
- What signals indicate growth, expansion, or new initiatives?
- What hiring patterns suggest they're building capabilities your seller might support?

Return ONLY a JSON array of signal IDs (the part before the colon), ordered by relevance—include as many ids as belong in the list, from one up to the full catalogue if appropriate.

Do not include em dashes in your response.
Return ONLY the JSON array, nothing else.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text.trim();
    
    let recommendedIds: string[];
    try {
      recommendedIds = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        recommendedIds = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse signal recommendations');
      }
    }

    if (!Array.isArray(recommendedIds)) {
      throw new Error('Signal recommendations must be a JSON array');
    }

    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const raw of recommendedIds) {
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      uniqueIds.push(id);
    }

    // Map IDs to full signal objects (invalid ids dropped)
    const recommendedSignals = uniqueIds
      .map((id) => COMPANY_SIGNALS.find((signal) => signal.id === id))
      .filter(Boolean);

    return NextResponse.json({ 
      recommended: recommendedSignals,
      all: COMPANY_SIGNALS 
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error recommending signals:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to recommend signals' },
      { status: 500 }
    );
  }
}

// GET endpoint to return all signals (for fallback)
export async function GET() {
  return NextResponse.json({ all: COMPANY_SIGNALS });
}
