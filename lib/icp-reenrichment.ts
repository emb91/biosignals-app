import Anthropic from '@anthropic-ai/sdk';
import {
  BUSINESS_AREA_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  employeeCountToSizeBucket,
  followerCountToFollowerBucket,
  totalFundingToBracket,
} from '@/lib/arcova-taxonomy';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { COMPANY_SIGNALS, getDefaultContactSignalSelectionIds } from '@/lib/signals/catalog';
import {
  hydrateIcpsWithSignals,
  replaceIcpSignalSelections,
} from '@/lib/signals/selections';
import { assignFunctionWeights, assignSignalWeights } from '@/lib/signal-weights';
import { resolveCustomerSegments } from '@/lib/split-customer-segments';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  isMissingColumnError,
  withoutIcpSegmentColumns,
  withoutPlatformCategory,
} from '@/lib/supabase-column-compat';
import {
  enrichTargetCompany,
  type TargetCompanyEnrichmentResult,
} from '@/lib/target-company-enrichment';

const BUYING_TEAM_MODEL = 'claude-sonnet-4-6';

type AdminClient = ReturnType<typeof createAdminClient>;

export type IcpReenrichmentStatus = 'idle' | 'running' | 'succeeded' | 'failed';

type IcpRow = {
  id: string;
  user_id: string;
  name: string;
  example_company_url: string;
  reenrichment_status: IcpReenrichmentStatus;
};

type PersonaRow = {
  id: string;
  name: string | null;
};

type SellerProfile = {
  company_name: string | null;
  company_type: string | null;
  platform_category: string | null;
  therapeutic_areas: string[] | null;
  products_services: string[] | null;
  services: string[] | null;
  customers_we_serve: string[] | null;
  value_propositions: string[] | null;
};

type BuyingTeamResult = {
  functions: string[];
  seniority_levels: string[];
  job_titles: string[];
};

type ClaimResult =
  | {
      state: 'claimed';
      icp: Record<string, unknown> & { id: string; signals: string[] };
    }
  | {
      state: 'already_running';
      icp: Record<string, unknown> & { id: string; signals: string[] };
    }
  | {
      state: 'not_found';
    };

function requireAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key not configured');
  }

  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

function parseJsonArrayResponse(responseText: string): string[] {
  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Could not parse JSON array response');
  }
}

function normalizeUniqueIds(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function isSaasCompanyType(value?: string | null): boolean {
  return (value ?? '').trim() === 'SaaS';
}

function visiblePlatformCategory(
  companyType?: string | null,
  platformCategory?: string | null,
): string {
  return isSaasCompanyType(companyType) ? (platformCategory ?? '').trim() : '';
}

function storedPlatformCategory(
  companyType?: string | null,
  platformCategory?: string | null,
): string | null {
  const value = visiblePlatformCategory(companyType, platformCategory);
  return value || null;
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return message.trim().slice(0, 1000) || 'Unknown error';
}

function smallestSelectedSizeBucket(sizes: string[] | undefined): string | null {
  if (!sizes?.length) return null;

  let best: string | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;

  for (const size of sizes) {
    const index = COMPANY_SIZE_OPTIONS.indexOf(size as (typeof COMPANY_SIZE_OPTIONS)[number]);
    if (index >= 0 && index < bestIndex) {
      bestIndex = index;
      best = size;
    }
  }

  return best;
}

type OrgScaleBand = 'micro' | 'small' | 'mid' | 'large' | 'unknown';

function resolvePrimarySizeBucket(
  employeeCount?: number | null,
  employeeRange?: string | null,
  companySizes?: string[],
): { bucket: string | null; from: 'employee_data' | 'icp_sizes' | 'none' } {
  const fromEmployee = employeeCountToSizeBucket(
    typeof employeeCount === 'number' && employeeCount >= 0 ? employeeCount : undefined,
    employeeRange ?? null,
  );
  if (fromEmployee.length > 0) {
    return { bucket: fromEmployee[0]!, from: 'employee_data' };
  }

  const fromIcp = smallestSelectedSizeBucket(companySizes);
  if (fromIcp) return { bucket: fromIcp, from: 'icp_sizes' };

  return { bucket: null, from: 'none' };
}

function bucketToScaleBand(bucket: string | null): OrgScaleBand {
  if (!bucket) return 'unknown';

  const index = COMPANY_SIZE_OPTIONS.indexOf(bucket as (typeof COMPANY_SIZE_OPTIONS)[number]);
  if (index < 0) return 'unknown';
  if (index === 0) return 'micro';
  if (index === 1) return 'small';
  if (index <= 3) return 'mid';
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

async function recommendCompanySignals(input: {
  companyType: string;
  platformCategory: string;
  companySizes: string[];
  therapeuticAreas: string[];
  modalities: string[];
  developmentStages: string[];
  fundingStages: string[];
}): Promise<string[]> {
  const anthropic = requireAnthropicClient();

  const signalList = COMPANY_SIGNALS.map(
    (signal) => `- ${signal.id}: ${signal.displayName} (${signal.category})`,
  ).join('\n');

  const prompt = `You are helping a B2B sales team in the life sciences industry select the most relevant buying signals to track for their ideal customer profile.

Their ICP criteria:
- Company Type: ${input.companyType || 'Not specified'}
- Platform Category: ${input.platformCategory || 'Not specified'}
- Company Sizes: ${input.companySizes.join(', ') || 'Any'}
- Therapeutic Areas: ${input.therapeuticAreas.join(', ') || 'Any'}
- Modalities: ${input.modalities.join(', ') || 'Any'}
- Development Stages: ${input.developmentStages.join(', ') || 'Any'}
- Funding Stages: ${input.fundingStages.join(', ') || 'Any'}

Available signals to choose from:
${signalList}

Based on this ICP, select every signal from the list above that is at least moderately relevant to tracking buying intent for this profile—be inclusive; do not cap the count. Omit only signals that are clearly a poor fit. Order by importance (strongest buying-window indicators first). Consider:
- What events typically precede purchasing decisions for this type of customer?
- What signals indicate growth, expansion, or new initiatives?
- What hiring patterns suggest they're building capabilities your seller might support?

Return ONLY a JSON array of signal IDs (the part before the colon), ordered by relevance—include as many ids as belong in the list, from one up to the full catalogue if appropriate.

Do not include em dashes in your response.
Return ONLY the JSON array, nothing else.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = (message.content[0] as { type: string; text: string }).text.trim();
  const recommendedIds = normalizeUniqueIds(parseJsonArrayResponse(responseText));

  return recommendedIds.filter((id) => COMPANY_SIGNALS.some((signal) => signal.id === id));
}

async function generateIcpSummary(input: {
  companyType: string;
  platformCategory: string;
  therapeuticAreas: string[];
  modalities: string[];
  developmentStages: string[];
  customerTherapeuticAreas: string[];
  customerModalities: string[];
  customerDevelopmentStages: string[];
  companySizes: string[];
  fundingStages: string[];
  exampleCompanyName: string | null;
  exampleCompanyDescription: string[] | null;
}): Promise<string | null> {
  const anthropic = requireAnthropicClient();

  const normalizeList = (values?: string[]) =>
    (values || []).map((value) => value.trim()).filter(Boolean);

  const ownTherapeuticAreas = normalizeList(input.therapeuticAreas);
  const ownModalities = normalizeList(input.modalities);
  const ownStages = normalizeList(input.developmentStages);
  const customerTas = normalizeList(input.customerTherapeuticAreas);
  const customerMods = normalizeList(input.customerModalities);
  const customerStages = normalizeList(input.customerDevelopmentStages);
  const sizes = normalizeList(input.companySizes);
  const funding = normalizeList(input.fundingStages);

  const contextLines: string[] = [];
  if (input.exampleCompanyName) contextLines.push(`Reference company: ${input.exampleCompanyName}`);
  if (input.exampleCompanyDescription?.[0]) {
    contextLines.push(`Reference company summary: ${input.exampleCompanyDescription[0]}`);
  }
  if (input.companyType) contextLines.push(`Company type: ${input.companyType}`);
  if (input.platformCategory) contextLines.push(`Platform category: ${input.platformCategory}`);
  if (ownTherapeuticAreas.length) contextLines.push(`Own therapeutic areas: ${ownTherapeuticAreas.join(', ')}`);
  if (ownModalities.length) contextLines.push(`Own modalities: ${ownModalities.join(', ')}`);
  if (ownStages.length) contextLines.push(`Own development stages: ${ownStages.join(', ')}`);
  if (customerTas.length) contextLines.push(`Customer therapeutic areas: ${customerTas.join(', ')}`);
  if (customerMods.length) contextLines.push(`Customer modalities/workflows: ${customerMods.join(', ')}`);
  if (customerStages.length) contextLines.push(`Customer development stages: ${customerStages.join(', ')}`);
  if (sizes.length) contextLines.push(`Typical company sizes: ${sizes.join(', ')}`);
  if (funding.length) contextLines.push(`Funding stages: ${funding.join(', ')}`);

  const prompt = `You are writing a concise summary for an ICP (ideal customer profile) card in a B2B life sciences sales product.

${contextLines.join('\n')}

Write exactly 1 sentence that describes the ICP archetype, not the specific reference company.

Rules:
- Start exactly with "This ICP defines"
- Do not ever mention the reference company
- Do not ever mention the reference company name, website, domain, product names, or branded terms
- Do not say "example company" or "reference company"
- Do not restate or summarize the reference company's specific product or tagline — derive the archetype from company type, modalities, therapeutic focus, customer segments, and size
- Avoid promotional phrasing like "powered by", "leading", "innovative", or similar positioning language
- Focus on plainly defining what kind of company this ICP represents
- If useful, include modality, therapeutic area, or commercial context
- Keep it under 28 words
- If you are about to mention the underlying company in any way, rewrite the sentence to stay generic
- Output only the sentence`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 80,
    temperature: 0.3,
    system:
      'Output only the requested sentence. Never mention the underlying company. Start exactly with "This ICP defines". Avoid promotional phrasing like "powered by".',
    messages: [{ role: 'user', content: prompt }],
  });

  const rawSummary = (message.content[0] as { type: string; text: string }).text.trim();
  const summary = rawSummary.replace(/\s+/g, ' ').trim();

  return summary || null;
}

async function generateBuyingTeam(input: {
  sellerProfile: SellerProfile | null;
  icpCompanyType: string;
  icpPlatformCategory: string;
  icpTherapeuticAreas: string[];
  icpModalities: string[];
  icpDevelopmentStages: string[];
  icpCustomerTherapeuticAreas: string[];
  icpCustomerModalities: string[];
  icpCustomerDevelopmentStages: string[];
  icpTargetCustomers: string[];
  icpBuyerTypes: string[];
  icpCompanySizes: string[];
  icpFundingStages: string[];
  icpExampleEmployeeCount: number | null;
  icpExampleEmployeeRange: string | null;
  icpExampleTotalFundingUsd: number | null;
  exampleCompanyName: string | null;
}): Promise<BuyingTeamResult> {
  const client = requireAnthropicClient();

  const { bucket: headcountBucket, from: headcountFrom } = resolvePrimarySizeBucket(
    input.icpExampleEmployeeCount,
    input.icpExampleEmployeeRange,
    input.icpCompanySizes,
  );
  const scaleBand = bucketToScaleBand(headcountBucket);

  const headcountSummary =
    typeof input.icpExampleEmployeeCount === 'number' && input.icpExampleEmployeeCount >= 0
      ? `Reported headcount (example target account): ${input.icpExampleEmployeeCount} FTE (source: enrichment).`
      : input.icpExampleEmployeeRange
        ? `LinkedIn / enrichment employee range (example target account): ${input.icpExampleEmployeeRange}.`
        : headcountBucket
          ? `Derived company-size bucket: "${headcountBucket}" (from ${headcountFrom === 'employee_data' ? 'recorded headcount' : 'ICP company size criteria'}).`
          : 'No reliable headcount signal — treat the target as organisationally lean unless other evidence implies scale.';

  const fundingBracket = totalFundingToBracket(input.icpExampleTotalFundingUsd);
  const fundingLine = [
    input.icpFundingStages.length
      ? `Funding stage (ICP criteria): ${input.icpFundingStages.join(', ')}.`
      : '',
    fundingBracket
      ? `Total funding raised by example target account: ${fundingBracket}. Use this to calibrate how many specialist roles plausibly exist.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const prompt = `You are a B2B sales intelligence analyst. Based on what a company sells and the type of accounts they target, identify the most likely buying team functions and seniority levels.

SELLER:
- Company: ${input.sellerProfile?.company_name ?? 'Unknown'}
- Type: ${input.sellerProfile?.company_type ?? ''}
- Platform category: ${visiblePlatformCategory(input.sellerProfile?.company_type, input.sellerProfile?.platform_category)}
- Products: ${input.sellerProfile?.products_services?.join(', ') ?? ''}
- Services: ${input.sellerProfile?.services?.join(', ') ?? ''}
- Customers they serve: ${input.sellerProfile?.customers_we_serve?.join(', ') ?? ''}
- Value propositions: ${input.sellerProfile?.value_propositions?.join(', ') ?? ''}
- Therapeutic areas: ${input.sellerProfile?.therapeutic_areas?.join(', ') ?? ''}

TARGET ACCOUNT PROFILE (ICP) — distinguish "this company" vs "customers they serve":
- Company type: ${input.icpCompanyType}
- Platform category: ${input.icpPlatformCategory}
- Own therapeutic areas (their science / product): ${input.icpTherapeuticAreas.join(', ')}
- Own modalities (their product technology): ${input.icpModalities.join(', ')}
- Own development stages (their assets / trial phase): ${input.icpDevelopmentStages.join(', ')}
- Sells to companies like: ${input.icpTargetCustomers.join(', ')}
- Sells to people like: ${input.icpBuyerTypes.join(', ')}
- Customers served — therapeutic areas (beachhead): ${input.icpCustomerTherapeuticAreas.join(', ')}
- Customers served — modalities / workflows: ${input.icpCustomerModalities.join(', ')}
- Customers served — development stages (buyer accounts): ${input.icpCustomerDevelopmentStages.join(', ')}
- Company size criteria (may be multi-select): ${input.icpCompanySizes.join(', ')}
${fundingLine ? `- ${fundingLine}` : ''}
${input.exampleCompanyName ? `- Example account used to define this ICP: ${input.exampleCompanyName}` : ''}

ORGANISATION SCALE — READ THIS BEFORE ANYTHING ELSE (this block overrides generic B2B habits):
${headcountSummary}

Internal scale band for your reasoning: ${scaleBand.toUpperCase()}.

Scale-specific rules — you MUST follow them:
${orgScaleInstructions(scaleBand)}

TASK: Identify which business functions and seniority levels are most likely involved in buying decisions for this seller's product within target accounts like these. The answer must be consistent with the organisation scale above — for micro and small companies, that often means concentrating on founders / CEO / singular functional owners rather than imagining mature parallel departments.

Then list 4–6 representative job titles that match the implied scale — founders and generalist heads for tiny companies; more specialised titles only when scale band truly supports several distinct senior buyers.

Segment interpretation rules:
- Treat account segments like Research Universities, Academic Libraries, Healthcare Systems, CROs, or Learned Societies as context about WHO they sell into, not as business functions themselves.
- Treat buyer segments like Research Library Teams, Editorial Boards, Commercial Teams, or Clinical Operations Teams as strong clues about the real buying team.
- If the target segments point to academic libraries, scholarly communications, research information teams, or information-resource ownership, "Library & Information Services" is an appropriate business function.
- If the target segments point to university labs or research institutes, prefer existing functions like "Research & Development" or "Lab Operations" rather than inventing a generic "University" function.

You MUST only use values from the allowed lists below for "functions" and "seniority_levels". Pick the 2–5 most relevant business functions AND 2–5 seniority levels, but APPLY the smallest counts implied by scale (e.g. a 5-person company might warrant only 2 business functions × 2 seniority levels reflected across job_titles).

The "job_titles" field is free-text — keep titles concise and realistic for THIS organisation size (not hypothetical enterprise committees).

Allowed business functions:
${BUSINESS_AREA_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed seniority levels:
${SENIORITY_LEVEL_OPTIONS.map((option) => `- ${option}`).join('\n')}

Return ONLY valid JSON — no markdown, no explanation:
{
  "functions": [...business functions from the allowed list...],
  "seniority_levels": [...seniority levels from the allowed list...],
  "job_titles": [...4–6 illustrative real-world job titles scaled to organisation size...]
}`;

  const message = await client.messages.create({
    model: BUYING_TEAM_MODEL,
    max_tokens: 768,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('No JSON in buying-team response');
  }

  const parsed = JSON.parse(match[0]) as {
    functions?: unknown;
    seniority_levels?: unknown;
    job_titles?: unknown;
  };

  const toAllowedArray = (value: unknown, allowed: readonly string[]): string[] =>
    Array.isArray(value)
      ? (value as unknown[]).filter(
          (item): item is string =>
            typeof item === 'string' && allowed.includes(item as string),
        )
      : [];

  const toFreeArray = (value: unknown, max: number): string[] =>
    Array.isArray(value)
      ? (value as unknown[])
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
          .slice(0, max)
      : [];

  return {
    functions: toAllowedArray(parsed.functions, BUSINESS_AREA_OPTIONS),
    seniority_levels: toAllowedArray(parsed.seniority_levels, SENIORITY_LEVEL_OPTIONS),
    job_titles: toFreeArray(parsed.job_titles, 6),
  };
}

async function loadSellerProfile(
  supabase: AdminClient,
  userId: string,
): Promise<SellerProfile | null> {
  let result = await supabase
    .from('user_company')
    .select(
      'company_name, company_type, platform_category, therapeutic_areas, products_services, services, customers_we_serve, value_propositions',
    )
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (result.error && isMissingColumnError(result.error, 'platform_category')) {
    result = await supabase
      .from('user_company')
      .select(
        'company_name, company_type, therapeutic_areas, products_services, services, customers_we_serve, value_propositions',
      )
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
  }

  if (result.error) throw result.error;

  return (result.data as SellerProfile | null) ?? null;
}

async function loadIcp(supabase: AdminClient, userId: string, icpId: string): Promise<IcpRow> {
  const { data, error } = await supabase
    .from('icps')
    .select('id, user_id, name, example_company_url, reenrichment_status')
    .eq('id', icpId)
    .eq('user_id', userId)
    .single();

  if (error) throw error;

  return data as IcpRow;
}

async function loadLinkedPersona(
  supabase: AdminClient,
  userId: string,
  icpId: string,
): Promise<PersonaRow | null> {
  const { data, error } = await supabase
    .from('personas')
    .select('id, name')
    .eq('user_id', userId)
    .eq('icp_id', icpId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as PersonaRow | null) ?? null;
}

async function markIcpReenrichmentStatus(
  supabase: AdminClient,
  userId: string,
  icpId: string,
  status: Exclude<IcpReenrichmentStatus, 'idle'>,
  lastError: string | null,
) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('icps')
    .update({
      reenrichment_status: status,
      reenrichment_last_error: lastError,
      reenrichment_finished_at: now,
      updated_at: now,
    })
    .eq('id', icpId)
    .eq('user_id', userId);

  if (error) throw error;
}

async function persistRefreshedIcp(params: {
  supabase: AdminClient;
  userId: string;
  icpId: string;
  icpName: string;
  exampleCompanyUrl: string;
  enrichment: TargetCompanyEnrichmentResult;
  companySizes: string[];
  liFollowerSizes: string[];
  fundingStages: string[];
  companySignals: string[];
  icpSummary: string | null;
  targetCustomers: string[];
  buyerTypes: string[];
  competitors: { name: string; url?: string }[];
}) {
  const now = new Date().toISOString();
  const weightedSignals = assignSignalWeights(params.companySignals);
  const companyType = params.enrichment.company_type ?? '';
  const platformCategory = storedPlatformCategory(
    companyType,
    params.enrichment.platform_category ?? '',
  );

  const icpData: Record<string, unknown> = {
    name: params.icpName,
    icp_summary: params.icpSummary,
    company_type: companyType,
    platform_category: platformCategory,
    therapeutic_areas: params.enrichment.therapeutic_areas ?? [],
    modalities: params.enrichment.modalities ?? [],
    development_stages: params.enrichment.development_stages ?? [],
    customer_therapeutic_areas: params.enrichment.customer_therapeutic_areas ?? [],
    customer_modalities: params.enrichment.customer_modalities ?? [],
    customer_development_stages: params.enrichment.customer_development_stages ?? [],
    company_sizes: params.companySizes,
    li_follower_sizes: params.liFollowerSizes,
    funding_stages: params.fundingStages,
    signals: weightedSignals.map((signal) => JSON.stringify(signal)),
    example_companies: [],
    example_company_url: params.exampleCompanyUrl,
    example_company_enrichment: params.enrichment,
    target_customers: params.targetCustomers,
    buyer_types: params.buyerTypes,
    competitors: params.competitors,
    updated_at: now,
  };

  let result = await params.supabase
    .from('icps')
    .update(icpData)
    .eq('id', params.icpId)
    .eq('user_id', params.userId)
    .select()
    .single();

  if (result.error && isMissingColumnError(result.error, 'platform_category')) {
    result = await params.supabase
      .from('icps')
      .update(withoutPlatformCategory(icpData))
      .eq('id', params.icpId)
      .eq('user_id', params.userId)
      .select()
      .single();
  }

  if (result.error && isMissingColumnError(result.error, 'target_customers')) {
    result = await params.supabase
      .from('icps')
      .update(withoutIcpSegmentColumns(icpData))
      .eq('id', params.icpId)
      .eq('user_id', params.userId)
      .select()
      .single();
  }

  if (result.error) throw result.error;

  await replaceIcpSignalSelections(
    params.supabase,
    params.userId,
    params.icpId,
    params.companySignals,
  );
}

async function persistBuyingTeam(params: {
  supabase: AdminClient;
  userId: string;
  icpId: string;
  existingPersona: PersonaRow | null;
  buyingTeam: BuyingTeamResult;
}) {
  const now = new Date().toISOString();
  const weightedFunctions = assignFunctionWeights(params.buyingTeam.functions);
  const personaName =
    params.buyingTeam.functions.length > 0
      ? `Buying group: ${params.buyingTeam.functions[0]}`
      : params.existingPersona?.name?.trim() || 'Buying group';

  const personaData = {
    name: personaName,
    functions: weightedFunctions.map((item) => JSON.stringify(item)),
    seniority_levels: params.buyingTeam.seniority_levels,
    job_titles: params.buyingTeam.job_titles,
    updated_at: now,
  };

  if (params.existingPersona) {
    // Fetch existing signals so we don't clobber a user's saved selection
    const { data: existing } = await params.supabase
      .from('personas')
      .select('signals')
      .eq('id', params.existingPersona.id)
      .single();

    const existingSignals: string[] = (existing as { signals?: string[] } | null)?.signals ?? [];
    const signals =
      existingSignals.length > 0
        ? existingSignals
        : getDefaultContactSignalSelectionIds().map((id) =>
            JSON.stringify({ id, weight: 1 }),
          );

    const { error } = await params.supabase
      .from('personas')
      .update({ ...personaData, signals })
      .eq('id', params.existingPersona.id)
      .eq('user_id', params.userId);

    if (error) throw error;
    return;
  }

  const defaultSignals = getDefaultContactSignalSelectionIds().map((id) =>
    JSON.stringify({ id, weight: 1 }),
  );

  const { error } = await params.supabase.from('personas').insert({
    user_id: params.userId,
    icp_id: params.icpId,
    created_at: now,
    ...personaData,
    signals: defaultSignals,
  });

  if (error) throw error;
}

export async function claimIcpReenrichment(
  userId: string,
  icpId: string,
): Promise<ClaimResult> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('icps')
    .update({
      reenrichment_status: 'running',
      reenrichment_last_error: null,
      reenrichment_started_at: now,
      reenrichment_finished_at: null,
      updated_at: now,
    })
    .eq('id', icpId)
    .eq('user_id', userId)
    .neq('reenrichment_status', 'running')
    .select('*');

  if (error) throw error;

  if ((data || []).length > 0) {
    const [hydrated] = await hydrateIcpsWithSignals(
      supabase,
      userId,
      [data[0] as Record<string, unknown> & { id: string }],
    );
    return { state: 'claimed', icp: hydrated };
  }

  const { data: current, error: currentError } = await supabase
    .from('icps')
    .select('*')
    .eq('id', icpId)
    .eq('user_id', userId)
    .maybeSingle();

  if (currentError) throw currentError;
  if (!current) return { state: 'not_found' };

  const [hydrated] = await hydrateIcpsWithSignals(
    supabase,
    userId,
    [current as Record<string, unknown> & { id: string }],
  );

  if ((current as { reenrichment_status?: string | null }).reenrichment_status === 'running') {
    return { state: 'already_running', icp: hydrated };
  }

  throw new Error('Unable to claim ICP reenrichment job');
}

export async function runIcpReenrichmentJob(input: {
  icpId: string;
  userId: string;
}): Promise<void> {
  const supabase = createAdminClient();

  try {
    const [icp, sellerProfile, existingPersona] = await Promise.all([
      loadIcp(supabase, input.userId, input.icpId),
      loadSellerProfile(supabase, input.userId),
      loadLinkedPersona(supabase, input.userId, input.icpId),
    ]);

    const website = icp.example_company_url?.trim();
    if (!website) {
      throw new Error('No reference company URL is stored for this ICP');
    }

    const enrichment = await enrichTargetCompany(website);

    const employeeCount = enrichment.employee_count ?? null;
    const employeeRange = enrichment.employee_range ?? null;
    const followerCount = enrichment.follower_count ?? null;
    const companySizes =
      employeeCount != null || employeeRange
        ? employeeCountToSizeBucket(employeeCount, employeeRange)
        : [];
    const liFollowerSizes =
      followerCount != null ? followerCountToFollowerBucket(followerCount) : [];
    const companyType = enrichment.company_type ?? '';
    const platformCategory = visiblePlatformCategory(
      companyType,
      enrichment.platform_category ?? '',
    );
    const therapeuticAreas = enrichment.therapeutic_areas ?? [];
    const modalities = enrichment.modalities ?? [];
    const developmentStages = enrichment.development_stages ?? [];
    const customerTherapeuticAreas = enrichment.customer_therapeutic_areas ?? [];
    const customerModalities = enrichment.customer_modalities ?? [];
    const customerDevelopmentStages =
      enrichment.customer_development_stages ?? [];
    const fundingStages = enrichment.funding_stage ? [enrichment.funding_stage] : [];
    const refreshedSegments = resolveCustomerSegments({
      targetCustomers: enrichment.target_customers ?? [],
      customersWeServe: enrichment.customers_we_serve ?? [],
      fallbackItems: enrichment.customers_we_serve ?? [],
    });
    const refreshedCompetitors = enrichment.competitors_enriched ?? [];

    const [companySignals, icpSummary, buyingTeam] = await Promise.all([
      recommendCompanySignals({
        companyType,
        platformCategory,
        companySizes,
        therapeuticAreas,
        modalities,
        developmentStages,
        fundingStages,
      }),
      generateIcpSummary({
        companyType,
        platformCategory,
        therapeuticAreas,
        modalities,
        developmentStages,
        customerTherapeuticAreas,
        customerModalities,
        customerDevelopmentStages,
        companySizes,
        fundingStages,
        exampleCompanyName: enrichment.company_name ?? null,
        exampleCompanyDescription: enrichment.description ?? null,
      }),
      generateBuyingTeam({
        sellerProfile,
        icpCompanyType: companyType,
        icpPlatformCategory: platformCategory,
        icpTherapeuticAreas: therapeuticAreas,
        icpModalities: modalities,
        icpDevelopmentStages: developmentStages,
        icpCustomerTherapeuticAreas: customerTherapeuticAreas,
        icpCustomerModalities: customerModalities,
        icpCustomerDevelopmentStages: customerDevelopmentStages,
        icpTargetCustomers: refreshedSegments.customerOrganizations,
        icpBuyerTypes: refreshedSegments.buyerTypes,
        icpCompanySizes: companySizes,
        icpFundingStages: fundingStages,
        icpExampleEmployeeCount: employeeCount,
        icpExampleEmployeeRange: employeeRange,
        icpExampleTotalFundingUsd: enrichment.total_funding_usd ?? null,
        exampleCompanyName: enrichment.company_name ?? null,
      }),
    ]);

    await persistRefreshedIcp({
      supabase,
      userId: input.userId,
      icpId: input.icpId,
      icpName: icp.name,
      exampleCompanyUrl: website,
      enrichment,
      companySizes,
      liFollowerSizes,
      fundingStages,
      companySignals,
      icpSummary,
      targetCustomers: refreshedSegments.customerOrganizations,
      buyerTypes: refreshedSegments.buyerTypes,
      competitors: refreshedCompetitors,
    });

    await persistBuyingTeam({
      supabase,
      userId: input.userId,
      icpId: input.icpId,
      existingPersona,
      buyingTeam,
    });

    await rescoreAllContactsForUser(input.userId);
    await markIcpReenrichmentStatus(supabase, input.userId, input.icpId, 'succeeded', null);
  } catch (error) {
    const message = summarizeError(error);
    console.error('[icp-reenrichment] job failed:', error);

    try {
      await markIcpReenrichmentStatus(
        supabase,
        input.userId,
        input.icpId,
        'failed',
        message,
      );
    } catch (statusError) {
      console.error('[icp-reenrichment] failed to persist job error:', statusError);
    }
  }
}
