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

    // Build a concise description of the target company
    const companyType = targetCompanyProfile?.company_type || 'Biotech';
    const fundingStage = targetCompanyProfile?.funding_stages?.slice(0, 1).join(', ') || '';
    const therapeuticArea = targetCompanyProfile?.therapeutic_areas?.slice(0, 1).join(', ') || '';
    const companySize = targetCompanyProfile?.company_sizes?.slice(0, 1).join(', ') || '';

    // Simplify seniority for the name
    const simplifySeniority = (levels: string[]): string => {
      if (levels.includes('C-Level')) return 'C-level';
      if (levels.includes('VP / SVP')) return 'VP/SVP-level';
      if (levels.includes('Director')) return 'Director-level';
      if (levels.includes('Head of / Senior Manager')) return 'Senior';
      if (levels.includes('Manager')) return 'Manager-level';
      if (levels.includes('Individual Contributor')) return 'IC-level';
      return levels[0]?.replace(' Level', '-level') || '';
    };

    // Simplify business areas for the name
    const simplifyFunctions = (funcs: string[]): string => {
      const shortNames: Record<string, string> = {
        'Executive / Leadership': 'Leadership',
        'Commercial & Sales': 'Commercial',
        'Business Development & Partnerships': 'BD',
        'Marketing': 'Marketing',
        'Clinical Operations': 'Clinical',
        'Regulatory Affairs': 'Regulatory',
        'Research & Development (R&D)': 'R&D',
        'Manufacturing & CMC': 'CMC',
        'Supply Chain & Procurement': 'Supply Chain',
        'Finance': 'Finance',
        'Strategy & Corporate Development': 'Strategy',
        'Data & Technology': 'Data & Tech',
        'People & HR': 'People',
        'Legal & Compliance': 'Legal',
        'Medical Affairs': 'Medical Affairs',
      };
      return funcs.slice(0, 2).map(f => shortNames[f] || f).join(' & ');
    };

    const seniorityPart = simplifySeniority(selectedSeniority);
    const functionsPart = simplifyFunctions(selectedFunctions);
    
    // Build a suggested name
    let companyPart = companyType;
    if (fundingStage) companyPart = `${fundingStage} ${companyPart}`;
    if (therapeuticArea) companyPart = `${therapeuticArea} ${companyPart}`;

    const prompt = `Generate a concise, descriptive name for a contact profile.

Target company type: ${companyPart}
${companySize ? `Company size: ${companySize} employees` : ''}
Selected seniority levels: ${selectedSeniority.join(', ')}
Selected business areas: ${selectedFunctions.join(', ')}

Create a name like:
- "VP-level Clinical & BD at Series A Oncology Biotech"
- "Director-level R&D at Mid-size Pharma"
- "C-Suite at Early-stage Cell Therapy Biotech"

The name should be:
- Under 60 characters
- Start with the seniority level
- Include 1-2 key business areas
- Reference the company type/stage if space allows

Return ONLY the name, nothing else. No quotes, no explanation. Do not include em dashes in your response.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const name = (message.content[0] as { type: string; text: string }).text.trim();

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
