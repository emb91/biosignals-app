import { NextResponse } from 'next/server';
import { BUSINESS_AREA_OPTIONS } from '@/lib/arcova-taxonomy';
import { resolveCustomerSegments } from '@/lib/split-customer-segments';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { completeLlm } from '@/lib/llm-client';
import { guardAuthenticatedAction } from '@/lib/api-security';

export async function POST(request: Request) {
  const guard = await guardAuthenticatedAction(request, {
    action: 'suggest-functions',
    maxBodyBytes: 48_000,
  });
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const { sellerProfile, targetCompanyProfile } = body;

    if (!targetCompanyProfile) {
      return NextResponse.json(
        { error: 'Target company profile is required' },
        { status: 400 }
      );
    }

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

    const prompt = `You are helping a sales team identify the right business areas to target within a potential customer company.

SELLER COMPANY:
${sellerDescription}

TARGET COMPANY PROFILE:
${targetDescription}

Available business areas to choose from (use EXACTLY these names):
${BUSINESS_AREA_OPTIONS.map((option) => `- ${option}`).join('\n')}

Based on what the seller company does and who they're trying to reach, which 3-5 business areas within the target company are most likely to:
1. Be involved in purchasing decisions for this type of product/service
2. Have budget authority or influence over procurement
3. Experience the pain points that the seller's offering addresses

Consider the company size and stage when making recommendations. A 10-person startup won't have dedicated Medical Affairs or Data Science teams.

Return ONLY a JSON array of business area names from the list above. No explanation, no markdown. Do not include em dashes in your response.`;

    const completion = await completeLlm({
      feature: 'suggest_buyer_functions',
      prompt,
      maxTokens: 200,
    });

    await recordLlmUsageEvent({
      provider: completion.provider,
      feature: 'suggest_functions',
      route: 'app/api/suggest-functions',
      model: completion.model,
      usage: completion.usage,
    });

    const responseText = completion.text.trim();
    
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
  platform_category?: string;
  therapeutic_areas?: string[];
  modalities?: string[];
  development_stages?: string[];
  company_sizes?: string[];
  funding_stages?: string[];
  name?: string;
  target_customers?: string[] | null;
  buyer_types?: string[] | null;
  // Blob fallbacks for rows that predate the first-class columns migration.
  example_company_enrichment?: {
    target_customers?: string[] | null;
    customers_we_serve?: string[] | null;
  } | null;
}): string {
  const parts: string[] = [];
  const customerSegments = (() => {
    // Prefer first-class columns if populated.
    if (profile.target_customers?.length || profile.buyer_types?.length) {
      return {
        customerOrganizations: profile.target_customers ?? [],
        buyerTypes: profile.buyer_types ?? [],
      };
    }
    const blob = profile.example_company_enrichment;
    return resolveCustomerSegments({
      targetCustomers: blob?.target_customers ?? null,
      customersWeServe: blob?.customers_we_serve ?? null,
      fallbackItems: blob?.customers_we_serve ?? null,
    });
  })();

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

  if (customerSegments.customerOrganizations.length > 0) {
    parts.push(`Sells to companies like: ${customerSegments.customerOrganizations.join(', ')}`);
  }

  if (customerSegments.buyerTypes.length > 0) {
    parts.push(`Sells to people like: ${customerSegments.buyerTypes.join(', ')}`);
  }

  return parts.join('\n') || 'Unknown company type';
}
