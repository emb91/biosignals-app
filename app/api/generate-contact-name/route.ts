import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { targetCompanyProfile, selectedFunctions, selectedSeniority } = body;

    if (!selectedFunctions?.length || !selectedSeniority?.length) {
      return NextResponse.json(
        { error: 'Functions and seniority are required' },
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
      if (levels.includes('C-Suite (CEO / CSO / CMO / COO)')) return 'C-Suite';
      if (levels.includes('VP Level')) return 'VP-level';
      if (levels.includes('Director Level')) return 'Director-level';
      if (levels.includes('Head of / Senior Manager')) return 'Senior';
      return levels[0]?.replace(' Level', '-level') || '';
    };

    // Simplify functions for the name
    const simplifyFunctions = (funcs: string[]): string => {
      const shortNames: Record<string, string> = {
        'C-Suite & Leadership': 'Leadership',
        'Business Development & Partnerships': 'BD',
        'Clinical Operations': 'Clinical',
        'Research & Development': 'R&D',
        'Manufacturing & CMC': 'CMC',
        'Regulatory Affairs': 'Regulatory',
        'Finance & Procurement': 'Finance',
        'Medical Affairs': 'Medical Affairs',
        'Lab Operations': 'Lab Ops',
        'Commercial & Sales Operations': 'Commercial',
        'Technology & Systems': 'Tech',
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
Selected functions: ${selectedFunctions.join(', ')}

Create a name like:
- "VP-level Clinical & BD at Series A Oncology Biotech"
- "Director-level R&D at Mid-size Pharma"
- "C-Suite at Early-stage Cell Therapy Biotech"

The name should be:
- Under 60 characters
- Start with the seniority level
- Include 1-2 key functions
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
