import { NextResponse } from 'next/server';

import { getOrgContext } from '@/lib/org-context';
import { createAdminClient } from '@/lib/supabase-admin';
import { resolveOrgContactAccess } from '@/lib/org-contact-access';
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
  persona_id: string;
  icp_id: string | null;
  final_score: number | null;
  raw_score: number | null;
  coverage: number | null;
  breakdown: Record<string, unknown> | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const admin = createAdminClient();
    const access = await resolveOrgContactAccess({
      id,
      orgId: ctx.orgId,
      userId: ctx.user.id,
      admin,
    });
    if (!access) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
    }

    const contactResult = await admin
      .from('contacts')
      .select(
        'id, scored_against_persona_id, contact_fit_score, contact_fit_breakdown, contact_fit_coverage, contact_fit_scored_at, contact_fit_version',
      )
      .eq('id', access.contactId)
      .eq('user_id', access.ownerUserId)
      .maybeSingle();

    if (contactResult.error && isSchemaUnavailableError(contactResult.error)) {
      return NextResponse.json({
        data: null,
        unavailable: true,
        message: 'Contact-fit details are not available until the latest database migration is applied.',
      });
    }

    if (contactResult.error) {
      console.error('Error fetching contact fit summary:', contactResult.error);
      return NextResponse.json({ error: 'Failed to load contact fit summary.' }, { status: 500 });
    }

    if (!contactResult.data) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
    }

    const contact = contactResult.data as Record<string, unknown>;

    const scoreResult = await admin
      .from('contact_persona_scores')
      .select('persona_id, icp_id, final_score, raw_score, coverage, breakdown')
      .eq('contact_id', access.contactId)
      .eq('user_id', access.ownerUserId)
      .order('final_score', { ascending: false });

    const schemaUnavailable = Boolean(scoreResult.error && isSchemaUnavailableError(scoreResult.error));

    if (scoreResult.error && !schemaUnavailable) {
      console.error('Error fetching contact-vs-persona scores:', scoreResult.error);
      return NextResponse.json({ error: 'Failed to load contact fit details.' }, { status: 500 });
    }

    const scoreRows = ((scoreResult.data || []) as ScoreRow[]).map((row) => ({
      ...row,
      breakdown: normalizeObject(row.breakdown),
    }));

    const personaIds = [...new Set(scoreRows.map((row) => row.persona_id).filter(Boolean))];
    const icpIds = [...new Set(scoreRows.map((row) => row.icp_id).filter(Boolean))] as string[];
    const matchedPersonaId =
      typeof contact.scored_against_persona_id === 'string' && contact.scored_against_persona_id.trim()
        ? contact.scored_against_persona_id
        : null;

    let personaNamesById = new Map<string, { name: string | null; icpId: string | null }>();
    let icpNamesById = new Map<string, string | null>();

    if (personaIds.length > 0) {
      const personaResult = await admin
        .from('personas')
        .select('id, name, icp_id')
        .in('id', personaIds);

      if (personaResult.error) {
        console.warn('Error fetching persona names for contact fit:', personaResult.error);
      } else {
        personaNamesById = new Map(
          ((personaResult.data || []) as Array<{ id: string; name: string | null; icp_id: string | null }>)
            .filter((row) => typeof row.id === 'string')
            .map((row) => [row.id, { name: row.name ?? null, icpId: row.icp_id ?? null }]),
        );
      }
    }

    const derivedIcpIds = [...new Set([
      ...icpIds,
      ...[...personaNamesById.values()].map((row) => row.icpId).filter(Boolean),
    ])] as string[];

    if (derivedIcpIds.length > 0) {
      const icpResult = await admin
        .from('icps')
        .select('id, name')
        .in('id', derivedIcpIds);

      if (icpResult.error) {
        console.warn('Error fetching ICP names for contact fit:', icpResult.error);
      } else {
        icpNamesById = new Map(
          ((icpResult.data || []) as Array<{ id: string; name: string | null }>)
            .filter((row) => typeof row.id === 'string')
            .map((row) => [row.id, row.name ?? null]),
        );
      }
    }

    const winnerRow =
      (matchedPersonaId
        ? scoreRows.find((row) => row.persona_id === matchedPersonaId)
        : null) || scoreRows[0] || null;
    const matchedPersonaMeta = matchedPersonaId ? personaNamesById.get(matchedPersonaId) ?? null : null;

    return NextResponse.json({
      data: {
        contact_id: access.contactId,
        contact_fit_score: normalizeNumber(contact.contact_fit_score),
        contact_fit_coverage: normalizeNumber(contact.contact_fit_coverage),
        contact_fit_scored_at:
          typeof contact.contact_fit_scored_at === 'string' ? contact.contact_fit_scored_at : null,
        contact_fit_version:
          typeof contact.contact_fit_version === 'string' ? contact.contact_fit_version : null,
        scored_against_persona_id: matchedPersonaId,
        matched_persona_name: matchedPersonaMeta?.name ?? null,
        matched_icp_id: matchedPersonaMeta?.icpId ?? null,
        matched_icp_name:
          matchedPersonaMeta?.icpId ? icpNamesById.get(matchedPersonaMeta.icpId) ?? null : null,
        winning_breakdown:
          normalizeObject(contact.contact_fit_breakdown) ?? winnerRow?.breakdown ?? null,
        persona_scores: scoreRows.map((row) => {
          const personaMeta = personaNamesById.get(row.persona_id) ?? null;
          const resolvedIcpId = row.icp_id ?? personaMeta?.icpId ?? null;
          return {
            persona_id: row.persona_id,
            persona_name: personaMeta?.name ?? null,
            icp_id: resolvedIcpId,
            icp_name: resolvedIcpId ? icpNamesById.get(resolvedIcpId) ?? null : null,
            final_score: normalizeNumber(row.final_score),
            raw_score: normalizeNumber(row.raw_score),
            coverage: normalizeNumber(row.coverage),
          };
        }),
      },
      unavailable: schemaUnavailable,
      message: schemaUnavailable
        ? 'Per-persona score rows are not available until the latest database migration is applied.'
        : null,
    });
  } catch (error) {
    console.error('Error in GET /api/contacts/[id]/fit:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
