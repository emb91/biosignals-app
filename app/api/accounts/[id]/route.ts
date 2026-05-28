import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

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
 * Whitelist of fields a user is allowed to override for their view of an
 * account. These map to columns on `companies` but the edit is stored in
 * `user_companies.user_overrides` (JSONB) so each user has their own view.
 * accounts_view COALESCEs override → canonical when reading.
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

/**
 * GET: full account detail for a single company (side panel + agent context).
 * Reads from accounts_view which COALESCEs user_overrides over canonical.
 * Returns ~50 fields including firmographics, criteria, products, funding,
 * readiness — everything the side panel renders.
 *
 * The list endpoint /api/accounts is intentionally lean (~25 fields per row);
 * use this endpoint when a user selects a specific account.
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
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in accounts/[id] GET:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
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

    const body = (await request.json().catch(() => ({}))) as { overrides?: unknown };
    const incoming = sanitizeOverrides(body.overrides);
    const toClear = clearedKeys(body.overrides);

    // Load the existing user_companies row (must exist — the caller can only
    // edit accounts they own).
    const { data: existing, error: existingError } = await supabase
      .from('user_companies')
      .select('user_overrides')
      .eq('user_id', user.id)
      .eq('company_id', id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: 'Account not found for this user' }, { status: 404 });
    }

    const current = (existing.user_overrides as Record<string, unknown> | null) ?? {};
    const next: Record<string, unknown> = { ...current, ...incoming };
    for (const key of toClear) delete next[key];

    const { error: updateError } = await supabase
      .from('user_companies')
      .update({ user_overrides: next, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('company_id', id);

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
    console.error('Error in accounts/[id] PATCH:', error);
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

    const now = new Date().toISOString();

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
    console.error('Error in accounts/[id] DELETE:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}
