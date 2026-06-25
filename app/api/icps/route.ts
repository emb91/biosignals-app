import { createClient } from '@/lib/supabase-server';
import { after, NextResponse } from 'next/server';
import { orgIdForUser, getOrgContext, canEditOrgSetup } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOrgEntitlements } from '@/lib/billing/entitlements';
import { getPostHogClient } from '@/lib/posthog-server';
import { rescoreAllContactsForUser } from '@/lib/rescore';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';
import { parsePlatformCategoryInput } from '@/lib/platform-category';
import { normalizeIcpTaxonomyPayload } from '@/lib/icp-taxonomy';
import {
  isMissingColumnError,
  withoutPlatformCategory,
  withoutIcpSegmentColumns,
} from '@/lib/supabase-column-compat';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Org-scoped: every seat sees the org's shared ICPs. For a solo owner this returns
    // the same rows as a user_id filter (their ICPs carry their org_id). Falls back to
    // user-scope only if membership is somehow missing.
    const orgId = await orgIdForUser(supabase, user.id);

    let query = supabase.from('icps').select('*').order('created_at', { ascending: false });
    query = orgId ? query.eq('org_id', orgId) : query.eq('user_id', user.id);
    const { data, error } = await query;

    if (error) {
      console.error('Error fetching ICPs:', error);
      return NextResponse.json({ error: 'Failed to fetch ICPs' }, { status: 500 });
    }

    const normalized = (data || []).map((row) => normalizePlatformTaxonomyFields(row as Record<string, unknown>));
    return NextResponse.json({ data: normalized });
  } catch (error) {
    console.error('Error in GET /api/icps:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = (await request.json()) as { id?: string };
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Visibility is enforced by RLS: a member may delete their OWN (personal) ICP;
    // owner/admin may delete company-wide ('org') ICPs. Deleting an ICP the caller may
    // not touch simply removes 0 rows. So just target the id and let RLS decide.
    const { error } = await supabase.from('icps').delete().eq('id', id);

    if (error) {
      console.error('Error deleting ICP:', error);
      return NextResponse.json({ error: 'Failed to delete ICP' }, { status: 500 });
    }

    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[icps DELETE] Background lead-fit rescore failed:', err),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/icps:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const exampleCompanyUrl =
      typeof body.exampleCompanyUrl === 'string' ? body.exampleCompanyUrl.trim() : '';
    if (!exampleCompanyUrl) {
      return NextResponse.json(
        {
          error:
            'exampleCompanyUrl is required — every ICP must be modelled on a reference company',
        },
        { status: 400 },
      );
    }

    const {
      value: platformCategory,
      error: platformCategoryError,
    } = parsePlatformCategoryInput(body.platformCategory);
    if (platformCategoryError) {
      return NextResponse.json({ error: platformCategoryError }, { status: 400 });
    }

    // Stamp org_id + scope. Owner/admin create company-wide ('org') ICPs the whole org
    // sees; members create 'personal' ICPs visible only to them. RLS enforces the same.
    const ctx = await getOrgContext();
    const orgId = ctx?.orgId ?? (await orgIdForUser(supabase, user.id));
    const scope = ctx && canEditOrgSetup(ctx.role) ? 'org' : 'personal';

    if (orgId) {
      const [entitlements, { count, error: countError }] = await Promise.all([
        getOrgEntitlements(orgId),
        createAdminClient()
          .from('icps')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId),
      ]);
      if (countError) {
        console.error('Error counting ICPs for cap:', countError);
        return NextResponse.json({ error: 'Failed to check ICP allowance' }, { status: 500 });
      }
      const used = count ?? 0;
      const limit = entitlements.caps.activeIcps;
      if (used >= limit) {
        return NextResponse.json(
          {
            code: 'icp_limit_reached',
            error: `Your ${entitlements.planName} plan includes ${limit} active ICP${limit === 1 ? '' : 's'}. Delete an existing ICP or upgrade to add another.`,
            used,
            limit,
            plan: entitlements.planKey,
          },
          { status: 402 },
        );
      }
    }

    const taxonomy = normalizeIcpTaxonomyPayload(body as Record<string, unknown>);
    const icpData = {
      user_id: user.id,
      org_id: orgId,
      scope,
      user_email: user.email,
      name: body.name || '',
      icp_summary: body.icpSummary || null,
      company_type: taxonomy.company_type,
      platform_category: platformCategory,
      therapeutic_areas: taxonomy.therapeutic_areas,
      modalities: taxonomy.modalities,
      development_stages: taxonomy.development_stages,
      customer_therapeutic_areas: taxonomy.customer_therapeutic_areas,
      customer_modalities: taxonomy.customer_modalities,
      customer_development_stages: taxonomy.customer_development_stages,
      company_sizes: taxonomy.company_sizes,
      li_follower_sizes: taxonomy.li_follower_sizes,
      funding_stages: taxonomy.funding_stages,
      example_companies: body.exampleCompanies || [],
      example_company_url: exampleCompanyUrl,
      example_company_enrichment: body.exampleCompanyEnrichment ?? null,
      target_customers: Array.isArray(body.targetCustomers) ? body.targetCustomers : [],
      buyer_types: Array.isArray(body.buyerTypes) ? body.buyerTypes : [],
      competitors: Array.isArray(body.competitors) ? body.competitors : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let result = await supabase.from('icps').insert(icpData).select().single();

    if (result.error && isMissingColumnError(result.error, 'platform_category')) {
      result = await supabase.from('icps').insert(withoutPlatformCategory(icpData)).select().single();
    }

    if (result.error && isMissingColumnError(result.error, 'target_customers')) {
      result = await supabase.from('icps').insert(withoutIcpSegmentColumns(icpData)).select().single();
    }

    const { data, error } = result;

    if (error) {
      console.error('Error saving ICP:', error);
      return NextResponse.json({ error: 'Failed to save ICP' }, { status: 500 });
    }

    const normalized = normalizePlatformTaxonomyFields(data as Record<string, unknown>);

    rescoreAllContactsForUser(user.id).catch((err) =>
      console.error('[icps POST] Background lead-fit rescore failed:', err),
    );

    getPostHogClient().capture({
      distinctId: user.id,
      event: 'icp_created',
      properties: {
        icp_id: (data as { id?: string }).id,
        icp_name: icpData.name,
        scope,
        company_type: icpData.company_type,
      },
    });
    after(() => getPostHogClient().flush());

    return NextResponse.json({ data: normalized });
  } catch (error) {
    console.error('Error in POST /api/icps:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
