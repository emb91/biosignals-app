import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase-server';
import { isMissingColumnError } from '@/lib/supabase-column-compat';

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
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

const COMPONENT_KEYS = [
  'company_type',
  'platform_category',
  'therapeutic_areas',
  'modalities',
  'development_stages',
  'company_size',
  'funding',
] as const;

function pct01(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${pct}%`;
}

function simplifyBreakdown(breakdown: Record<string, unknown> | null): Record<string, unknown> {
  if (!breakdown) return {};
  const components = breakdown.components;
  if (!components || typeof components !== 'object' || Array.isArray(components)) return {};

  const out: Record<string, unknown> = {};
  for (const key of COMPONENT_KEYS) {
    const raw = (components as Record<string, unknown>)[key];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const c = raw as Record<string, unknown>;
    if (!c.active) continue;
    const matched = Array.isArray(c.matchedValues)
      ? (c.matchedValues as string[]).filter(Boolean).slice(0, 10)
      : undefined;
    const unmatched = Array.isArray(c.unmatchedValues)
      ? (c.unmatchedValues as string[]).filter(Boolean).slice(0, 6)
      : undefined;
    out[key] = {
      label: typeof c.label === 'string' ? c.label : key,
      contribution: pct01(normalizeNumber(c.score01)),
      summary: typeof c.detail === 'string' ? c.detail : undefined,
      matched_values: matched?.length ? matched : undefined,
      not_matched: unmatched?.length ? unmatched : undefined,
    };
  }
  return out;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ summary: null as string | null, skipped: true });
    }

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
      .select('id, company_name, matched_icp_id, company_fit_score, company_fit_breakdown')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (companyResult.error && isSchemaUnavailableError(companyResult.error)) {
      return NextResponse.json({ summary: null as string | null, skipped: true });
    }

    if (companyResult.error || !companyResult.data) {
      return NextResponse.json(
        { error: companyResult.error ? 'Failed to load company.' : 'Company not found.' },
        { status: companyResult.error ? 500 : 404 },
      );
    }

    const company = companyResult.data as Record<string, unknown>;
    const companyName =
      typeof company.company_name === 'string' && company.company_name.trim()
        ? company.company_name.trim()
        : 'This company';

    const scoreResult = await supabase
      .from('company_icp_scores')
      .select(
        'icp_id, final_score, raw_score, score_cap, coverage, company_type_match_status, breakdown',
      )
      .eq('company_id', id)
      .eq('user_id', user.id)
      .order('final_score', { ascending: false });

    if (scoreResult.error && !isSchemaUnavailableError(scoreResult.error)) {
      console.error('Error fetching company-vs-ICP scores for summary:', scoreResult.error);
      return NextResponse.json({ error: 'Failed to load fit data.' }, { status: 500 });
    }

    const scoreRows = ((scoreResult.data || []) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      breakdown: normalizeObject(row.breakdown as unknown as Record<string, unknown> | null),
    }));

    const icpResult = await supabase
      .from('icps')
      .select('id, name, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    let namesById = new Map<string, string | null>();
    let indexById = new Map<string, number>();
    if (!icpResult.error && icpResult.data) {
      const allIcps = (icpResult.data as Array<{ id: string; name: string | null }>).filter(
        (row) => typeof row.id === 'string',
      );
      indexById = new Map(allIcps.map((row, i) => [row.id, i + 1]));
      namesById = new Map(allIcps.map((row) => [row.id, row.name ?? null]));
    }

    const matchedIcpId =
      typeof company.matched_icp_id === 'string' && company.matched_icp_id.trim()
        ? company.matched_icp_id
        : null;

    const winnerRow =
      (matchedIcpId ? scoreRows.find((row) => row.icp_id === matchedIcpId) : null) || scoreRows[0] || null;

    const tableBreakdown = normalizeObject(company.company_fit_breakdown as unknown as Record<string, unknown>);
    const winnerBreakdown =
      winnerRow?.breakdown && typeof winnerRow.breakdown === 'object' ? winnerRow.breakdown : null;
    const combinedBreakdown = winnerBreakdown ?? tableBreakdown;

    const companyFitScore = normalizeNumber(company.company_fit_score);
    const winnerFinal =
      normalizeNumber(winnerRow?.final_score as unknown) ?? companyFitScore;

    if (winnerFinal == null && !combinedBreakdown) {
      return NextResponse.json({
        summary: `${companyName} does not have ICP fit scores yet. Scores appear after enrichment and matching complete.`,
      });
    }

    const icpId = (winnerRow?.icp_id as string) || matchedIcpId;
    const icpName = icpId ? namesById.get(icpId) ?? null : null;
    const icpIndex = icpId ? indexById.get(icpId) ?? null : null;
    const icpLabel =
      icpName && icpName.trim()
        ? `"${icpName.trim()}"`
        : icpIndex != null
          ? `ICP ${icpIndex}`
          : 'the matched ICP';

    const simplifiedCriteria = simplifyBreakdown(combinedBreakdown);
    const hasCriteria = Object.keys(simplifiedCriteria).length > 0;

    const payload = {
      company: companyName,
      winning_icp: icpLabel,
      overall_fit: pct01(winnerFinal),
      table_fit: companyFitScore != null && companyFitScore !== winnerFinal ? pct01(companyFitScore) : undefined,
      company_type_match: typeof winnerRow?.company_type_match_status === 'string'
        ? winnerRow.company_type_match_status
        : undefined,
      criteria: hasCriteria ? simplifiedCriteria : null,
    };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const userPrompt = `Here is structured scoring output from our ICP engine (ideal customer profile fit for life science sales). Write 2 or 3 sentences for a rep who is looking at this company record.

Explain which ICP profile the company lines up with, the overall fit percentage, and what dimensions drove the score (use plain names like company type, therapeutic areas, modalities, funding, company size, or development stage, only where the criteria object includes them). If criteria is empty or sparse, rely on the percentages and keep the explanation high level.

Data (JSON):
${JSON.stringify(payload, null, 2)}

Rules for your reply:
- Plain English only, no bullet points, no markdown.
- Do not use em dashes; use commas or periods.
- Stay faithful to the numbers and keys in the JSON; do not invent ICP rules or matches that are not supported by the criteria object.
- Refer to the company by the name given in "company".
- End with a period.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 220,
      temperature: 0.35,
      system:
        'You write concise, accurate explanations for B2B sales users in life sciences. Output only the explanation sentences requested. No preamble or labels.',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const block = message.content[0];
    const text = block?.type === 'text' ? block.text.trim() : '';
    const summary = text.replace(/\s+/g, ' ').trim() || null;

    return NextResponse.json({ summary });
  } catch (error) {
    console.error('Error in POST /api/companies/[id]/fit-summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
