import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

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

    const prompt = `Generate a short, memorable name for an Ideal Customer Profile (ICP) based on these criteria:

- Company Type: ${companyType || 'Not specified'}
- Company Sizes: ${companySizes?.join(', ') || 'Any'}
- Therapeutic Areas: ${therapeuticAreas?.join(', ') || 'Any'}
- Modalities: ${modalities?.join(', ') || 'Any'}
- Development Stages: ${developmentStages?.join(', ') || 'Any'}
- Funding Stages: ${fundingStages?.join(', ') || 'Any'}

Generate a concise, descriptive name (3-6 words) that captures the essence of this target customer segment. Examples of good names:
- "Early Stage Oncology Biotech"
- "Series A Gene Therapy Startups"
- "Mid-Size Pharma R&D"
- "Preclinical ADC Companies"

Do not include em dashes in your response.
Return ONLY the name, nothing else. No quotes, no explanation.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    const generatedName = (message.content[0] as { type: string; text: string }).text.trim();

    return NextResponse.json({ name: generatedName });
  } catch (error: any) {
    console.error('Error generating ICP name:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate name' },
      { status: 500 }
    );
  }
}
