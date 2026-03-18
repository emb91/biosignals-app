import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sellerProfile, targetCompanyProfile } = body;

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

    // Build seller description from their company profile
    let sellerDescription = 'a life science company';
    if (sellerProfile) {
      const descArray = Array.isArray(sellerProfile.description) 
        ? sellerProfile.description 
        : [sellerProfile.description].filter(Boolean);
      const customersArray = Array.isArray(sellerProfile.customers_we_serve) 
        ? sellerProfile.customers_we_serve 
        : [sellerProfile.customers_we_serve].filter(Boolean);
      
      if (descArray.length > 0 || customersArray.length > 0 || sellerProfile.company_name) {
        sellerDescription = `${sellerProfile.company_name || 'A company'} that ${descArray.slice(0, 2).join('. ')}`;
        if (customersArray.length > 0) {
          sellerDescription += `. They sell to: ${customersArray.slice(0, 3).join(', ')}`;
        }
      }
    }

    // Build target company description
    const targetDescription = buildTargetDescription(targetCompanyProfile);

    const prompt = `You are helping a sales team identify the right functions to target within a potential customer company.

SELLER COMPANY:
${sellerDescription}

TARGET COMPANY PROFILE:
${targetDescription}

Available functions to choose from (use EXACTLY these names):
- C-Suite & Leadership
- Business Development & Partnerships
- Clinical Operations
- Research & Development
- Manufacturing & CMC
- Regulatory Affairs
- Finance & Procurement
- Medical Affairs
- Lab Operations
- Commercial & Sales Operations
- Technology & Systems

Based on what the seller company does and who they're trying to reach, which 3-5 functions within the target company are most likely to:
1. Be involved in purchasing decisions for this type of product/service
2. Have budget authority or influence over procurement
3. Experience the pain points that the seller's offering addresses

Consider the company size and stage when making recommendations. A 10-person startup won't have dedicated Medical Affairs or Data Science teams.

Return ONLY a JSON array of function names from the list above. No explanation, no markdown. Do not include em dashes in your response.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text.trim();
    
    let functions: string[];
    try {
      functions = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        functions = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse functions');
      }
    }

    return NextResponse.json({ functions });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error suggesting functions:', errorMessage);
    return NextResponse.json(
      { error: errorMessage || 'Failed to suggest functions' },
      { status: 500 }
    );
  }
}

function buildTargetDescription(profile: {
  company_type?: string;
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
