import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  COMPANY_SIZE_OPTIONS,
  employeeCountToSizeBucket,
  totalFundingToBracket,
} from '@/lib/arcova-taxonomy';

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

type OrgScaleBand = 'micro' | 'small' | 'mid' | 'large' | 'unknown';

function smallestSelectedSizeBucket(sizes: string[] | undefined): string | null {
  if (!sizes?.length) return null;
  const order = COMPANY_SIZE_OPTIONS as unknown as readonly string[];
  let best: string | null = null;
  let bestIdx = Infinity;
  for (const s of sizes) {
    const i = order.indexOf(s);
    if (i >= 0 && i < bestIdx) {
      bestIdx = i;
      best = s;
    }
  }
  return best;
}

function resolvePrimarySizeBucket(
  employeeCount?: number | null,
  employeeRange?: string | null,
  icp_company_sizes?: string[],
): { bucket: string | null; from: 'employee_data' | 'icp_sizes' | 'none' } {
  const fromEmployee = employeeCountToSizeBucket(
    typeof employeeCount === 'number' && employeeCount >= 0 ? employeeCount : undefined,
    employeeRange ?? null,
  );
  if (fromEmployee.length > 0) {
    return { bucket: fromEmployee[0]!, from: 'employee_data' };
  }
  const fromIcp = smallestSelectedSizeBucket(icp_company_sizes);
  if (fromIcp) return { bucket: fromIcp, from: 'icp_sizes' };
  return { bucket: null, from: 'none' };
}

function bucketToScaleBand(bucket: string | null): OrgScaleBand {
  if (!bucket) return 'unknown';
  const order = COMPANY_SIZE_OPTIONS as unknown as readonly string[];
  const idx = order.indexOf(bucket);
  if (idx < 0) return 'unknown';
  if (idx === 0) return 'micro';
  if (idx === 1) return 'small';
  if (idx <= 3) return 'mid';
  return 'large';
}

function orgScaleInstructions(band: OrgScaleBand): string {
  if (band === 'micro') {
    return `- This is an extremely small organisation (approximately 1–10 employees total across the entire company).

- There are not separate staffed "Marketing team", "Commercial team", and "Research & Development" organisations the way buyers exist at Fortune 500 life sciences firms. The SAME few people absorb multiple agendas; one leader may legally or tactically approve spend.

- You MUST prioritize Executive Leadership among the chosen business functions — this is overwhelmingly where budget and vendor decisions consolidate at this scale.

- Pick at MOST 3 business functions in total unless the seller's offer is hyper-specialised to one narrow domain (otherwise you are fictionalising departmental structure).

- Avoid stacking multiple unrelated departments (e.g. Marketing + R&D + Commercial + Procurement) unless the textual evidence screams that they genuinely buy that way.

- Seniority levels: emphasise "C-Level" and "Head of / Senior Manager". If you include "VP / SVP", do so sparingly and only where it is realistic — many 5-person companies have no VP layer at all.

- job_titles MUST read like tiny-company reality: "Co-Founder & CEO", "Founder", "Chief Executive Officer", "Managing Director", "Head of [X]" for the actual person who owns that function, "Founding Scientist", etc.

- Explicitly BAD for this tier: implying a parallel peer group of VPs running separate kingdoms ("VP Marketing AND VP Commercial AND Director R&D") at a handful of employees.`;
  }

  if (band === 'small') {
    return `- This is a small company (approximately 11–50 employees). Specialist roles exist but teams are thin; assume broad remits and overlapping responsibility.

- Pick 3–4 business functions at most. Do not imply a separate full-size function for each area (e.g. full Marketing department + full Commercial organisation + extensive R&D department) unless the seller's product implies that structure.

- Seniority levels can include C-Level, Director, and VP / SVP where realistic, but avoid a long list of parallel VPs each representing a mature silo.

- job_titles should still lean practical (e.g. "Head of Business Development", "VP R&D") rather than enterprise committee patterns.`;
  }

  if (band === 'mid') {
    return `- This is a mid-sized life sciences organisation (roughly tens to low hundreds of employees). Departments and specialised buying roles are plausible.

- You may use a broader spread of business functions (up to the 2–5 limit) where appropriate, including Director / VP mixes.

- Job titles may include multi-stakeholder patterns (VP Medical Affairs, Director Clinical Operations) when appropriate.`;
  }

  if (band === 'large') {
    return `- This target account is large (hundreds to many thousands of employees). Multi-function buying committees, category managers, procurement, and specialised VPs/Directors are common.

- Use the full breadth of business functions and seniority levels where appropriate.`;
  }

  return `- Target account headcount bucket is UNKNOWN or not yet classified. Default to FEWER, broader buyer functions — assume lean structure until evidence suggests a huge enterprise procurement machine.

- Avoid inventing parallel large-department buyer groups. Prefer Executive Leadership plus the one or two functions most aligned with what the seller actually sells into.`;
}

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
      /** Beachhead: disease / workflow / stage of ACCOUNTS the example company sells into (not its own pipeline). */
      icp_customer_therapeutic_areas?: string[];
      icp_customer_modalities?: string[];
      icp_customer_development_stages?: string[];
      icp_company_sizes?: string[];
      icp_funding_stages?: string[];
      /** From example-company enrichment (Apollo / LinkedIn) — drives realistic micro-company buying logic */
      icp_example_employee_count?: number | null;
      icp_example_employee_range?: string | null;
      icp_example_total_funding_usd?: number | null;
      // Example company used to derive the ICP
      example_company_name?: string;
    };

    const { bucket: headcountBucket, from: headcountFrom } = resolvePrimarySizeBucket(
      body.icp_example_employee_count,
      body.icp_example_employee_range,
      body.icp_company_sizes,
    );
    const scaleBand = bucketToScaleBand(headcountBucket);

    const headcountSummary =
      typeof body.icp_example_employee_count === 'number' && body.icp_example_employee_count >= 0
        ? `Reported headcount (example target account): ${body.icp_example_employee_count} FTE (source: enrichment).`
        : body.icp_example_employee_range
          ? `LinkedIn / enrichment employee range (example target account): ${body.icp_example_employee_range}.`
          : headcountBucket
            ? `Derived company-size bucket: "${headcountBucket}" (from ${headcountFrom === 'employee_data' ? 'recorded headcount' : 'ICP company size criteria'}).`
            : 'No reliable headcount signal — treat the target as organisationally lean unless other evidence implies scale.';

    const fundingBracket = totalFundingToBracket(body.icp_example_total_funding_usd);
    const fundingLine = [
      body.icp_funding_stages?.length
        ? `Funding stage (ICP criteria): ${body.icp_funding_stages.join(', ')}.`
        : '',
      fundingBracket
        ? `Total funding raised by example target account: ${fundingBracket}. Use this to calibrate how many specialist roles plausibly exist.`
        : '',
    ].filter(Boolean).join(' ');

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

TARGET ACCOUNT PROFILE (ICP) — distinguish "this company" vs "customers they serve":
- Company type: ${body.icp_company_type ?? ''}
- Own therapeutic areas (their science / product): ${body.icp_therapeutic_areas?.join(', ') ?? ''}
- Own modalities (their product technology): ${body.icp_modalities?.join(', ') ?? ''}
- Own development stages (their assets / trial phase): ${body.icp_development_stages?.join(', ') ?? ''}
- Customers served — therapeutic areas (beachhead): ${body.icp_customer_therapeutic_areas?.join(', ') ?? ''}
- Customers served — modalities / workflows: ${body.icp_customer_modalities?.join(', ') ?? ''}
- Customers served — development stages (buyer accounts): ${body.icp_customer_development_stages?.join(', ') ?? ''}
- Company size criteria (may be multi-select): ${body.icp_company_sizes?.join(', ') ?? ''}
${fundingLine ? `- ${fundingLine}` : ''}
${body.example_company_name ? `- Example account used to define this ICP: ${body.example_company_name}` : ''}

ORGANISATION SCALE — READ THIS BEFORE ANYTHING ELSE (this block overrides generic B2B habits):
${headcountSummary}

Internal scale band for your reasoning: ${scaleBand.toUpperCase()}.

Scale-specific rules — you MUST follow them:
${orgScaleInstructions(scaleBand)}

TASK: Identify which business functions and seniority levels are most likely involved in buying decisions for this seller's product within target accounts like these. The answer must be consistent with the organisation scale above — for micro and small companies, that often means concentrating on founders / CEO / singular functional owners rather than imagining mature parallel departments.

Then list 4–6 representative job titles that match the implied scale — founders and generalist heads for tiny companies; more specialised titles only when scale band truly supports several distinct senior buyers.

You MUST only use values from the allowed lists below for "functions" and "seniority_levels". Pick the 2–5 most relevant business functions AND 2–5 seniority levels, but APPLY the smallest counts implied by scale (e.g. a 5-person company might warrant only 2 business functions × 2 seniority levels reflected across job_titles).

The "job_titles" field is free-text — keep titles concise and realistic for THIS organisation size (not hypothetical enterprise committees).

Allowed business functions:
${BUSINESS_AREA_OPTIONS.map((o) => `- ${o}`).join('\n')}

Allowed seniority levels:
${SENIORITY_LEVEL_OPTIONS.map((o) => `- ${o}`).join('\n')}

Return ONLY valid JSON — no markdown, no explanation:
{
  "functions": [...business functions from the allowed list...],
  "seniority_levels": [...seniority levels from the allowed list...],
  "job_titles": [...4–6 illustrative real-world job titles scaled to organisation size...]
}`;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 768,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'No JSON in response' }, { status: 500 });

    const parsed = JSON.parse(match[0]) as { functions?: unknown; seniority_levels?: unknown; job_titles?: unknown };

    const toArr = (v: unknown, allowed: readonly string[]): string[] =>
      Array.isArray(v)
        ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && allowed.includes(x as string))
        : [];

    const toFreeArr = (v: unknown, max: number): string[] =>
      Array.isArray(v)
        ? (v as unknown[])
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map((s) => s.trim())
            .slice(0, max)
        : [];

    return NextResponse.json({
      functions: toArr(parsed.functions, BUSINESS_AREA_OPTIONS),
      seniority_levels: toArr(parsed.seniority_levels, SENIORITY_LEVEL_OPTIONS),
      job_titles: toFreeArr(parsed.job_titles, 6),
    });

  } catch (error) {
    console.error('[generate-buying-team]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
