import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

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
      platformCategory,
      companySizes,
      therapeuticAreas,
      modalities,
      developmentStages,
      customerTherapeuticAreas,
      customerModalities,
      customerDevelopmentStages,
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
    const cta = normaliseList(customerTherapeuticAreas);
    const cmod = normaliseList(customerModalities);

    const fallbackName =
      [platformCategory || mod[0] || ta[0] || cmod[0] || cta[0] || '', companyType || 'Company'].filter(Boolean).join(' ').trim() ||
      'Target Company Profile';

    const contextLines: string[] = [];
    if (exampleCompanyName) contextLines.push(`Example company: ${exampleCompanyName}`);
    if (exampleCompanyDescription) contextLines.push(`What they do: ${Array.isArray(exampleCompanyDescription) ? exampleCompanyDescription[0] : exampleCompanyDescription}`);
    if (companyType) contextLines.push(`Company type: ${companyType}`);
    if (platformCategory) contextLines.push(`Platform category (their own): ${platformCategory}`);
    if (ta.length) contextLines.push(`Therapeutic areas (their own): ${ta.join(', ')}`);
    if (mod.length) contextLines.push(`Modalities (their own): ${mod.join(', ')}`);
    if (cta.length) contextLines.push(`Customer-served therapeutic areas (beachhead): ${cta.join(', ')}`);
    if (cmod.length) contextLines.push(`Customer-served modalities / workflows: ${cmod.join(', ')}`);
    if (developmentStages?.length) contextLines.push(`Development stages: ${normaliseList(developmentStages).join(', ')}`);
    if (companySizes?.length) contextLines.push(`Typical size: ${normaliseList(companySizes).join(', ')}`);
    if (fundingStages?.length) contextLines.push(`Funding: ${normaliseList(fundingStages).join(', ')}`);

    const devStages = normaliseList(developmentStages);
    const taCount = ta.length;
    const modCount = mod.length;
    const stageCount = devStages.length;
    // Total options in each dimension (approximate universe size)
    const TA_TOTAL = 20;
    const MOD_TOTAL = 12;
    const STAGE_TOTAL = 5; // Preclinical, Phase I, II, III, Commercial

    // Specificity score: lower = more selective = better distinguisher
    const taSpecificity   = taCount   / TA_TOTAL;
    const modSpecificity  = modCount  / MOD_TOTAL;
    const stageSpecificity = stageCount / STAGE_TOTAL;

    let distinguisherHint: string;
    if (taCount === 0 && modCount === 0 && cta.length === 0 && cmod.length === 0) {
      distinguisherHint = 'No therapeutic area or modality was specified for own product or customer segments — use a general name based on company type and what they do.';
    } else if (taSpecificity <= modSpecificity && taCount > 0) {
      distinguisherHint = `Therapeutic area is the most distinctive dimension (${taCount} selected vs ${modCount} modalities). Weave it in as a natural modifier (e.g. "Oncology …" / "Rare Disease …"); do not scramble word order just to put it first.`;
    } else if (modSpecificity < taSpecificity && modCount > 0) {
      distinguisherHint = `Modality is the most distinctive dimension (${modCount} selected vs ${taCount} TAs). Weave modality in naturally (e.g. "Cell Therapy …" / "ADC …"); keep standard English noun-phrase order.`;
    } else {
      distinguisherHint = 'Therapeutic area and modality are both broad — prefer a concise segment label (e.g. "Multi-modality CDMO") rather than listing many specifics.';
    }

    const stageHint = stageCount === 1
      ? `One development stage selected (${devStages[0]}) — you may include it as a qualifier (e.g. "Phase I CRO", "Preclinical Biotech").`
      : stageCount > 0 && stageCount < STAGE_TOTAL
      ? `A narrow range of development stages selected (${devStages.join(', ')}) — you may include a stage qualifier if it genuinely distinguishes the profile.`
      : 'Development stages are broad or all-encompassing — do not include a stage qualifier in the name.';

    const prompt = `You are writing a short category title for an ICP (ideal customer profile) used by a life science sales team.

${contextLines.join('\n')}

Emphasis hints (natural phrasing beats rigid order): ${distinguisherHint}
Development stage guidance: ${stageHint}

Goal: Output reads like a real market segment or product category — Title Case, **standard business noun phrase**, not a shuffled bag of keywords. Describe the *category* of company this ICP represents, never the specific example company by name.

If the profile is clearly a **software / SaaS / data / analytics / commercial intelligence / platform** business, end with an appropriate head noun such as Platform, Software, Solution, Intelligence Platform, or Analytics — e.g. "Life Science Commercial Intelligence Platform", not "Commercial Intelligence Life Science".

If the profile is a **service org or drug developer**, use endings like Biotech, Pharma, CDMO, CRO, Diagnostics, Medical Device Manufacturer as appropriate.

Good examples (mix of shapes):
- Life Science Commercial Intelligence Platform
- Digital Health Data Analytics Platform
- Oncology CDMO
- Gene Therapy Discovery Biotech
- Rare Disease Pharma
- Phase I Oncology Clinical Biotech
- Preclinical Cell Therapy CRO
- Multi-modality Manufacturing CDMO

Avoid:
- Jumbled descriptor stacks ("Commercial Intelligence Life Science")

Rules:
- 3–10 words; prefer 4–7 when the offering needs a clear head noun (Platform, Software, etc.)
- Title Case throughout
- No punctuation at the end
- No em dashes
- Never mention company size, employee count, or LinkedIn followers
- Never mention signals
- Only include a development stage qualifier when the stage guidance allows it
- Never use "stages" as a standalone word — if used at all, say "development stage" or "clinical stage"
- If nothing narrow stands out, use a broad but grammatical label (e.g. "Broad Portfolio Biopharma")
- Return only the title, nothing else`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      temperature: 0.4,
      system:
        'Output only the ICP category title: a natural Title Case noun phrase. No quotes, labels, or explanation.',
      messages: [{ role: 'user', content: prompt }],
    });

    await recordLlmUsageEvent({
      provider: 'anthropic',
      feature: 'generate_icp_name',
      route: 'app/api/generate-icp-name',
      model: 'claude-haiku-4-5',
      usage: message.usage,
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
