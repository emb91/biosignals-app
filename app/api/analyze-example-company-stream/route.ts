/**
 * Streaming version of /api/analyze-example-company.
 *
 * Returns text/event-stream instead of a single JSON blob.
 * Events arrive in this order as each enrichment step completes:
 *   step_claude   (~5–10 s) — narrative fields from Claude web search
 *   step_apollo   (~5–10 s) — firmographics from Apollo (may arrive before claude)
 *   step_apify    (~15–25 s) — LinkedIn logo/tagline/followers (skipped if no LinkedIn URL)
 *   step_taxonomy (~25–30 s) — canonical taxonomy classification
 *   done          — full merged result (same shape as the non-streaming route)
 *
 * The non-streaming route (/api/analyze-example-company) is preserved and still works.
 */

import { enrichOrganizationWithApollo } from '@/lib/apollo';
import {
  analyseCompanyWithClaude,
  scrapeLinkedInCompany,
  extractApifyFirmographics,
  normalizeLinkedInCompanyUrl,
} from '@/lib/my-company-enrichment';
import { resolveFundingStage } from '@/lib/company-monitor/funding';
import { resolveCompanyTaxonomy } from '@/lib/company-monitor/taxonomy';
import { encodeSSEEvent, SSE_HEADERS } from '@/lib/sse';
import type { TargetCompanyEnrichmentResult } from '@/lib/target-company-enrichment';

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { url?: string };
  const { url } = body;

  if (!url) {
    return Response.json({ error: 'URL is required' }, { status: 400 });
  }

  const website = url.trim();
  const domain = normalizeDomain(website);

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Parameters<typeof encodeSSEEvent>[0], data: Record<string, unknown>) => {
        try { controller.enqueue(encodeSSEEvent(event, data)); } catch { /* stream closed */ }
      };
      const safeClose = () => { try { controller.close(); } catch { /* already closed */ } };

      try {
        // ── Step 1: Claude + Apollo in parallel — emit each as it resolves ────
        let narrative: Record<string, unknown> = {};
        let apollo: Record<string, unknown> = {};

        const claudePromise = analyseCompanyWithClaude(website)
          .then((result) => {
            narrative = result;
            emit('step_claude', result);
          })
          .catch((err: unknown) => {
            console.error('[analyze-example-company-stream] Claude failed:', err);
          });

        const apolloPromise = enrichOrganizationWithApollo({ company_domain: domain })
          .then((result) => {
            apollo = result;
            emit('step_apollo', result as Record<string, unknown>);
          })
          .catch((err: unknown) => {
            console.error('[analyze-example-company-stream] Apollo failed:', err);
          });

        await Promise.all([claudePromise, apolloPromise]);

        // ── Step 2: Resolve LinkedIn URL ──────────────────────────────────────
        const linkedinUrl =
          normalizeLinkedInCompanyUrl(
            typeof apollo.company_linkedin_url === 'string' ? apollo.company_linkedin_url : null,
          ) ??
          normalizeLinkedInCompanyUrl(
            typeof narrative.linkedin_url === 'string' ? narrative.linkedin_url : null,
          );

        // ── Step 3: Apify LinkedIn scrape ─────────────────────────────────────
        let apifyRaw: Record<string, unknown> | null = null;
        if (linkedinUrl) {
          console.log('[analyze-example-company-stream] Scraping LinkedIn:', linkedinUrl);
          apifyRaw = await scrapeLinkedInCompany(linkedinUrl).catch((err: unknown) => {
            console.error('[analyze-example-company-stream] Apify failed:', err);
            return null;
          });
        } else {
          console.log('[analyze-example-company-stream] No LinkedIn URL — skipping Apify');
        }

        const apify = extractApifyFirmographics(apifyRaw);
        emit('step_apify', {
          logo_url: apify.logo_url ?? null,
          tagline: apify.tagline ?? null,
          follower_count: apify.follower_count ?? null,
          employee_range: apify.employee_range ?? null,
          specialties: apify.specialties ?? null,
          hq_city: apify.hq_city ?? null,
          hq_country: apify.hq_country ?? null,
        });

        // ── Step 4: Taxonomy classification ──────────────────────────────────
        const companyName =
          typeof narrative.company_name === 'string' ? narrative.company_name :
          typeof apollo.company_name === 'string' ? apollo.company_name : '';

        let funding: Awaited<ReturnType<typeof resolveFundingStage>> | null = null;
        if (companyName || domain) {
          funding = await resolveFundingStage({
            company_name: companyName || domain || website,
            domain,
            apollo_funding_stage: typeof apollo.company_funding_stage === 'string' ? apollo.company_funding_stage : null,
            apollo_total_funding_usd: typeof apollo.company_total_funding_usd === 'number' ? apollo.company_total_funding_usd : null,
            apollo_latest_funding_date: typeof apollo.company_latest_funding_date === 'string' ? apollo.company_latest_funding_date : null,
          }).catch((err: unknown) => {
            console.error('[analyze-example-company-stream] Funding resolution failed:', err);
            return null;
          });
        }

        let taxonomy: Awaited<ReturnType<typeof resolveCompanyTaxonomy>> | null = null;
        if (companyName || domain) {
          taxonomy = await resolveCompanyTaxonomy({
            company_name: companyName,
            domain,
            apify_company_firmographics: apifyRaw,
            apollo_company_firmographics: Object.keys(apollo).length > 0 ? apollo : null,
          }).catch((err: unknown) => {
            console.error('[analyze-example-company-stream] Taxonomy failed:', err);
            return null;
          });
        }

        if (taxonomy) {
          emit('step_taxonomy', {
            company_type: taxonomy.company_type ?? null,
            company_type_display: taxonomy.company_type_display ?? null,
            platform_category: taxonomy.platform_category ?? null,
            therapeutic_areas: taxonomy.therapeutic_areas ?? null,
            modalities: taxonomy.modalities ?? null,
            development_stages: taxonomy.development_stages ?? null,
            customer_therapeutic_areas: taxonomy.customer_therapeutic_areas ?? null,
            customer_modalities: taxonomy.customer_modalities ?? null,
            customer_development_stages: taxonomy.customer_development_stages ?? null,
          });
        }

        // ── Step 5: Merge and emit done ───────────────────────────────────────
        const result: TargetCompanyEnrichmentResult = {
          company_name: companyName || null,
          website,
          domain,
          logo_url: apify.logo_url ?? null,
          tagline: apify.tagline ?? null,
          linkedin_url: linkedinUrl ?? null,

          description: Array.isArray(narrative.description) ? narrative.description as string[] : null,
          products: Array.isArray(narrative.products) ? narrative.products as string[] : null,
          services: Array.isArray(narrative.services) ? narrative.services as string[] : null,
          technologies: Array.isArray(narrative.technologies) ? narrative.technologies as string[] : null,
          industries: Array.isArray(narrative.industries) ? narrative.industries as string[] : null,
          unique_characteristics: Array.isArray(narrative.unique_characteristics) ? narrative.unique_characteristics as string[] : null,
          business_model: Array.isArray(narrative.business_model) ? narrative.business_model as string[] : null,
          operating_environment: Array.isArray(narrative.operating_environment) ? narrative.operating_environment as string[] : null,
          market_summary: Array.isArray(narrative.market_summary) ? narrative.market_summary as string[] : null,
          target_customers: Array.isArray(narrative.target_customers) ? narrative.target_customers as string[] : null,
          customers_we_serve: Array.isArray(narrative.customers_we_serve) ? narrative.customers_we_serve as string[] : null,
          why_customers_buy: Array.isArray(narrative.why_customers_buy) ? narrative.why_customers_buy as string[] : null,
          differentiated_value: Array.isArray(narrative.differentiated_value) ? narrative.differentiated_value as string[] : null,
          status_quo: Array.isArray(narrative.status_quo) ? narrative.status_quo as string[] : null,
          capabilities: Array.isArray(narrative.capabilities) ? narrative.capabilities as string[] : null,
          challenges_addressed: Array.isArray(narrative.challenges_addressed) ? narrative.challenges_addressed as string[] : null,
          customer_benefits: Array.isArray(narrative.customer_benefits) ? narrative.customer_benefits as string[] : null,
          good_fit: Array.isArray(narrative.good_fit) ? narrative.good_fit as string[] : null,
          bad_fit: Array.isArray(narrative.bad_fit) ? narrative.bad_fit as string[] : null,
          value_propositions: Array.isArray(narrative.value_propositions) ? narrative.value_propositions as string[] : null,
          competitors_enriched: Array.isArray(narrative.competitors_enriched)
            ? narrative.competitors_enriched as { name: string; url?: string }[]
            : null,
          company_status: typeof narrative.company_status === 'string' ? narrative.company_status : null,
          funding_status_label: funding?.funding_status_label ?? null,
          funding_resolution_summary: funding?.raw_finding ?? null,
          funding_data_source: funding?.source ?? null,
          arr_estimate: typeof narrative.arr_estimate === 'string' ? narrative.arr_estimate : null,

          employee_count: (apollo.company_employee_count as number | null) ?? apify.employee_count ?? null,
          employee_range: apify.employee_range ?? null,
          follower_count: apify.follower_count ?? null,
          founded_year: (apollo.company_founded_year as number | null) ?? apify.founded_year ?? null,
          funding_stage: funding?.funding_stage ?? (apollo.company_funding_stage as string | null) ?? null,
          total_funding_usd: funding?.total_funding_usd ?? (apollo.company_total_funding_usd as number | null) ?? null,
          latest_funding_date: funding?.latest_funding_date ?? (apollo.company_latest_funding_date as string | null) ?? null,
          hq_city: (apollo.company_hq_city as string | null) ?? apify.hq_city ?? null,
          hq_country: (apollo.company_hq_country as string | null) ?? apify.hq_country ?? null,
          industry: (apollo.company_industry as string | null) ?? apify.industry ?? null,
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

          apollo_firmographics: Object.keys(apollo).length > 0 ? apollo : null,
          apify_firmographics: apifyRaw,
        };

        emit('done', result as unknown as Record<string, unknown>);
        safeClose();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (!message.includes('Controller is already closed')) {
          console.error('[analyze-example-company-stream] Fatal error:', message);
        }
        emit('error', { message });
        safeClose();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
