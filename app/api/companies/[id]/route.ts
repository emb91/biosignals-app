import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getOrgContext, orgIdForUser } from '@/lib/org-context';
import { resolveEffectivePriority } from '@/lib/effective-priority';
import {
  formatHubSpotStageLabel,
  HUBSPOT_STATE_PRIORITY,
  resolveContactHubSpotStates,
  type HubSpotLeadState,
} from '@/lib/hubspot-lead-state';

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;
type AccountCrmEntry = {
  state: HubSpotLeadState;
  dealStageLabel: string | null;
  closedAt: string | null;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.details === 'string' && o.details) return o.details;
  }
  return 'Internal server error';
}

/**
 * Whitelist of fields an org member is allowed to override for the org's view
 * of a company. These map to canonical `companies` columns, but manual edits
 * are stored in `org_company_overrides` so teammates share them without writing
 * to global company records.
 *
 * Strings allow null to clear the override; arrays use empty array as "no
 * override" (the view treats missing keys as "no override"). Numbers stored
 * as numbers in JSONB.
 */
const STRING_OVERRIDE_FIELDS = new Set([
  'company_name',
  'website',
  'description',
  'industry',
  'employee_range',
  'headquarters_city',
  'headquarters_country',
  'headquarters_state',
  'clinical_stage',
  'linkedin_url',
  'tagline',
  'bio_summary',
  'company_type',
  'company_type_display',
  'company_size_bucket',
  'platform_category',
  'funding_stage',
]);
const NUMBER_OVERRIDE_FIELDS = new Set([
  'employee_count',
  'founded_year',
]);
const STRING_ARRAY_OVERRIDE_FIELDS = new Set([
  'therapeutic_areas',
  'modalities',
  'development_stages',
  'products_services',
  'services',
]);

function sanitizeOverrides(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    const value = src[key];
    if (STRING_OVERRIDE_FIELDS.has(key)) {
      if (value === null || value === '') continue; // empty clears (we'll delete the key elsewhere)
      if (typeof value === 'string') out[key] = value.trim();
    } else if (NUMBER_OVERRIDE_FIELDS.has(key)) {
      if (value === null) continue;
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(n)) out[key] = n;
    } else if (STRING_ARRAY_OVERRIDE_FIELDS.has(key)) {
      if (!Array.isArray(value)) continue;
      const cleaned = value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean);
      out[key] = cleaned;
    }
    // anything not in a whitelist is silently dropped
  }
  return out;
}

/**
 * Keys the caller explicitly cleared (sent null/'' for). We strip them from
 * the stored JSONB so the view falls back to canonical.
 */
function clearedKeys(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const src = input as Record<string, unknown>;
  const cleared: string[] = [];
  for (const key of Object.keys(src)) {
    if (!STRING_OVERRIDE_FIELDS.has(key) && !NUMBER_OVERRIDE_FIELDS.has(key) && !STRING_ARRAY_OVERRIDE_FIELDS.has(key)) {
      continue;
    }
    const value = src[key];
    if (value === null || value === '') cleared.push(key);
  }
  return cleared;
}

function applyCompanyOverrides<T extends Record<string, unknown>>(row: T, overrides: Record<string, unknown> | null): T {
  if (!overrides) return row;
  const next: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      STRING_OVERRIDE_FIELDS.has(key) ||
      NUMBER_OVERRIDE_FIELDS.has(key) ||
      STRING_ARRAY_OVERRIDE_FIELDS.has(key)
    ) {
      if (value !== null && value !== undefined && value !== '') next[key] = value;
    }
  }
  return next as T;
}

function finiteScoreNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchCompanyCrmStatus(
  supabase: SupabaseLike,
  userId: string,
  companyId: string,
): Promise<AccountCrmEntry | null> {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, email')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .is('archived_at', null);
    if (error || !contacts?.length) return null;

    const contactStates = await resolveContactHubSpotStates(
      supabase,
      userId,
      (contacts as Array<{ id: string; email: string | null }>).map((contact) => ({
        id: contact.id,
        email: contact.email,
      })),
    );

    let best: AccountCrmEntry | null = null;
    for (const resolved of contactStates.values()) {
      if (!best || HUBSPOT_STATE_PRIORITY[resolved.state] > HUBSPOT_STATE_PRIORITY[best.state]) {
        best = {
          state: resolved.state,
          dealStageLabel: formatHubSpotStageLabel(resolved.dealStage),
          closedAt: resolved.modifiedAt ?? null,
        };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * GET: full company detail for a single company (side panel + agent context).
 * Reads from accounts_view for existing scoring/list compatibility, then
 * resolves org_company_overrides over that row for team-shared manual edits.
 * Returns ~50 fields including firmographics, criteria, products, funding,
 * readiness — everything the side panel renders.
 *
 * The list endpoint /api/companies is intentionally lean (~25 fields per row);
 * use this endpoint when a user selects a specific company.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const orgId = await orgIdForUser(supabase, user.id);

    const { data, error } = await supabase
      .from('accounts_view')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    let overrides: Record<string, unknown> | null = null;
    if (orgId) {
      const { data: overrideRow } = await supabase
        .from('org_company_overrides')
        .select('overrides')
        .eq('org_id', orgId)
        .eq('company_id', id)
        .maybeSingle();
      overrides = (overrideRow as { overrides: Record<string, unknown> | null } | null)?.overrides ?? null;
    }

    const row = applyCompanyOverrides(data as Record<string, unknown>, overrides);
    const crmEntry = await fetchCompanyCrmStatus(supabase, user.id, id);
    const priorityPolicy = resolveEffectivePriority({
      intrinsicPriority: finiteScoreNumber(row.priority_score),
      companyFit: finiteScoreNumber(row.company_fit_score),
      intrinsicReadiness: finiteScoreNumber(row.readiness_score) ?? 0,
      crmState: crmEntry?.state ?? null,
      crmClosedAt: crmEntry?.closedAt ?? null,
      crmIsSuppressed:
        crmEntry == null && typeof row.crm_is_suppressed === 'boolean'
          ? row.crm_is_suppressed
          : undefined,
    });

    return NextResponse.json({
      data: {
        ...row,
        raw_readiness_score: row.readiness_score ?? null,
        readiness_score: priorityPolicy.effectiveReadiness,
        priority_score: priorityPolicy.effectivePriority,
        intrinsic_priority_score: priorityPolicy.intrinsicPriority,
        crm_is_suppressed: priorityPolicy.isSuppressed,
        crm_status: crmEntry?.state ?? row.crm_status ?? null,
        crm_deal_stage_label: crmEntry?.dealStageLabel ?? row.crm_deal_stage_label ?? null,
        crm_closed_at: crmEntry?.closedAt ?? row.crm_closed_at ?? null,
      },
    });
  } catch (error) {
    console.error('Error in companies/[id] GET:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await getOrgContext();

    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { overrides?: unknown };
    const incoming = sanitizeOverrides(body.overrides);
    const toClear = clearedKeys(body.overrides);

    const stateSelect = 'source, added_at, updated_at, matched_icp_id, fit_score, company_fit_score, company_fit_breakdown, company_fit_coverage, company_fit_scored_at, company_fit_version, company_fit_summary, customer_therapeutic_areas, customer_modalities, customer_development_stages, crm_is_suppressed, archived_at, archived_by, archived_reason';
    let { data: existing, error: existingError } = await ctx.supabase
      .from('org_companies')
      .select(stateSelect)
      .eq('org_id', ctx.orgId)
      .eq('company_id', id)
      .maybeSingle();

    if (!existing && !existingError) {
      const legacyState = await ctx.supabase
        .from('user_companies')
        .select(stateSelect)
        .eq('user_id', ctx.user.id)
        .eq('company_id', id)
        .maybeSingle();
      existing = legacyState.data;
      existingError = legacyState.error;
    }

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Company not found for this user' }, { status: 404 });
    }

    const { data: existingOverride, error: existingOverrideError } = await ctx.supabase
      .from('org_company_overrides')
      .select('overrides')
      .eq('org_id', ctx.orgId)
      .eq('company_id', id)
      .maybeSingle();

    if (existingOverrideError) {
      return NextResponse.json({ error: existingOverrideError.message }, { status: 500 });
    }

    const current = (existingOverride as { overrides: Record<string, unknown> | null } | null)?.overrides ?? {};
    const next: Record<string, unknown> = { ...current, ...incoming };
    for (const key of toClear) delete next[key];

    const now = new Date().toISOString();

    const { error: stateError } = await ctx.supabase
      .from('org_companies')
      .upsert({
        org_id: ctx.orgId,
        company_id: id,
        source: existing.source,
        added_at: existing.added_at ?? now,
        updated_at: now,
        created_by: ctx.user.id,
        matched_icp_id: existing.matched_icp_id,
        fit_score: existing.fit_score,
        company_fit_score: existing.company_fit_score,
        company_fit_breakdown: existing.company_fit_breakdown,
        company_fit_coverage: existing.company_fit_coverage,
        company_fit_scored_at: existing.company_fit_scored_at,
        company_fit_version: existing.company_fit_version,
        company_fit_summary: existing.company_fit_summary,
        customer_therapeutic_areas: existing.customer_therapeutic_areas,
        customer_modalities: existing.customer_modalities,
        customer_development_stages: existing.customer_development_stages,
        crm_is_suppressed: existing.crm_is_suppressed ?? false,
        archived_at: existing.archived_at,
        archived_by: existing.archived_by,
        archived_reason: existing.archived_reason,
      }, { onConflict: 'org_id,company_id' });

    if (stateError) {
      return NextResponse.json({ error: stateError.message }, { status: 500 });
    }

    const { error: updateError } = await ctx.supabase
      .from('org_company_overrides')
      .upsert({
        org_id: ctx.orgId,
        company_id: id,
        overrides: next,
        overridden_by: ctx.user.id,
        overridden_at: now,
      }, { onConflict: 'org_id,company_id' });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      id,
      overrides: next,
      cleared: toClear,
    });
  } catch (error) {
    console.error('Error in companies/[id] PATCH:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const orgId = await orgIdForUser(supabase, user.id);

    const now = new Date().toISOString();

    if (orgId) {
      await supabase
        .from('org_companies')
        .upsert({
          org_id: orgId,
          company_id: id,
          updated_at: now,
          created_by: user.id,
          archived_at: now,
          archived_by: user.id,
          archived_reason: 'user_archived',
        }, { onConflict: 'org_id,company_id' });
    }

    const { error: companyError } = await supabase
      .from('user_companies')
      .update({
        archived_at: now,
        archived_by: user.id,
        archived_reason: 'user_archived',
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('company_id', id)
      .is('archived_at', null);

    if (companyError) {
      return NextResponse.json({ error: companyError.message }, { status: 500 });
    }

    const { error: contactError } = await supabase
      .from('contacts')
      .update({
        archived_at: now,
        archived_by: user.id,
        archived_reason: 'company_archived',
        updated_at: now,
      })
      .eq('user_id', user.id)
      .eq('company_id', id)
      .is('archived_at', null);

    if (contactError) {
      return NextResponse.json({ error: contactError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id, archived: true });
  } catch (error) {
    console.error('Error in companies/[id] DELETE:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
