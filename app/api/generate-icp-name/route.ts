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
      [mod[0] || ta[0] || cmod[0] || cta[0] || '', companyType || 'Company'].filter(Boolean).join(' ').trim() ||
      'Target Company Profile';

    const contextLines: string[] = [];
    if (exampleCompanyName) contextLines.push(`Example company: ${exampleCompanyName}`);
    if (exampleCompanyDescription) contextLines.push(`What they do: ${Array.isArray(exampleCompanyDescription) ? exampleCompanyDescription[0] : exampleCompanyDescription}`);
    if (companyType) contextLines.push(`Company type: ${companyType}`);
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
      distinguisherHint = 'No therapeutic area or modality was specified for own product or customer segments — use a general name based on company type and funding stage if available.';
    } else if (taSpecificity <= modSpecificity && taCount > 0) {
      distinguisherHint = `Therapeutic area is the most distinctive dimension (${taCount} selected vs ${modCount} modalities). Lead with the therapeutic area.`;
    } else if (modSpecificity < taSpecificity && modCount > 0) {
      distinguisherHint = `Modality is the most distinctive dimension (${modCount} selected vs ${taCount} TAs). Lead with the modality.`;
    } else {
      distinguisherHint = 'Both therapeutic area and modality are broadly selected — use a general descriptor rather than listing specific ones.';
    }

    const stageHint = stageCount === 1
      ? `One development stage selected (${devStages[0]}) — you may include it as a qualifier (e.g. "Phase I CRO", "Preclinical Biotech").`
      : stageCount > 0 && stageCount < STAGE_TOTAL
      ? `A narrow range of development stages selected (${devStages.join(', ')}) — you may include a stage qualifier if it genuinely distinguishes the profile.`
      : 'Development stages are broad or all-encompassing — do not include a stage qualifier in the name.';

    const prompt = `You are naming an ICP (ideal customer profile) category for a life science sales team.

${contextLines.join('\n')}

Distinguishing factor guidance: ${distinguisherHint}
Development stage guidance: ${stageHint}

Write a 3–5 word name that describes the *category* of company this ICP represents — not the specific example company. Pick the single most distinctive attribute and lead with it.

Good examples:
- Oncology CDMO
- ADC Biotech
- Gene Therapy CRO
- Rare Disease Pharma
- Phase I Oncology Biotech
- Preclinical Cell Therapy CRO
- Broad-focus Biopharma
- Multi-modality CDMO

Rules:
- 3–5 words maximum
- No punctuation at the end
- No em dashes
- Never mention company size, employee count, or LinkedIn followers
- Never mention signals
- Only include a development stage qualifier if exactly one stage (or a very narrow range) was selected
- Never use "stages" as a standalone word — if used at all, say "development stage" or "clinical stage"
- If no single attribute stands out, use a general term like "Broad-focus Biopharma" or "Multi-area Pharma"
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
