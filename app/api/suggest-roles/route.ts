import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyType, functions, seniority } = body;

    if (!functions?.length || !seniority?.length) {
      return NextResponse.json(
        { error: 'Functions and seniority are required' },
        { status: 400 }
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = `A life science company sells to ${companyType || 'biotech and pharmaceutical'} companies. Their ideal contact is someone in ${functions.join(', ')} at ${seniority.join(', ')} level. List the 5 most common specific job titles that match this profile. Return as a JSON array of strings, no preamble, no markdown. Do not include em dashes in your response.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text.trim();
    
    let titles: string[];
    try {
      titles = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        titles = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse titles');
      }
    }

    return NextResponse.json({ titles });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error suggesting roles:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to suggest roles' },
      { status: 500 }
    );
  }
}
