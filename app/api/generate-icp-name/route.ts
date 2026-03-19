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
      const words = normalised.split(' ').slice(0, 5);
      let output = words.join(' ');

      const parts = output.split('&');
      if (parts.length > 2) {
        output = `${parts[0]}&${parts.slice(1).join(' and ')}`.replace(/\s+/g, ' ').trim();
      }

      return output;
    };

    const normaliseList = (values?: string[]) => (values || []).map(v => v.trim()).filter(Boolean);
    const ta = normaliseList(therapeuticAreas);
    const mod = normaliseList(modalities);
    const stage = normaliseList(developmentStages);
    const funding = normaliseList(fundingStages);
    const size = normaliseList(companySizes);
    const normalisedCompanyType = (companyType || 'Company').trim();

    const singleCategoryOrder = ['therapeutic', 'modality', 'stage', 'funding'] as const;
    const categoryMap: Record<(typeof singleCategoryOrder)[number], string[]> = {
      therapeutic: ta,
      modality: mod,
      stage,
      funding,
    };

    // Rule 1: if any category has exactly one selected value, use that single as the descriptor.
    // Rule 2: if none have exactly one value, fall back to modality first.
    const selectedSingleKey = singleCategoryOrder.find(key => categoryMap[key].length === 1);
    const selectedDescriptor =
      (selectedSingleKey ? categoryMap[selectedSingleKey][0] : '') ||
      mod[0] ||
      ta[0] ||
      stage[0] ||
      funding[0] ||
      '';

    const fallbackName = cleanupName(
      `${selectedDescriptor ? `${selectedDescriptor} ` : ''}${normalisedCompanyType}`.trim()
    ) || 'Target Company Profile';

    const prompt = `Generate a short name for a target company profile with these attributes:

Company type: ${companyType || 'Not specified'}
Therapeutic areas: ${therapeuticAreas?.join(', ') || 'Any'}
Modalities: ${modalities?.join(', ') || 'Any'}
Development stages: ${developmentStages?.join(', ') || 'Any'}
Company sizes: ${companySizes?.join(', ') || 'Any'}
Funding stages: ${fundingStages?.join(', ') || 'Any'}

Rules:
- Maximum 5 words
- Use exactly one descriptor plus the company type
- Use this exact descriptor: ${selectedDescriptor || 'None'}
- Use this exact company type: ${normalisedCompanyType}
- If descriptor is provided, output format must be: "<descriptor> <company type>"
- If descriptor is not provided, output format must be: "<company type>"
- Do not include multiple descriptors
- Never include company size or employee-count ranges in the name
- Keep naming broad, avoid granular stacks of qualifiers
- You may use "company" only when needed for natural phrasing (e.g. "Cardiovascular Pharma Company")
- Do not use ampersands more than once in the name
- Do not include punctuation at the end
- Do not include em dashes
- Return only the name, nothing else

Examples of good names:
- Cardiovascular Pharma Company
- Oncology CDMO
- Early-stage Biotech
- ADC Biotech
- Rare Disease CRO
- Series A Biopharma`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      temperature: 0.7,
      system: 'You are a naming tool. Output only the name, nothing else. No explanation.',
      messages: [{ role: 'user', content: prompt }],
    });

    const rawName = (message.content[0] as { type: string; text: string }).text.trim();
    let name = cleanupName(rawName) || fallbackName;

    // Enforce company type inclusion.
    if (!name.toLowerCase().includes(normalisedCompanyType.toLowerCase())) {
      name = fallbackName;
    }

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
