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
    const fallbackName = cleanupName(`${selectedFunctions[0] || 'Commercial'} ${topSeniority} at ${shortCompanyType}`);

    const prompt = `Generate a short, specific name for a buyer persona based on the following attributes:
Business areas: ${selectedFunctions.join(', ')}
Seniority levels: ${selectedSeniority.join(', ')}
Company profile: ${companyProfileName}
Company type summary: ${shortCompanyType}

Rules:
- Maximum 6 words
- If 1-2 business areas selected, usually lead with the most descriptive area
- If 3 or more business areas selected, summarise broadly using terms like "Commercial & Scientific", "Multi-function", or "Cross-functional" rather than listing each area
- Pick the most senior seniority level selected (${topSeniority}), do not list all seniority levels
- Include the company type from the company profile but keep it short (for example: "Large Pharma", "Series A Biotech", "Grant-Funded Biopharma")
- Do not use generic filler words like "leaders", "professionals", "contacts", "people", or "individuals" unless nothing more specific is available
- Do not use ampersands more than once in the name
- Do not include punctuation at the end
- Do not include em dashes
- Keep the meaning consistent, but vary phrasing naturally across repeated generations for the same inputs

Use varied structures such as:
- [Function] [Seniority] at [Company Type]
- [Seniority] in [Function] at [Company Type]
- [Function]-focused [Seniority] at [Company Type]

Examples of good names:
- Clinical & BD Directors at Series A Biotech
- C-Suite Buyers at Large Pharma
- CMC & Regulatory VPs at Mid-size Biopharma
- BD & Commercial Heads at Grant-Funded Biotech
- Multi-function VPs at Late-stage Biopharma
- Cross-functional Directors at Large Pharma
- Lab & Research Scientists at Early-stage Biotech
- Commercial & Medical Affairs at Oncology Pharma

Return only the name, nothing else.`;

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
