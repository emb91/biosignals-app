import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const ALL_PERSONA_SIGNALS = [
  // Career & Role Changes
  { id: 'new_internal_role', name: 'New internal role', category: 'Career & Role Changes' },
  { id: 'promoted', name: 'Promoted', category: 'Career & Role Changes' },
  { id: 'recently_hired', name: 'Recently hired', category: 'Career & Role Changes' },
  { id: 'title_change', name: 'Title change', category: 'Career & Role Changes' },
  { id: 'board_or_advisory_role', name: 'Board or advisory role', category: 'Career & Role Changes' },

  // Publications & Recognition
  { id: 'new_paper_published', name: 'New paper published', category: 'Publications & Recognition' },
  { id: 'conference_speaker', name: 'Conference speaker', category: 'Publications & Recognition' },
  { id: 'principal_investigator_new_trial', name: 'Principal investigator on new trial', category: 'Publications & Recognition' },
  { id: 'award_or_recognition', name: 'Award or recognition', category: 'Publications & Recognition' },
  { id: 'patent_filed_or_granted', name: 'Patent filed or granted', category: 'Publications & Recognition' },

  // Team & Hiring
  { id: 'team_actively_hiring', name: 'Team actively hiring', category: 'Team & Hiring' },
];

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

    const signalList = ALL_PERSONA_SIGNALS.map(
      (s) => `- ${s.id}: ${s.name} (${s.category})`
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

Return ONLY a JSON array of signal IDs (the part before the colon), ordered by relevance. Example: ["recently_hired", "conference_speaker", "team_actively_hiring"]

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
      .map((id) => ALL_PERSONA_SIGNALS.find((s) => s.id === id))
      .filter(Boolean);

    return NextResponse.json({
      recommended: recommendedSignals,
      all: ALL_PERSONA_SIGNALS,
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
  return NextResponse.json({ all: ALL_PERSONA_SIGNALS });
}
