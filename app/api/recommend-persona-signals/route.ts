import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import {
  CONTACT_SIGNALS,
  getDefaultContactSignalSelectionIds,
  isContactSignalComingSoon,
} from '@/lib/signals/catalog';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const SELECTABLE_CONTACT_SIGNALS = CONTACT_SIGNALS.filter((s) => !isContactSignalComingSoon(s.id));
const SELECTABLE_CONTACT_ID_SET = new Set(SELECTABLE_CONTACT_SIGNALS.map((s) => s.id));

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

    const signalList = SELECTABLE_CONTACT_SIGNALS.map(
      (signal) => `- ${signal.id}: ${signal.displayName} (${signal.category})`,
    ).join('\n');

    const prompt = `You are helping a B2B sales team select the most relevant persona-level buying signals.

Persona profile:
- Persona name: ${name || 'Not specified'}
- Functions: ${functions?.join(', ') || 'Any'}
- Seniority levels: ${seniorityLevels?.join(', ') || 'Any'}
- Job titles: ${jobTitles?.join(', ') || 'Any'}

Available signals to choose from:
${signalList}

Based on this persona profile, select every signal from the list above that is at least moderately relevant to tracking buying intent—be inclusive; do not cap the count. Omit only signals that are clearly a poor fit. Order by importance (strongest indicators first).

Return ONLY a JSON array of signal IDs (the part before the colon), ordered by relevance—include as many ids as belong, from one up to the full catalogue if appropriate.

Do not include em dashes in your response.
Return ONLY the JSON array, nothing else.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    await recordLlmUsageEvent({
      provider: 'anthropic',
      feature: 'recommend_persona_signals',
      route: 'app/api/recommend-persona-signals',
      model: 'claude-sonnet-4-6',
      usage: message.usage,
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

    if (!Array.isArray(recommendedIds)) {
      throw new Error('Persona signal recommendations must be a JSON array');
    }

    const uniqueIds: string[] = [];
    const seen = new Set<string>();
    for (const raw of recommendedIds) {
      const id = typeof raw === 'string' ? raw.trim() : '';
      if (!id || seen.has(id)) continue;
      if (!SELECTABLE_CONTACT_ID_SET.has(id)) continue;
      seen.add(id);
      uniqueIds.push(id);
    }

    const defaults = getDefaultContactSignalSelectionIds();
    const merged: string[] = [];
    const ordered = new Set<string>();
    for (const id of uniqueIds) {
      if (ordered.has(id)) continue;
      ordered.add(id);
      merged.push(id);
    }
    for (const id of defaults) {
      if (ordered.has(id)) continue;
      ordered.add(id);
      merged.push(id);
    }

    const recommendedSignals = merged
      .slice(0, 5)
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
