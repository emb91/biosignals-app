import { NextResponse } from 'next/server';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENROUTER_API_KEY) {
      console.error('No LLM provider API key is set');
      return NextResponse.json(
        { error: 'LLM provider API key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const {
      companyType,
      platformCategory,
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
    if (platformCategory) contextLines.push(`Platform category: ${platformCategory}`);
    if (ownTherapeuticAreas.length) contextLines.push(`Own therapeutic areas: ${ownTherapeuticAreas.join(', ')}`);
    if (ownModalities.length) contextLines.push(`Own modalities: ${ownModalities.join(', ')}`);
    if (ownStages.length) contextLines.push(`Own development stages: ${ownStages.join(', ')}`);
    if (customerTas.length) contextLines.push(`Customer therapeutic areas: ${customerTas.join(', ')}`);
    if (customerMods.length) contextLines.push(`Customer modalities/workflows: ${customerMods.join(', ')}`);
    if (customerStages.length) contextLines.push(`Customer development stages: ${customerStages.join(', ')}`);
    if (sizes.length) contextLines.push(`Typical company sizes: ${sizes.join(', ')}`);
    if (funding.length) contextLines.push(`Funding stages: ${funding.join(', ')}`);

    const prompt = `You are writing a concise summary for an ICP (ideal customer profile) card in a B2B life sciences sales product.

${contextLines.join('\n')}

Write exactly 1 sentence that describes the ICP archetype, not the specific reference company.

**CRITICAL — use the right verb for the company type.** Therapeutic areas and modalities describe the field the company plays in (e.g. "oncology", "cell therapy"). The Company type determines what they DO in that field — pick the verb to match:
- Biotech / Pharma / Biopharma → "developing therapeutics across [areas]"
- Tools & Instruments / Diagnostics → "providing [reagents/instruments/diagnostics] for [areas] research / care"
- CRO → "delivering research services for [areas]"
- CDMO → "manufacturing [modalities] for [areas]"
- SaaS / platform / data / analytics → "powering [areas] workflows" / "providing [X] software for [areas]"

Never say a tools, services, or platform company "develops therapeutics" — they support the companies that do.

Rules:
- Start exactly with "This ICP defines"
- Do not ever mention the reference company
- Do not ever mention the reference company name, website, domain, product names, or branded terms
- Do not say "example company" or "reference company"
- Do not restate or summarize the reference company's specific product or tagline — derive the archetype from company type, modalities, therapeutic focus, customer segments, and size
- Avoid promotional phrasing like "powered by", "leading", "innovative", or similar positioning language
- Focus on plainly defining what kind of company this ICP represents
- If useful, include modality, therapeutic area, or commercial context
- Keep it under 28 words
- If you are about to mention the underlying company in any way, rewrite the sentence to stay generic
- Output only the sentence`;

    const completion = await completeLlm({
      feature: 'generate_icp_summary',
      prompt,
      system: 'Output only the requested sentence. Never mention the underlying company. Start exactly with "This ICP defines". Avoid promotional phrasing like "powered by".',
      maxTokens: 80,
      temperature: 0.3,
    });

    await recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'generate_icp_summary',
      route: 'app/api/generate-icp-summary',
      model: completion.model,
      usage: completion.usage,
    });

    const rawSummary = completion.text.trim();
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
