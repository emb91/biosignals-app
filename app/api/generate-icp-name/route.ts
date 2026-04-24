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
    const {
      companyType,
      companySizes,
      therapeuticAreas,
      modalities,
      developmentStages,
      fundingStages,
      exampleCompanyName,
      exampleCompanyDescription,
    } = body;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const cleanupName = (text: string): string => {
      return text.replace(/[.!?,;:]+$/g, '').replace(/\s+/g, ' ').trim();
    };

    const normaliseList = (values?: string[]) => (values || []).map(v => v.trim()).filter(Boolean);
    const ta = normaliseList(therapeuticAreas);
    const mod = normaliseList(modalities);

    const fallbackName = [mod[0] || ta[0] || '', companyType || 'Company'].filter(Boolean).join(' ').trim() || 'Target Company Profile';

    const contextLines: string[] = [];
    if (exampleCompanyName) contextLines.push(`Example company: ${exampleCompanyName}`);
    if (exampleCompanyDescription) contextLines.push(`What they do: ${Array.isArray(exampleCompanyDescription) ? exampleCompanyDescription[0] : exampleCompanyDescription}`);
    if (companyType) contextLines.push(`Company type: ${companyType}`);
    if (ta.length) contextLines.push(`Therapeutic areas: ${ta.join(', ')}`);
    if (mod.length) contextLines.push(`Modalities: ${mod.join(', ')}`);
    if (developmentStages?.length) contextLines.push(`Development stages: ${normaliseList(developmentStages).join(', ')}`);
    if (companySizes?.length) contextLines.push(`Typical size: ${normaliseList(companySizes).join(', ')}`);
    if (fundingStages?.length) contextLines.push(`Funding: ${normaliseList(fundingStages).join(', ')}`);

    const prompt = `You are naming an ICP (ideal customer profile) category for a life science sales team.

${contextLines.join('\n')}

Write a 3–4 word name that describes the *category* of company this ICP represents — not the specific example company. Think of how a salesperson would say "we sell to ___". The name should be specific enough to be meaningful but broad enough to cover a category.

Good examples:
- Molecular Diagnostics Company
- Oncology CDMO
- Early-stage ADC Biotech
- Rare Disease Gene Therapy Company
- Large Commercial Pharma
- Clinical-stage CRO

Rules:
- 3–4 words maximum
- No punctuation at the end
- No em dashes
- Return only the name, nothing else`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      temperature: 0.4,
      system: 'Output only the ICP category name. Nothing else.',
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
