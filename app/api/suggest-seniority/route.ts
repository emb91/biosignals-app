import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sellerProfile, targetCompanyProfile, selectedFunctions } = body;

    if (!targetCompanyProfile) {
      return NextResponse.json(
        { error: 'Target company profile is required' },
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

    // Build seller description
    let sellerDescription = 'a life science company';
    if (sellerProfile) {
      const descArray = Array.isArray(sellerProfile.description) 
        ? sellerProfile.description 
        : [sellerProfile.description].filter(Boolean);
      
      if (descArray.length > 0 || sellerProfile.company_name) {
        sellerDescription = `${sellerProfile.company_name || 'A company'} that ${descArray.slice(0, 2).join('. ')}`;
      }
    }

    // Build target company description
    const targetDescription = buildTargetDescription(targetCompanyProfile);

    const prompt = `You are helping a sales team identify the right seniority levels to target within a potential customer company.

SELLER COMPANY:
${sellerDescription}

TARGET COMPANY PROFILE:
${targetDescription}

BUSINESS AREAS BEING TARGETED:
${selectedFunctions?.join(', ') || 'Not specified'}

Available seniority levels (use EXACTLY these names):
- C-Level
- VP / SVP
- Director
- Head of / Senior Manager
- Manager
- Individual Contributor

Based on the target company profile, which 2-4 seniority levels are most appropriate to target?

Consider:
- A Series A startup with 10-50 employees rarely has VP / SVP roles outside of founders
- Larger pharma companies have deep hierarchies where Directors often drive vendor decisions
- Grant-funded academic spinouts may have flatter structures
- The selected business areas affect which seniority levels have purchasing authority
- Earlier stage companies often require C-Level involvement for significant purchases

Return ONLY a JSON array of seniority level names from the list above. No explanation, no markdown. Do not include em dashes in your response.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text.trim();
    
    let seniority: string[];
    try {
      seniority = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        seniority = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse seniority levels');
      }
    }

    return NextResponse.json({ seniority });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error suggesting seniority:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to suggest seniority levels' },
      { status: 500 }
    );
  }
}

function buildTargetDescription(profile: {
  company_type?: string;
  platform_category?: string;
  therapeutic_areas?: string[];
  modalities?: string[];
  development_stages?: string[];
  company_sizes?: string[];
  funding_stages?: string[];
  name?: string;
}): string {
  const parts: string[] = [];

  if (profile.name) {
    parts.push(`Profile name: ${profile.name}`);
  }

  if (profile.company_type) {
    parts.push(`Company type: ${profile.company_type}`);
  }

  if (profile.platform_category) {
    parts.push(`Platform category: ${profile.platform_category}`);
  }

  if (profile.therapeutic_areas?.length) {
    parts.push(`Therapeutic focus: ${profile.therapeutic_areas.join(', ')}`);
  }

  if (profile.modalities?.length) {
    parts.push(`Modalities: ${profile.modalities.join(', ')}`);
  }

  if (profile.development_stages?.length) {
    parts.push(`Development stage: ${profile.development_stages.join(', ')}`);
  }

  if (profile.company_sizes?.length) {
    parts.push(`Company size: ${profile.company_sizes.join(', ')} employees`);
  }

  if (profile.funding_stages?.length) {
    parts.push(`Funding stage: ${profile.funding_stages.join(', ')}`);
  }

  return parts.join('\n') || 'Unknown company type';
}
