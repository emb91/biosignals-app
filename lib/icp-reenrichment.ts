import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { completeLlm } from '@/lib/llm-client';
import {
  BUSINESS_AREA_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  employeeCountToSizeBucket,
  followerCountToFollowerBucket,
  totalFundingToBracket,
} from '@/lib/arcova-taxonomy';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { assignFunctionWeights } from '@/lib/signal-weights';
import { personaFunctionNames } from '@/lib/persona-functions';
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
  functions?: string[] | null;
  signals?: string[] | null;
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
  name: string;
  functions: string[];
  seniority_levels: string[];
  job_titles: string[];
};

type ClaimResult =
  | {
      state: 'claimed';
      icp: Record<string, unknown>;
    }
  | {
      state: 'already_running';
      icp: Record<string, unknown>;
    }
  | {
      state: 'not_found';
    };

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

  const completion = await completeLlm({
    feature: 'generate_icp_summary',
    prompt,
    system:
      'Output only the requested sentence. Never mention the underlying company. Start exactly with "This ICP defines". Avoid promotional phrasing like "powered by".',
    maxTokens: 80,
    temperature: 0.3,
  });
  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'icp_summary_generation',
    route: 'lib/icp-reenrichment#generateIcpSummary',
    model: completion.model,
    usage: completion.usage,
    metadata: {
      company_type: input.companyType,
      platform_category: input.platformCategory || null,
      example_company_name: input.exampleCompanyName,
    },
  });

  const rawSummary = completion.text.trim();
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
}): Promise<BuyingTeamResult[]> {

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

TASK: Identify the DISTINCT BUYING TEAMS most likely involved in buying decisions for this seller's product within target accounts like these. A buying team is a coherent group of stakeholders who share a function and would be approached with the same message — e.g. a "Business Development" team, a "Scientific / R&D" team, a "Commercial" team. Different teams care about different things and warrant different outreach, which is why they are separate.

How many teams:
- Identify between 1 and 4 teams. Return SEPARATE teams only when they are genuinely distinct buyers who would receive different messaging.
- The count MUST be consistent with the organisation scale above. For micro / small companies the buying team usually collapses to a SINGLE team centred on founders / CEO / a singular functional owner — return just 1 team in that case. Only return 3–4 teams when the scale band truly supports several distinct parallel departments.
- Prune to what THIS seller actually sells into: a team only belongs here if the seller's products/services/value propositions plausibly map to it. Do not list a team the seller has no reason to sell to.

For EACH team provide:
- "name": a short label for the team (e.g. "Business Development", "Scientific / R&D", "Commercial"). Keep it to 1–3 words.
- "functions": the 1–2 most relevant business functions for THIS team (from the allowed list). The first function is the team's primary function.
- "seniority_levels": the 2–4 seniority levels that buy within this team (from the allowed list).
- "job_titles": 2–4 representative real-world job titles for this team, scaled to organisation size — founders and generalist heads for tiny companies; more specialised titles only when scale truly supports them.

Segment interpretation rules:
- Treat account segments like Research Universities, Academic Libraries, Healthcare Systems, CROs, or Learned Societies as context about WHO they sell into, not as business functions themselves.
- Treat buyer segments like Research Library Teams, Editorial Boards, Commercial Teams, or Clinical Operations Teams as strong clues about the real buying team.
- If the target segments point to academic libraries, scholarly communications, research information teams, or information-resource ownership, "Library & Information Services" is an appropriate business function.
- If the target segments point to university labs or research institutes, prefer existing functions like "Research & Development" or "Lab Operations" rather than inventing a generic "University" function.

You MUST only use values from the allowed lists below for "functions" and "seniority_levels". The "job_titles" field is free-text — keep titles concise and realistic for THIS organisation size (not hypothetical enterprise committees).

Allowed business functions:
${BUSINESS_AREA_OPTIONS.map((option) => `- ${option}`).join('\n')}

Allowed seniority levels:
${SENIORITY_LEVEL_OPTIONS.map((option) => `- ${option}`).join('\n')}

Return ONLY valid JSON — no markdown, no explanation:
{
  "buying_teams": [
    {
      "name": "<short team label>",
      "functions": [...1–2 business functions from the allowed list, primary first...],
      "seniority_levels": [...seniority levels from the allowed list...],
      "job_titles": [...2–4 illustrative real-world job titles scaled to organisation size...]
    }
  ]
}`;

  const completion = await completeLlm({
    feature: 'icp_buying_team',
    prompt,
    maxTokens: 768,
  });
  await recordLlmUsageEvent({
    provider: completion.provider,
    feature: 'icp_buying_team_generation',
    route: 'lib/icp-reenrichment#generateBuyingTeam',
    model: completion.model,
    usage: completion.usage,
    metadata: {
      icp_company_type: input.icpCompanyType,
      icp_platform_category: input.icpPlatformCategory || null,
      example_company_name: input.exampleCompanyName,
      example_employee_count: input.icpExampleEmployeeCount,
    },
  });

  const text = completion.text;

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('No JSON in buying-team response');
  }

  const parsed = JSON.parse(match[0]) as {
    buying_teams?: unknown;
    // legacy single-team shape (back-compat if the model ignores the new schema)
    functions?: unknown;
    seniority_levels?: unknown;
    job_titles?: unknown;
  };

  const allowedNames = BUSINESS_AREA_OPTIONS as readonly string[];
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

  const toTeam = (raw: unknown): BuyingTeamResult | null => {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as { name?: unknown; functions?: unknown; seniority_levels?: unknown; job_titles?: unknown };
    const functions = toAllowedArray(obj.functions, allowedNames);
    if (functions.length === 0) return null; // a team without a valid function is meaningless
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : functions[0];
    return {
      name,
      functions,
      seniority_levels: toAllowedArray(obj.seniority_levels, SENIORITY_LEVEL_OPTIONS),
      job_titles: toFreeArray(obj.job_titles, 4),
    };
  };

  let teams: BuyingTeamResult[] = [];
  if (Array.isArray(parsed.buying_teams)) {
    teams = (parsed.buying_teams as unknown[]).map(toTeam).filter((t): t is BuyingTeamResult => t !== null);
  }
  // Back-compat: if the model returned the old single-object shape, salvage it.
  if (teams.length === 0) {
    const legacy = toTeam(parsed);
    if (legacy) teams = [legacy];
  }

  // Dedupe teams that collapsed to the same primary function — keep the first.
  const seenPrimary = new Set<string>();
  return teams.filter((t) => {
    const primary = t.functions[0];
    if (seenPrimary.has(primary)) return false;
    seenPrimary.add(primary);
    return true;
  });
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

async function loadLinkedPersonas(
  supabase: AdminClient,
  userId: string,
  icpId: string,
): Promise<PersonaRow[]> {
  const { data, error } = await supabase
    .from('personas')
    .select('id, name, functions, signals')
    .eq('user_id', userId)
    .eq('icp_id', icpId);

  if (error) throw error;
  return (data as PersonaRow[] | null) ?? [];
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
  icpSummary: string | null;
  targetCustomers: string[];
  buyerTypes: string[];
  competitors: { name: string; url?: string }[];
}) {
  const now = new Date().toISOString();
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
}

async function persistBuyingTeams(params: {
  supabase: AdminClient;
  userId: string;
  icpId: string;
  existingPersonas: PersonaRow[];
  buyingTeams: BuyingTeamResult[];
}) {
  const now = new Date().toISOString();

  // Reconcile the freshly-inferred teams against the personas already linked to
  // this ICP. We key by PRIMARY FUNCTION (the first function, drawn from the
  // controlled vocabulary) so identity is stable across re-runs: a team whose
  // primary function already exists is UPDATED in place, a genuinely new team is
  // INSERTED, and an existing persona whose function is no longer in the buying
  // group is DELETED (contacts.scored_against_persona_id → SET NULL,
  // contact_persona_scores → CASCADE).
  const existingByPrimary = new Map<string, PersonaRow>();
  for (const persona of params.existingPersonas) {
    const primary = personaFunctionNames(persona.functions)[0];
    if (primary && !existingByPrimary.has(primary)) existingByPrimary.set(primary, persona);
  }

  const keptPersonaIds = new Set<string>();

  for (const team of params.buyingTeams) {
    const primary = team.functions[0];
    if (!primary) continue;

    const weightedFunctions = assignFunctionWeights(team.functions);
    const personaData = {
      name: `Buying group: ${team.name || primary}`,
      functions: weightedFunctions.map((item) => JSON.stringify(item)),
      seniority_levels: team.seniority_levels,
      job_titles: team.job_titles,
      updated_at: now,
    };

    const existing = existingByPrimary.get(primary);
    if (existing) {
      keptPersonaIds.add(existing.id);
      const { error } = await params.supabase
        .from('personas')
        .update(personaData)
        .eq('id', existing.id)
        .eq('user_id', params.userId);
      if (error) throw error;
    } else {
      const { error } = await params.supabase.from('personas').insert({
        user_id: params.userId,
        icp_id: params.icpId,
        created_at: now,
        ...personaData,
      });
      if (error) throw error;
    }
  }

  // Drop personas whose primary function is no longer part of the buying group.
  const staleIds = params.existingPersonas
    .filter((persona) => !keptPersonaIds.has(persona.id))
    .map((persona) => persona.id);
  if (staleIds.length > 0) {
    const { error } = await params.supabase
      .from('personas')
      .delete()
      .eq('user_id', params.userId)
      .in('id', staleIds);
    if (error) throw error;
  }
}

/**
 * Regenerate ONLY the buying-team personas for an ICP, from the data already
 * stored on the icps row — no website re-scrape, no full re-enrichment. Used to
 * backfill the multi-persona buying groups onto existing ICPs cheaply. Does NOT
 * re-score contacts (callers batch a single rescore after looping all ICPs).
 */
export async function regenerateBuyingTeamsForIcp(
  userId: string,
  icpId: string,
): Promise<{ teams: number }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('icps')
    .select(
      'company_type, platform_category, therapeutic_areas, modalities, development_stages, ' +
        'customer_therapeutic_areas, customer_modalities, customer_development_stages, ' +
        'target_customers, buyer_types, company_sizes, funding_stages, example_company_enrichment',
    )
    .eq('id', icpId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;

  const row = (data ?? {}) as unknown as Record<string, unknown>;
  const enr = (row.example_company_enrichment ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

  const [sellerProfile, existingPersonas] = await Promise.all([
    loadSellerProfile(supabase, userId),
    loadLinkedPersonas(supabase, userId, icpId),
  ]);

  const buyingTeams = await generateBuyingTeam({
    sellerProfile,
    icpCompanyType: str(row.company_type) || str(enr.company_type),
    icpPlatformCategory: str(row.platform_category),
    icpTherapeuticAreas: arr(row.therapeutic_areas),
    icpModalities: arr(row.modalities),
    icpDevelopmentStages: arr(row.development_stages),
    icpCustomerTherapeuticAreas: arr(row.customer_therapeutic_areas),
    icpCustomerModalities: arr(row.customer_modalities),
    icpCustomerDevelopmentStages: arr(row.customer_development_stages),
    icpTargetCustomers: arr(row.target_customers),
    icpBuyerTypes: arr(row.buyer_types),
    icpCompanySizes: arr(row.company_sizes),
    icpFundingStages: arr(row.funding_stages),
    icpExampleEmployeeCount: num(enr.employee_count),
    icpExampleEmployeeRange: typeof enr.employee_range === 'string' ? enr.employee_range : null,
    icpExampleTotalFundingUsd: num(enr.total_funding_usd),
    exampleCompanyName: typeof enr.company_name === 'string' ? enr.company_name : null,
  });

  await persistBuyingTeams({ supabase, userId, icpId, existingPersonas, buyingTeams });
  return { teams: buyingTeams.length };
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
    const hydrated = normalizePlatformTaxonomyFields(data[0] as Record<string, unknown>);
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

  const hydrated = normalizePlatformTaxonomyFields(current as Record<string, unknown>);

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
    const [icp, sellerProfile, existingPersonas] = await Promise.all([
      loadIcp(supabase, input.userId, input.icpId),
      loadSellerProfile(supabase, input.userId),
      loadLinkedPersonas(supabase, input.userId, input.icpId),
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

    const [icpSummary, buyingTeams] = await Promise.all([
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
      icpSummary,
      targetCustomers: refreshedSegments.customerOrganizations,
      buyerTypes: refreshedSegments.buyerTypes,
      competitors: refreshedCompetitors,
    });

    await persistBuyingTeams({
      supabase,
      userId: input.userId,
      icpId: input.icpId,
      existingPersonas,
      buyingTeams,
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
