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
import { formatSupabaseWriteError, logApiOperationError } from '@/lib/supabase-column-compat';
import {
  buildUserCompanyMergePayload,
  upsertUserCompanyFromAnalysis,
} from '@/lib/user-company-analyze-merge';
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
        let bytes: Uint8Array;
        try {
          bytes = encodeSSEEvent(event, data);
        } catch (err: unknown) {
          logApiOperationError('[analyze-and-store-stream] SSE encode failed', err, {
            userId: user.id,
            sseEvent: event,
          });
          throw err;
        }
        try {
          controller.enqueue(bytes);
        } catch {
          /* stream closed by client */
        }
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
            logApiOperationError('[analyze-and-store-stream] Claude failed', err, {
              userId: user.id,
              website,
              domain,
            });
          });

        const apolloPromise = enrichOrganizationWithApollo({ company_domain: domain })
          .then((result) => {
            apollo = result as Record<string, unknown>;
            emit('step_apollo', result as Record<string, unknown>);
          })
          .catch((err: unknown) => {
            logApiOperationError('[analyze-and-store-stream] Apollo failed', err, {
              userId: user.id,
              website,
              domain,
            });
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
            logApiOperationError('[analyze-and-store-stream] Apify failed', err, {
              userId: user.id,
              website,
              domain,
              linkedinUrl,
            });
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

        if (taxonomyResult.status === 'rejected') {
          logApiOperationError('[analyze-and-store-stream] taxonomy failed', taxonomyResult.reason, {
            userId: user.id,
            website,
            domain,
          });
        }
        if (condensedResult.status === 'rejected') {
          logApiOperationError('[analyze-and-store-stream] bullet condense failed', condensedResult.reason, {
            userId: user.id,
            website,
            domain,
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

        // ── Step 5–6: Merge (allowlisted columns only) + upsert user_company ─
        const mergedData = buildUserCompanyMergePayload({
          narrative,
          website,
          domain,
          linkedinUrl: linkedinUrl ?? null,
          apollo,
          apify,
          apifyRaw,
          taxonomy,
          condensed,
        });

        const upserted = await upsertUserCompanyFromAnalysis(supabase, user, mergedData);
        if (upserted.error != null || !upserted.data) {
          throw upserted.error ?? new Error('user_company upsert failed');
        }
        const result = upserted.data;

        console.log('[analyze-and-store-stream] Done. employee_count:', result.employee_count,
          'follower_count:', result.follower_count, 'funding_stage:', result.funding_stage);

        emit('done', result as Record<string, unknown>);
        safeClose();
      } catch (err: unknown) {
        const message = formatSupabaseWriteError(err);
        if (!message.includes('Controller is already closed')) {
          logApiOperationError('[analyze-and-store-stream] fatal', err, {
            userId: user.id,
            website,
            domain,
            clientMessage: message,
          });
        }
        emit('error', { message });
        safeClose();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
