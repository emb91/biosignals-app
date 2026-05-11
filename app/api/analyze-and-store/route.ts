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

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export async function POST(request: NextRequest) {
  let logCtx: { userId?: string; website?: string; domain?: string | null } = {};
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logCtx = { ...logCtx, userId: user.id };

    const { website } = await request.json() as { website?: string };
    if (!website) {
      return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
    }

    const domain = normalizeDomain(website);
    logCtx = { ...logCtx, website, domain };
    console.log('[analyze-and-store] Analysing', website, '| domain:', domain);

    // ── Step 1: Claude web_search + Apollo org enrich in parallel ─────────────
    const [claudeResult, apolloResult] = await Promise.allSettled([
      analyseCompanyWithClaude(website),
      enrichOrganizationWithApollo({ company_domain: domain }),
    ]);

    const narrative =
      claudeResult.status === 'fulfilled' ? claudeResult.value : {};
    const apollo =
      apolloResult.status === 'fulfilled' ? apolloResult.value : {};

    if (claudeResult.status === 'rejected') {
      logApiOperationError('[analyze-and-store] Claude failed', claudeResult.reason, {
        userId: user.id,
        website,
        domain,
      });
    }
    if (apolloResult.status === 'rejected') {
      logApiOperationError('[analyze-and-store] Apollo failed', apolloResult.reason, {
        userId: user.id,
        website,
        domain,
      });
    }

    // ── Step 2: Resolve LinkedIn URL — Apollo first, Claude fallback ──────────
    const linkedinUrl =
      normalizeLinkedInCompanyUrl(
        typeof apollo.company_linkedin_url === 'string' ? apollo.company_linkedin_url : null,
      ) ??
      normalizeLinkedInCompanyUrl(
        typeof narrative.linkedin_url === 'string' ? narrative.linkedin_url : null,
      );

    // ── Step 3: Apify LinkedIn scrape (sequential — needs LinkedIn URL) ────────
    let apifyRaw: Record<string, unknown> | null = null;

    if (linkedinUrl) {
      console.log('[analyze-and-store] Scraping LinkedIn:', linkedinUrl);
      apifyRaw = await scrapeLinkedInCompany(linkedinUrl).catch((err: unknown) => {
        logApiOperationError('[analyze-and-store] Apify failed', err, {
          userId: user.id,
          website,
          domain,
          linkedinUrl,
        });
        return null;
      });
    } else {
      console.log('[analyze-and-store] No LinkedIn URL found — skipping Apify');
    }

    const apify = extractApifyFirmographics(apifyRaw);

    // ── Step 4: Taxonomy + bullet condensing — run in parallel ───────────────
    const companyNameForTaxonomy =
      typeof narrative.company_name === 'string' ? narrative.company_name :
      typeof apollo.company_name === 'string' ? apollo.company_name : '';

    console.log('[analyze-and-store] Running taxonomy + bullet condensing in parallel');
    const [taxonomyResult, condensedResult] = await Promise.allSettled([
      (companyNameForTaxonomy || domain)
        ? resolveCompanyTaxonomy({
            company_name: companyNameForTaxonomy,
            domain,
            apify_company_firmographics: apifyRaw,
            apollo_company_firmographics: Object.keys(apollo).length > 0
              ? (apollo as Record<string, unknown>)
              : null,
          })
        : Promise.resolve(null),
      condenseBulletArrays({
        company_name: companyNameForTaxonomy || undefined,
        customers_we_serve: Array.isArray(narrative.customers_we_serve)
          ? (narrative.customers_we_serve as string[])
          : undefined,
        good_fit: Array.isArray(narrative.good_fit)
          ? (narrative.good_fit as string[])
          : undefined,
        bad_fit: Array.isArray(narrative.bad_fit)
          ? (narrative.bad_fit as string[])
          : undefined,
        value_propositions: Array.isArray(narrative.value_propositions)
          ? (narrative.value_propositions as string[])
          : undefined,
        products: Array.isArray(narrative.products)
          ? (narrative.products as string[])
          : undefined,
        services: Array.isArray(narrative.services)
          ? (narrative.services as string[])
          : undefined,
        technologies: Array.isArray(narrative.technologies)
          ? (narrative.technologies as string[])
          : undefined,
      }),
    ]);

    const taxonomy = taxonomyResult.status === 'fulfilled' ? taxonomyResult.value : null;
    const condensed = condensedResult.status === 'fulfilled' ? condensedResult.value : null;

    if (taxonomyResult.status === 'rejected') {
      logApiOperationError('[analyze-and-store] taxonomy failed', taxonomyResult.reason, {
        userId: user.id,
        website,
        domain,
      });
    }
    if (condensedResult.status === 'rejected') {
      logApiOperationError('[analyze-and-store] bullet condense failed', condensedResult.reason, {
        userId: user.id,
        website,
        domain,
      });
    }

    // ── Step 5–6: Merge (allowlisted) + upsert user_company ─────────────────
    const mergedData = buildUserCompanyMergePayload({
      narrative: narrative as Record<string, unknown>,
      website,
      domain,
      linkedinUrl: linkedinUrl ?? null,
      apollo: apollo as Record<string, unknown>,
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

    console.log('[analyze-and-store] Done. employee_count:', result.employee_count,
      'follower_count:', result.follower_count, 'funding_stage:', result.funding_stage);

    return NextResponse.json(result);
  } catch (error) {
    logApiOperationError('[analyze-and-store] error', error, {
      ...(logCtx.userId ? { userId: logCtx.userId } : {}),
      ...(logCtx.website ? { website: logCtx.website } : {}),
      ...(logCtx.domain !== undefined ? { domain: logCtx.domain } : {}),
    });
    return NextResponse.json(
      { error: formatSupabaseWriteError(error) },
      { status: 500 },
    );
  }
}
