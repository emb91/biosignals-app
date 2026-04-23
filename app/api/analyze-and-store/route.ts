import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { enrichOrganizationWithApollo } from '@/lib/apollo';
import {
  analyseCompanyWithClaude,
  scrapeLinkedInCompany,
  extractApifyFirmographics,
  normalizeLinkedInCompanyUrl,
} from '@/lib/my-company-enrichment';

function normalizeDomain(value?: string | null): string | null {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { website } = await request.json() as { website?: string };
    if (!website) {
      return NextResponse.json({ error: 'Website URL is required' }, { status: 400 });
    }

    const domain = normalizeDomain(website);
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
      console.error('[analyze-and-store] Claude failed:', claudeResult.reason);
    }
    if (apolloResult.status === 'rejected') {
      console.error('[analyze-and-store] Apollo failed:', apolloResult.reason);
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
        console.error('[analyze-and-store] Apify failed:', err);
        return null;
      });
    } else {
      console.log('[analyze-and-store] No LinkedIn URL found — skipping Apify');
    }

    const apify = extractApifyFirmographics(apifyRaw);

    // ── Step 4: Merge — narrative + firmographics ─────────────────────────────
    // Preference: Apollo for business/funding data; Apify for social/LinkedIn data.
    // Claude supplies all narrative array fields.
    const { linkedin_url: _claudeLinkedin, ...narrativeRest } = narrative;
    void _claudeLinkedin;

    const mergedData = {
      // Narrative (Claude)
      ...narrativeRest,

      // Meta
      website,
      domain,
      analyzed_at: new Date().toISOString(),
      status: 'completed',

      // Resolved LinkedIn URL
      linkedin_url: linkedinUrl ?? null,

      // Firmographic scalars
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

      // Raw blobs
      apollo_firmographics: Object.keys(apollo).length > 0 ? apollo : null,
      apify_firmographics: apifyRaw,
    };

    // ── Step 5: Upsert into company_analyses ──────────────────────────────────
    const { data: existing } = await supabase
      .from('company_analyses')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('company_analyses')
        .update(mergedData)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('company_analyses')
        .insert({ user_id: user.id, user_email: user.email, ...mergedData })
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    console.log('[analyze-and-store] Done. employee_count:', result.employee_count,
      'follower_count:', result.follower_count, 'funding_stage:', result.funding_stage);

    return NextResponse.json(result);
  } catch (error) {
    console.error('[analyze-and-store] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
