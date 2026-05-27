import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase-server';
import { isMissingColumnError } from '@/lib/supabase-column-compat';

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };

  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return code === '42P01' || message.includes('does not exist');
}

function isSchemaUnavailableError(error: unknown): boolean {
  return isMissingColumnError(error) || isMissingRelationError(error);
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

type ScoreRow = {
  icp_id: string;
  final_score: number | null;
  raw_score: number | null;
  score_cap: number | null;
  coverage: number | null;
  company_type_match_status: string | null;
  breakdown: Record<string, unknown> | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const companyResult = await supabase
      .from('companies')
      .select(
        'id, matched_icp_id, company_fit_score, company_fit_breakdown, company_fit_coverage, company_fit_scored_at, company_fit_version, company_fit_summary',
      )
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (companyResult.error && isSchemaUnavailableError(companyResult.error)) {
      return NextResponse.json({
        data: null,
        unavailable: true,
        message: 'Company-fit details are not available until the latest database migration is applied.',
      });
    }

    if (companyResult.error) {
      console.error('Error fetching company fit summary:', companyResult.error);
      return NextResponse.json({ error: 'Failed to load company fit summary.' }, { status: 500 });
    }

    if (!companyResult.data) {
      return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
    }

    const company = companyResult.data as Record<string, unknown>;

    const scoreResult = await supabase
      .from('company_icp_scores')
      .select(
        'icp_id, final_score, raw_score, score_cap, coverage, company_type_match_status, breakdown',
      )
      .eq('company_id', id)
      .eq('user_id', user.id)
      .order('final_score', { ascending: false });

    const schemaUnavailable = Boolean(scoreResult.error && isSchemaUnavailableError(scoreResult.error));

    if (scoreResult.error && !schemaUnavailable) {
      console.error('Error fetching company-vs-ICP scores:', scoreResult.error);
      return NextResponse.json({ error: 'Failed to load company fit details.' }, { status: 500 });
    }

    const scoreRows = ((scoreResult.data || []) as ScoreRow[]).map((row) => ({
      ...row,
      breakdown: normalizeObject(row.breakdown),
    }));

    const icpIds = [...new Set(scoreRows.map((row) => row.icp_id).filter(Boolean))];
    const matchedIcpId =
      typeof company.matched_icp_id === 'string' && company.matched_icp_id.trim()
        ? company.matched_icp_id
        : null;

    let namesById = new Map<string, string | null>();
    let indexById = new Map<string, number>();

    const icpResult = await supabase
      .from('icps')
      .select('id, name, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (icpResult.error) {
      console.warn('Error fetching ICP names for company fit:', icpResult.error);
    } else {
      const allIcps = ((icpResult.data || []) as Array<{ id: string; name: string | null }>)
        .filter((row) => typeof row.id === 'string');
      indexById = new Map(allIcps.map((row, i) => [row.id, i + 1]));
      namesById = new Map(allIcps.map((row) => [row.id, row.name ?? null]));
    }

    const winnerRow =
      (matchedIcpId
        ? scoreRows.find((row) => row.icp_id === matchedIcpId)
        : null) || scoreRows[0] || null;

    return NextResponse.json({
      data: {
        company_id: id,
        company_fit_score: normalizeNumber(company.company_fit_score),
        company_fit_coverage: normalizeNumber(company.company_fit_coverage),
        company_fit_scored_at:
          typeof company.company_fit_scored_at === 'string' ? company.company_fit_scored_at : null,
        company_fit_version:
          typeof company.company_fit_version === 'string' ? company.company_fit_version : null,
        company_fit_summary:
          typeof company.company_fit_summary === 'string' ? company.company_fit_summary : null,
        matched_icp_id: matchedIcpId,
        matched_icp_name: matchedIcpId ? namesById.get(matchedIcpId) ?? null : null,
        winning_breakdown:
          normalizeObject(company.company_fit_breakdown) ?? winnerRow?.breakdown ?? null,
        icp_scores: scoreRows.map((row) => ({
          icp_id: row.icp_id,
          icp_name: namesById.get(row.icp_id) ?? null,
          icp_index: indexById.get(row.icp_id) ?? null,
          final_score: normalizeNumber(row.final_score),
          raw_score: normalizeNumber(row.raw_score),
          score_cap: normalizeNumber(row.score_cap),
          coverage: normalizeNumber(row.coverage),
          company_type_match_status: row.company_type_match_status ?? null,
          breakdown: row.breakdown,
        })),
      },
      unavailable: schemaUnavailable,
      message: schemaUnavailable
        ? 'Per-ICP score rows are not available until the latest database migration is applied.'
        : null,
    });
  } catch (error) {
    console.error('Error in GET /api/companies/[id]/fit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
