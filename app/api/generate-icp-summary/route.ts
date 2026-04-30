import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'Anthropic API key not configured' }, { status: 500 });
    }

    const {
      companyType,
      therapeuticAreas,
      modalities,
      developmentStages,
      customerTherapeuticAreas,
      customerModalities,
      customerDevelopmentStages,
      fundingStages,
      companySizes,
      exampleCompanyName,
      exampleCompanyDescription,
    } = await request.json();

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const lines: string[] = [];
    if (companyType) lines.push(`Company type: ${companyType}`);
    if (therapeuticAreas?.length) lines.push(`Own therapeutic areas (their science): ${therapeuticAreas.join(', ')}`);
    if (modalities?.length) lines.push(`Own modalities (their product type): ${modalities.join(', ')}`);
    if (developmentStages?.length) lines.push(`Own development stages: ${developmentStages.join(', ')}`);
    if (customerTherapeuticAreas?.length)
      lines.push(`Customer segments — therapeutic areas (who they sell to): ${customerTherapeuticAreas.join(', ')}`);
    if (customerModalities?.length)
      lines.push(`Customer segments — modalities/workflows: ${customerModalities.join(', ')}`);
    if (customerDevelopmentStages?.length)
      lines.push(`Customer segments — buyer development stages: ${customerDevelopmentStages.join(', ')}`);
    if (fundingStages?.length) lines.push(`Funding stages: ${fundingStages.join(', ')}`);
    if (companySizes?.length) lines.push(`Company sizes: ${companySizes.join(', ')}`);
    if (exampleCompanyName) lines.push(`Example company: ${exampleCompanyName}`);
    if (exampleCompanyDescription) {
      const desc = Array.isArray(exampleCompanyDescription)
        ? exampleCompanyDescription[0]
        : exampleCompanyDescription;
      if (desc) lines.push(`Example company description: ${desc}`);
    }

    const prompt = `You are writing a one-sentence summary for an ICP (ideal customer profile) card in a B2B sales tool.

ICP attributes:
${lines.join('\n')}

Write a single plain sentence (no bullet points, no markdown) that describes the type of company this ICP targets. Separate "what the company develops" vs "customers they sell into" only when customer-segment lines are present.

Rules:
- Describe the company type, not the ICP itself — never say "ICP" or "targeting"
- Lead with the company type (e.g. "Diagnostics companies", "Biotech companies")
- Mention what they develop or do (infer from company type and example description if available)
- Mention own therapeutic areas and modalities when present; when customer-segment lines are present, phrase them clearly as markets or buyer types served (do not imply the seller is clinically active in those areas unless own lines say so).
- Do not mention company size, employee count, LinkedIn followers, funding stages, or signals
- One sentence only, ending with a full stop
- Plain text, no markdown`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      temperature: 0.3,
      system: 'Output only the summary sentence. Nothing else.',
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = (message.content[0] as { type: string; text: string }).text.trim();
    return NextResponse.json({ summary });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating ICP summary:', errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
