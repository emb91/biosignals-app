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

    const body = await request.json();
    const { companyType, companySizes, therapeuticAreas, modalities, developmentStages, fundingStages } = body;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const cleanupName = (text: string): string => {
      const noTrailingPunctuation = text.replace(/[.!?,;:]+$/g, '');
      const normalised = noTrailingPunctuation.replace(/\s+/g, ' ').trim();
      const words = normalised.split(' ').slice(0, 6);
      let output = words.join(' ');

      const parts = output.split('&');
      if (parts.length > 2) {
        output = `${parts[0]}&${parts.slice(1).join(' and ')}`.replace(/\s+/g, ' ').trim();
      }

      return output;
    };

    const fallbackParts: string[] = [];
    if (fundingStages?.length) fallbackParts.push(fundingStages[0]);
    if (therapeuticAreas?.length) fallbackParts.push(therapeuticAreas[0]);
    if (companyType) fallbackParts.push(companyType);
    const fallbackName = cleanupName(fallbackParts.join(' ') || 'Target Company Profile');

    const prompt = `Generate a short name for a target company profile with these attributes:

Company type: ${companyType || 'Not specified'}
Therapeutic areas: ${therapeuticAreas?.join(', ') || 'Any'}
Modalities: ${modalities?.join(', ') || 'Any'}
Development stages: ${developmentStages?.join(', ') || 'Any'}
Company sizes: ${companySizes?.join(', ') || 'Any'}
Funding stages: ${fundingStages?.join(', ') || 'Any'}

Rules:
- Maximum 6 words
- Identify the most distinctive characteristic of this profile. Lead with what makes it specific: the funding stage, therapeutic focus, modality, or size, whichever is most defining.
- Include the company type (e.g. Biotech, Pharma, CRO, MedTech) but keep it to one word where possible
- If there is a clear therapeutic focus (one or two areas), include it. If many are selected, omit it and focus on other differentiators like stage or size.
- If there is a clear modality focus, include it. If many are selected, omit it.
- Do not list multiple attributes from the same category. Pick the most representative one.
- Do not use generic filler words like "companies", "organisations", "firms", or "partners"
- Do not use ampersands more than once in the name
- Do not include punctuation at the end
- Do not include em dashes
- Return only the name, nothing else

Examples of good names:
- Series A Oncology Biotech
- Large Commercial Pharma
- Preclinical Gene Therapy Biotech
- Mid-size Rare Disease Biopharma
- Grant-Funded Academic Spinouts
- Late-stage ADC Developers`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      temperature: 0.9,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawName = (message.content[0] as { type: string; text: string }).text.trim();
    const name = cleanupName(rawName) || fallbackName;

    return NextResponse.json({ name });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating ICP name:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to generate name' },
      { status: 500 }
    );
  }
}
