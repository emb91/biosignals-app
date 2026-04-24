import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';

const BUSINESS_AREA_OPTIONS = [
  'Executive Leadership',
  'Business Development & Partnerships',
  'Clinical Operations',
  'Research & Development',
  'Regulatory Affairs',
  'Manufacturing & CMC',
  'Medical Affairs',
  'Commercial & Sales Operations',
  'Procurement',
  'Strategy & Corporate Development',
  'Lab Operations',
  'Technology & Systems',
  'AI & Machine Learning',
  'Marketing',
] as const;

const SENIORITY_LEVEL_OPTIONS = [
  'C-Level',
  'VP / SVP',
  'Director',
  'Head of / Senior Manager',
  'Manager',
  'Individual Contributor',
] as const;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Missing ANTHROPIC_API_KEY' }, { status: 500 });

    const body = await request.json() as {
      // Seller profile
      seller_company_name?: string;
      seller_company_type?: string;
      seller_therapeutic_areas?: string[];
      seller_products_services?: string[];
      seller_services?: string[];
      seller_customers_we_serve?: string[];
      seller_value_propositions?: string[];
      // Target ICP
      icp_company_type?: string;
      icp_therapeutic_areas?: string[];
      icp_modalities?: string[];
      icp_development_stages?: string[];
      icp_company_sizes?: string[];
      // Example company used to derive the ICP
      example_company_name?: string;
    };

    const client = new Anthropic({ apiKey });

    const prompt = `You are a B2B sales intelligence analyst. Based on what a company sells and the type of accounts they target, identify the most likely buying team functions and seniority levels.

SELLER:
- Company: ${body.seller_company_name ?? 'Unknown'}
- Type: ${body.seller_company_type ?? ''}
- Products: ${body.seller_products_services?.join(', ') ?? ''}
- Services: ${body.seller_services?.join(', ') ?? ''}
- Customers they serve: ${body.seller_customers_we_serve?.join(', ') ?? ''}
- Value propositions: ${body.seller_value_propositions?.join(', ') ?? ''}
- Therapeutic areas: ${body.seller_therapeutic_areas?.join(', ') ?? ''}

TARGET ACCOUNT PROFILE (ICP):
- Company type: ${body.icp_company_type ?? ''}
- Therapeutic areas: ${body.icp_therapeutic_areas?.join(', ') ?? ''}
- Modalities: ${body.icp_modalities?.join(', ') ?? ''}
- Development stages: ${body.icp_development_stages?.join(', ') ?? ''}
- Company sizes: ${body.icp_company_sizes?.join(', ') ?? ''}
${body.example_company_name ? `- Example account used to define this ICP: ${body.example_company_name}` : ''}

TASK: Identify which business functions and seniority levels are most likely involved in buying decisions for this seller's product within target accounts like these.

You MUST only use values from the allowed lists below. Pick the 2–5 most relevant from each.

Allowed business functions:
${BUSINESS_AREA_OPTIONS.map((o) => `- ${o}`).join('\n')}

Allowed seniority levels:
${SENIORITY_LEVEL_OPTIONS.map((o) => `- ${o}`).join('\n')}

Return ONLY valid JSON — no markdown, no explanation:
{
  "functions": [...business functions from the allowed list...],
  "seniority_levels": [...seniority levels from the allowed list...]
}`;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'No JSON in response' }, { status: 500 });

    const parsed = JSON.parse(match[0]) as { functions?: unknown; seniority_levels?: unknown };

    const toArr = (v: unknown, allowed: readonly string[]): string[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && allowed.includes(x as string))
        : [];

    return NextResponse.json({
      functions: toArr(parsed.functions, BUSINESS_AREA_OPTIONS),
      seniority_levels: toArr(parsed.seniority_levels, SENIORITY_LEVEL_OPTIONS),
    });

  } catch (error) {
    console.error('[generate-buying-team]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
