import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetCompanyProfile, selectedFunctions, selectedSeniority } = body;

    if (!selectedFunctions?.length || !selectedSeniority?.length) {
      return NextResponse.json(
        { error: 'Business areas and seniority are required' },
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

    const companyType = targetCompanyProfile?.company_type || 'Biotech';
    const companyProfileName = targetCompanyProfile?.name || companyType;
    const therapeuticArea = targetCompanyProfile?.therapeutic_areas?.[0] || '';
    const fundingStage = targetCompanyProfile?.funding_stages?.[0] || '';

    const seniorityRank: Record<string, number> = {
      'C-Level': 6,
      'VP / SVP': 5,
      'Director': 4,
      'Head of / Senior Manager': 3,
      'Manager': 2,
      'Individual Contributor': 1,
    };

    const topSeniority = [...selectedSeniority].sort(
      (a, b) => (seniorityRank[b] || 0) - (seniorityRank[a] || 0)
    )[0] || 'VP / SVP';

    const simplifyCompanyType = (type: string, area: string, stage: string): string => {
      let base = type;
      if (type.includes('Biotech') || type.includes('Biopharma')) base = 'Biopharma';
      else if (type.includes('Pharma')) base = 'Pharma';
      else if (type.includes('Medical Device')) base = 'MedTech';
      else if (type.includes('Academic')) base = 'Academic Biotech';
      else if (type.includes('CDMO')) base = 'CDMO';
      else if (type.includes('CRO')) base = 'CRO';

      const shortStage = stage
        ? stage
            .replace('Grant-funded', 'Grant-Funded')
            .replace('Series ', 'Series ')
            .trim()
        : '';

      if (shortStage && base) return `${shortStage} ${base}`;
      if (area && base && !base.includes('Pharma') && !base.includes('Biotech') && !base.includes('Biopharma')) {
        return `${area} ${base}`;
      }
      return base;
    };

    const cleanupName = (text: string): string => {
      const noTrailingPunctuation = text.replace(/[.!?,;:]+$/g, '');
      const normalised = noTrailingPunctuation.replace(/\s+/g, ' ').trim();
      const words = normalised.split(' ').slice(0, 6);
      let output = words.join(' ');

      // Enforce max one ampersand.
      const parts = output.split('&');
      if (parts.length > 2) {
        output = `${parts[0]}&${parts.slice(1).join(' and ')}`.replace(/\s+/g, ' ').trim();
      }

      return output;
    };

    const shortCompanyType = simplifyCompanyType(companyType, therapeuticArea, fundingStage);
    const fallbackName = cleanupName(`${selectedFunctions[0] || 'Commercial'} at ${shortCompanyType}`);

    const prompt = `Generate a short name for a buyer segment with these attributes:

Business areas: ${selectedFunctions.join(', ')}
Seniority levels: ${selectedSeniority.join(', ')}
Company profile name: ${companyProfileName}

Rules:
- Maximum 6 words
- Identify the dominant theme across the business areas. For example, if most areas are commercial-facing (Sales, BD, Marketing, Strategy) use "Commercial" as the descriptor. If most are scientific (R&D, Clinical, Regulatory) use "Scientific". If mixed, use "Cross-functional".
- Do not lead with a seniority level. Lead with the role theme.
- End with a short version of the company profile name, keep it to 3 words maximum. Do not add the word "company" at the end.
- Do not use the word "cross-functional" unless the business areas are genuinely evenly split across commercial and scientific functions
- Do not use generic filler words like "leaders", "professionals", "contacts", "people", or "individuals"
- Do not use ampersands more than once in the name
- Do not include punctuation at the end
- Do not include em dashes
- Return only the name, nothing else

Examples of good names:
- Commercial Leaders at Large Pharma
- Scientific VPs at Series A Biotech
- BD & Clinical Directors at Mid-size Biopharma
- Commercial & BD at Grant-Funded Biotech
- R&D Leadership at Early-stage Oncology`;

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
    console.error('Error generating contact name:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to generate name' },
      { status: 500 }
    );
  }
}
