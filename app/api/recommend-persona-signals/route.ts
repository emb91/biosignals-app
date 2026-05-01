import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { CONTACT_SIGNALS } from '@/lib/signals/catalog';

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
    const { name, functions, seniorityLevels, jobTitles } = body;

    const signalList = CONTACT_SIGNALS.map(
      (signal) => `- ${signal.id}: ${signal.displayName} (${signal.category})`
    ).join('\n');

    const prompt = `You are helping a B2B sales team select the most relevant persona-level buying signals.

Persona profile:
- Persona name: ${name || 'Not specified'}
- Functions: ${functions?.join(', ') || 'Any'}
- Seniority levels: ${seniorityLevels?.join(', ') || 'Any'}
- Job titles: ${jobTitles?.join(', ') || 'Any'}

Available signals to choose from:
${signalList}

Based on this persona profile, select EXACTLY 5 most relevant signals that suggest this person is in a buying window. Order them by importance (most important first).

Return ONLY a JSON array of signal IDs (the part before the colon), ordered by relevance. Example: ["new_to_role", "recently_promoted", "active_on_linkedin"]

Do not include em dashes in your response.
Return ONLY the JSON array, nothing else.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
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
        throw new Error('Could not parse persona signal recommendations');
      }
    }

    const recommendedSignals = recommendedIds
      .map((id) => CONTACT_SIGNALS.find((signal) => signal.id === id))
      .filter(Boolean);

    return NextResponse.json({
      recommended: recommendedSignals,
      all: CONTACT_SIGNALS,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error recommending persona signals:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to recommend persona signals' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ all: CONTACT_SIGNALS });
}
