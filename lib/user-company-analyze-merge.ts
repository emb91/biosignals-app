import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApifyFirmographics } from '@/lib/my-company-enrichment';
import {
  isMissingColumnError,
  logApiOperationError,
  parseMissingColumnNameFromDbError,
  withoutPlatformCategory,
  withoutUserCompanyCustomerTaxonomy,
} from '@/lib/supabase-column-compat';

type CondensedBullets = {
  good_fit: string[];
  bad_fit: string[];
  value_propositions: string[];
  products: string[];
  services: string[];
  technologies: string[];
} | null;

type TaxonomyRow = {
  company_type?: string | null;
  company_type_display?: string | null;
  platform_category?: string | null;
  therapeutic_areas?: string[] | null;
  modalities?: string[] | null;
  development_stages?: string[] | null;
  customer_therapeutic_areas?: string[] | null;
  customer_modalities?: string[] | null;
  customer_development_stages?: string[] | null;
} | null;

function stringArrayOrNull(value: unknown, maxItems = 80): string[] | null {
  if (Array.isArray(value)) {
    const out = value
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, maxItems);
    return out.length > 0 ? out : null;
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return null;
}

function competitorsEnrichedOrNull(
  value: unknown,
): { name: string; url?: string }[] | null {
  if (!Array.isArray(value)) return null;
  const out: { name: string; url?: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) continue;
    const url = typeof rec.url === 'string' ? rec.url.trim() : undefined;
    out.push(url ? { name, url } : { name });
  }
  return out.length > 0 ? out : null;
}

/**
 * Build the exact payload for `user_company` insert/update during analyze-and-store.
 * Do not spread raw Claude JSON: extra keys break PostgREST; wrong types break Postgres.
 */
export function buildUserCompanyMergePayload(args: {
  narrative: Record<string, unknown>;
  website: string;
  domain: string | null;
  linkedinUrl: string | null;
  apollo: Record<string, unknown>;
  apify: ApifyFirmographics;
  apifyRaw: Record<string, unknown> | null;
  taxonomy: TaxonomyRow;
  condensed: CondensedBullets;
}): Record<string, unknown> {
  const {
    narrative,
    website,
    domain,
    linkedinUrl,
    apollo,
    apify,
    apifyRaw,
    taxonomy,
    condensed,
  } = args;

  return {
    company_name: typeof narrative.company_name === 'string' ? narrative.company_name : null,
    description: stringArrayOrNull(narrative.description),
    target_customers: stringArrayOrNull(narrative.target_customers),
    industries: stringArrayOrNull(narrative.industries),
    unique_characteristics: stringArrayOrNull(narrative.unique_characteristics),
    business_model: stringArrayOrNull(narrative.business_model),
    operating_environment: stringArrayOrNull(narrative.operating_environment),
    market_summary: stringArrayOrNull(narrative.market_summary),
    customers_we_serve: stringArrayOrNull(narrative.customers_we_serve),
    why_customers_buy: stringArrayOrNull(narrative.why_customers_buy),
    differentiated_value: stringArrayOrNull(narrative.differentiated_value),
    status_quo: stringArrayOrNull(narrative.status_quo),
    capabilities: stringArrayOrNull(narrative.capabilities),
    challenges_addressed: stringArrayOrNull(narrative.challenges_addressed),
    customer_benefits: stringArrayOrNull(narrative.customer_benefits),
    arr_estimate: typeof narrative.arr_estimate === 'string' ? narrative.arr_estimate : null,

    website,
    domain,
    analyzed_at: new Date().toISOString(),
    status: 'completed',
    linkedin_url: linkedinUrl,

    employee_count: apollo.company_employee_count ?? apify.employee_count ?? null,
    employee_range: apify.employee_range ?? null,
    follower_count: apify.follower_count ?? null,
    founded_year: apollo.company_founded_year ?? apify.founded_year ?? null,
    funding_stage: apollo.company_funding_stage ?? null,
    total_funding_usd: apollo.company_total_funding_usd ?? null,
    latest_funding_date: apollo.company_latest_funding_date ?? null,
    hq_city: apollo.company_hq_city ?? apify.hq_city ?? null,
    hq_country: apollo.company_hq_country ?? apify.hq_country ?? null,
    industry: apollo.company_industry ?? apify.industry ?? null,
    logo_url: apify.logo_url ?? null,
    tagline: apify.tagline ?? null,
    specialties: apify.specialties ?? null,

    company_type: taxonomy?.company_type ?? null,
    company_type_display: taxonomy?.company_type_display ?? null,
    platform_category: taxonomy?.platform_category ?? null,
    therapeutic_areas: taxonomy?.therapeutic_areas ?? null,
    modalities: taxonomy?.modalities ?? null,
    development_stages: taxonomy?.development_stages ?? null,
    customer_therapeutic_areas: taxonomy?.customer_therapeutic_areas ?? null,
    customer_modalities: taxonomy?.customer_modalities ?? null,
    customer_development_stages: taxonomy?.customer_development_stages ?? null,

    company_status: typeof narrative.company_status === 'string' ? narrative.company_status : null,

    products_services: condensed?.products?.length
      ? condensed.products
      : stringArrayOrNull(narrative.products),
    services: condensed?.services?.length
      ? condensed.services
      : stringArrayOrNull(narrative.services),
    technologies: condensed?.technologies?.length
      ? condensed.technologies
      : stringArrayOrNull(narrative.technologies),

    good_fit: condensed?.good_fit?.length
      ? condensed.good_fit
      : stringArrayOrNull(narrative.good_fit),
    bad_fit: condensed?.bad_fit?.length
      ? condensed.bad_fit
      : stringArrayOrNull(narrative.bad_fit),
    // Not condensed — kept at natural phrase length so the agent can reason from them.
    buyer_prerequisites: stringArrayOrNull(narrative.buyer_prerequisites),
    buyer_disqualifiers: stringArrayOrNull(narrative.buyer_disqualifiers),
    value_propositions: condensed?.value_propositions?.length
      ? condensed.value_propositions
      : stringArrayOrNull(narrative.value_propositions),

    competitors_enriched: competitorsEnrichedOrNull(narrative.competitors_enriched),

    apollo_firmographics: Object.keys(apollo).length > 0 ? apollo : null,
    apify_firmographics: apifyRaw,
  };
}

/**
 * Insert or update `user_company` with compatibility retries when remote schemas lag migrations.
 */
export async function upsertUserCompanyFromAnalysis(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  mergedData: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; error: null } | { data: null; error: unknown }> {
  const { data: existing, error: existingError } = await supabase
    .from('user_company')
    .select('id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    logApiOperationError('[user_company] select existing row failed', existingError, {
      userId: user.id,
    });
    return { data: null, error: existingError };
  }

  let payload: Record<string, unknown> = { ...mergedData };
  let strippedPlatform = false;
  let strippedCustomerTax = false;
  const strippedColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    const writeResult = existing
      ? await supabase
          .from('user_company')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single()
      : await supabase
          .from('user_company')
          .insert({
            user_id: user.id,
            user_email: user.email ?? null,
            ...payload,
          })
          .select()
          .single();

    const { data, error } = writeResult;
    if (!error && data) {
      return { data: data as Record<string, unknown>, error: null };
    }

    if (!error) {
      const orphan = new Error('user_company write returned no row');
      logApiOperationError('[user_company] upsert no row returned', orphan, {
        userId: user.id,
        op: existing ? 'update' : 'insert',
        attempt: attempt + 1,
      });
      return { data: null, error: orphan };
    }

    if (!isMissingColumnError(error)) {
      logApiOperationError('[user_company] upsert failed', error, {
        userId: user.id,
        op: existing ? 'update' : 'insert',
        attempt: attempt + 1,
        strippedPlatform,
        strippedCustomerTax,
        strippedColumns,
      });
      return { data: null, error };
    }

    const msg =
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : '';
    const parsedCol = parseMissingColumnNameFromDbError(msg);

    let retried = false;
    if (
      parsedCol !== null &&
      Object.prototype.hasOwnProperty.call(payload, parsedCol)
    ) {
      const next = { ...payload };
      delete (next as Record<string, unknown>)[parsedCol];
      payload = next;
      strippedColumns.push(parsedCol);
      retried = true;
    }
    if (!retried && !strippedPlatform && isMissingColumnError(error, 'platform_category')) {
      payload = withoutPlatformCategory(payload);
      strippedPlatform = true;
      retried = true;
    }
    if (
      !retried &&
      !strippedCustomerTax &&
      (isMissingColumnError(error, 'customer_therapeutic_areas') ||
        isMissingColumnError(error, 'customer_modalities') ||
        isMissingColumnError(error, 'customer_development_stages'))
    ) {
      payload = withoutUserCompanyCustomerTaxonomy(payload);
      strippedCustomerTax = true;
      retried = true;
    }

    if (!retried) {
      logApiOperationError('[user_company] upsert missing column not handled', error, {
        userId: user.id,
        op: existing ? 'update' : 'insert',
        attempt: attempt + 1,
        strippedPlatform,
        strippedCustomerTax,
        strippedColumns,
        parsedColumn: parsedCol,
      });
      return { data: null, error };
    }
  }

  const exhausted = new Error('user_company upsert exhausted schema compatibility retries');
  logApiOperationError('[user_company] upsert retries exhausted', exhausted, {
    userId: user.id,
    op: existing ? 'update' : 'insert',
    strippedPlatform,
    strippedCustomerTax,
    strippedColumns,
  });
  return { data: null, error: exhausted };
}
