/**
 * Streaming version of /api/analyze-and-store.
 *
 * Returns text/event-stream instead of a single JSON blob.
 * Events arrive in this order as each enrichment step completes:
 *   step_claude   (~5–10 s) — narrative fields from Claude web search
 *   step_apollo   (~5–10 s) — firmographics from Apollo (may arrive before claude)
 *   step_apify    (~15–25 s) — LinkedIn logo/tagline/followers (skipped if no LinkedIn URL)
 *   step_taxonomy (~25–30 s) — canonical taxonomy classification + condensed bullet labels
 *   done          — full merged result after DB upsert (same shape as the non-streaming route)
 *
 * The non-streaming route (/api/analyze-and-store) is preserved and still works.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { enrichOrganizationWithApollo } from '@/lib/apollo';
import {
  analyseCompanyWithClaude,
  scrapeLinkedInCompany,
  extractApifyFirmographics,
  normalizeLinkedInCompanyUrl,
  condenseBulletArrays,
} from '@/lib/my-company-enrichment';
import { resolveCompanyTaxonomy } from '@/lib/company-monitor/taxonomy';
import { encodeSSEEvent, SSE_HEADERS } from '@/lib/sse';

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export async function POST(request: NextRequest) {
  // Auth must be checked before the stream starts (uses request context)
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { website?: string };
  const { website } = body;

  if (!website) {
    return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
  }

  const domain = normalizeDomain(website);
  console.log('[analyze-and-store-stream] Analysing', website, '| domain:', domain);

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
            console.error('[analyze-and-store-stream] Claude failed:', err);
          });

        const apolloPromise = enrichOrganizationWithApollo({ company_domain: domain })
          .then((result) => {
            apollo = result as Record<string, unknown>;
            emit('step_apollo', result as Record<string, unknown>);
          })
          .catch((err: unknown) => {
            console.error('[analyze-and-store-stream] Apollo failed:', err);
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
          console.log('[analyze-and-store-stream] Scraping LinkedIn:', linkedinUrl);
          apifyRaw = await scrapeLinkedInCompany(linkedinUrl).catch((err: unknown) => {
            console.error('[analyze-and-store-stream] Apify failed:', err);
            return null;
          });
        } else {
          console.log('[analyze-and-store-stream] No LinkedIn URL — skipping Apify');
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

        // ── Step 4: Taxonomy + bullet condensing in parallel ──────────────────
        const companyNameForTaxonomy =
          typeof narrative.company_name === 'string' ? narrative.company_name :
          typeof apollo.company_name === 'string' ? apollo.company_name : '';

        const [taxonomyResult, condensedResult] = await Promise.allSettled([
          (companyNameForTaxonomy || domain)
            ? resolveCompanyTaxonomy({
                company_name: companyNameForTaxonomy,
                domain,
                apify_company_firmographics: apifyRaw,
                apollo_company_firmographics: Object.keys(apollo).length > 0 ? apollo : null,
              })
            : Promise.resolve(null),
          condenseBulletArrays({
            company_name: companyNameForTaxonomy || undefined,
            customers_we_serve: Array.isArray(narrative.customers_we_serve)
              ? (narrative.customers_we_serve as string[])
              : undefined,
            good_fit: Array.isArray(narrative.good_fit) ? (narrative.good_fit as string[]) : undefined,
            bad_fit: Array.isArray(narrative.bad_fit) ? (narrative.bad_fit as string[]) : undefined,
            value_propositions: Array.isArray(narrative.value_propositions)
              ? (narrative.value_propositions as string[])
              : undefined,
            products: Array.isArray(narrative.products) ? (narrative.products as string[]) : undefined,
            services: Array.isArray(narrative.services) ? (narrative.services as string[]) : undefined,
            technologies: Array.isArray(narrative.technologies)
              ? (narrative.technologies as string[])
              : undefined,
          }),
        ]);

        const taxonomy = taxonomyResult.status === 'fulfilled' ? taxonomyResult.value : null;
        const condensed = condensedResult.status === 'fulfilled' ? condensedResult.value : null;

        if (taxonomyResult.status === 'rejected')
          console.error('[analyze-and-store-stream] Taxonomy failed:', taxonomyResult.reason);
        if (condensedResult.status === 'rejected')
          console.error('[analyze-and-store-stream] Bullet condensing failed:', condensedResult.reason);

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

        // ── Step 5: Merge ─────────────────────────────────────────────────────
        const { linkedin_url: _claudeLinkedin, products: _products, services: _services, ...narrativeRest } = narrative;
        void _products; void _services; void _claudeLinkedin;

        const mergedData = {
          ...narrativeRest,
          website,
          domain,
          analyzed_at: new Date().toISOString(),
          status: 'completed',
          linkedin_url: linkedinUrl ?? null,
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
            : (Array.isArray(narrative.products) ? narrative.products : null),
          services: condensed?.services?.length
            ? condensed.services
            : (Array.isArray(narrative.services) ? narrative.services : null),
          technologies: condensed?.technologies?.length
            ? condensed.technologies
            : (Array.isArray(narrative.technologies) ? narrative.technologies : null),
          good_fit: condensed?.good_fit ?? (Array.isArray(narrative.good_fit) ? narrative.good_fit : null),
          bad_fit: condensed?.bad_fit ?? (Array.isArray(narrative.bad_fit) ? narrative.bad_fit : null),
          value_propositions: condensed?.value_propositions ?? (Array.isArray(narrative.value_propositions) ? narrative.value_propositions : null),
          competitors_enriched: Array.isArray(narrative.competitors_enriched)
            ? narrative.competitors_enriched
            : null,
          apollo_firmographics: Object.keys(apollo).length > 0 ? apollo : null,
          apify_firmographics: apifyRaw,
        };

        // ── Step 6: Upsert into user_company ──────────────────────────────
        const { data: existing } = await supabase
          .from('user_company')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        let result;
        if (existing) {
          const { data, error } = await supabase
            .from('user_company')
            .update(mergedData)
            .eq('id', existing.id)
            .select()
            .single();
          if (error) throw error;
          result = data;
        } else {
          const { data, error } = await supabase
            .from('user_company')
            .insert({ user_id: user.id, user_email: user.email, ...mergedData })
            .select()
            .single();
          if (error) throw error;
          result = data;
        }

        console.log('[analyze-and-store-stream] Done. employee_count:', result.employee_count,
          'follower_count:', result.follower_count, 'funding_stage:', result.funding_stage);

        emit('done', result as Record<string, unknown>);
        safeClose();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        if (!message.includes('Controller is already closed')) {
          console.error('[analyze-and-store-stream] Fatal error:', message);
        }
        emit('error', { message });
        safeClose();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
