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
      therapeuticAreas,
      modalities,
      developmentStages,
      customerTherapeuticAreas,
      customerModalities,
      customerDevelopmentStages,
      companySizes,
      fundingStages,
      exampleCompanyName,
      exampleCompanyDescription,
    } = body;

    const normalizeList = (values?: string[]) => (values || []).map((value) => value.trim()).filter(Boolean);
    const ownTherapeuticAreas = normalizeList(therapeuticAreas);
    const ownModalities = normalizeList(modalities);
    const ownStages = normalizeList(developmentStages);
    const customerTas = normalizeList(customerTherapeuticAreas);
    const customerMods = normalizeList(customerModalities);
    const customerStages = normalizeList(customerDevelopmentStages);
    const sizes = normalizeList(companySizes);
    const funding = normalizeList(fundingStages);

    const contextLines: string[] = [];
    if (exampleCompanyName) contextLines.push(`Reference company: ${exampleCompanyName}`);
    if (exampleCompanyDescription) {
      contextLines.push(
        `Reference company summary: ${Array.isArray(exampleCompanyDescription) ? exampleCompanyDescription[0] : exampleCompanyDescription}`
      );
    }
    if (companyType) contextLines.push(`Company type: ${companyType}`);
    if (ownTherapeuticAreas.length) contextLines.push(`Own therapeutic areas: ${ownTherapeuticAreas.join(', ')}`);
    if (ownModalities.length) contextLines.push(`Own modalities: ${ownModalities.join(', ')}`);
    if (ownStages.length) contextLines.push(`Own development stages: ${ownStages.join(', ')}`);
    if (customerTas.length) contextLines.push(`Customer therapeutic areas: ${customerTas.join(', ')}`);
    if (customerMods.length) contextLines.push(`Customer modalities/workflows: ${customerMods.join(', ')}`);
    if (customerStages.length) contextLines.push(`Customer development stages: ${customerStages.join(', ')}`);
    if (sizes.length) contextLines.push(`Typical company sizes: ${sizes.join(', ')}`);
    if (funding.length) contextLines.push(`Funding stages: ${funding.join(', ')}`);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are writing a concise summary for an ICP (ideal customer profile) card in a B2B life sciences sales product.

${contextLines.join('\n')}

Write exactly 1 sentence that describes the ICP archetype, not the specific reference company.

Rules:
- Start with "This ICP is for"
- Do not use the reference company name
- Do not say "example company" or "reference company"
- Make it sound polished and commercially clear
- Focus on what kind of company this profile represents and what it does
- If useful, include modality, therapeutic area, or commercial context
- Keep it under 28 words
- Output only the sentence`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 80,
      temperature: 0.3,
      system: 'Output only the requested sentence.',
      messages: [{ role: 'user', content: prompt }],
    });

    const rawSummary = (message.content[0] as { type: string; text: string }).text.trim();
    const summary = rawSummary.replace(/\s+/g, ' ').trim();

    return NextResponse.json({ summary });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating ICP summary:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to generate ICP summary' },
      { status: 500 }
    );
  }
}
