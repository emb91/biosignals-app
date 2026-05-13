/**
 * Shared icp-audit logic. Used by:
 * - `POST /api/agent/icp-priorities` — returns the raw individual priorities for the
 *   agent inbox on /company-criteria
 * - `GET /api/today/priorities` (aggregator) — collapses the same raw priorities into
 *   a single grouped TodayPriority for /today's agenda
 *
 * Owns the Claude call + the JSON-validation guard so the prompt isn't duplicated.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { redactInternalIdsFromAgentUserText } from '@/lib/agent-redact';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

const MODEL = 'claude-sonnet-4-6';

export type IcpPriorityKind =
  | 'overlap'
  | 'gap'
  | 'too_broad'
  | 'too_narrow'
  | 'rename'
  | 'other';

export type IcpPrioritySeverity = 'low' | 'medium' | 'high';

export interface IcpPriority {
  id: string;
  kind: IcpPriorityKind;
  severity: IcpPrioritySeverity;
  headline: string;
  detail: string;
  cta: { label: string; seedPrompt: string };
  icpIds: string[];
}

const anthropic = new Anthropic();

function isKind(v: unknown): v is IcpPriorityKind {
  return typeof v === 'string' && ['overlap', 'gap', 'too_broad', 'too_narrow', 'rename', 'other'].includes(v);
}
function isSeverity(v: unknown): v is IcpPrioritySeverity {
  return typeof v === 'string' && ['low', 'medium', 'high'].includes(v);
}

function hashPriority(kind: string, icpIds: string[]): string {
  const sortedIds = [...icpIds].sort().join('|');
  let h = 0;
  const input = `${kind}::${sortedIds}`;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `pri_${Math.abs(h).toString(36)}`;
}

/**
 * Compute the raw icp-audit priorities for the given user. Returns an empty array when
 * the user has no ICPs or the audit yields nothing notable. Never throws — failures
 * (network, Claude, JSON) resolve to []. Caller does its own caching.
 */
export async function computeIcpAuditPriorities(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string | null | undefined,
): Promise<IcpPriority[]> {
  try {
    // Fetch dismissals alongside the source data so we can filter server-side. Both
    // /today and /company-criteria call this path, so dismissals stay consistent.
    const [companyRes, icpsRes, dismissalsRes] = await Promise.all([
      supabase.from('user_company').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('icps')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('agent_priority_dismissals')
        .select('priority_id')
        .eq('user_id', userId)
        .eq('source', 'icp-audit'),
    ]);

    const myCompany = companyRes.data ?? null;
    const icps = icpsRes.data ?? [];
    const dismissedIds = new Set<string>(
      ((dismissalsRes.data ?? []) as Array<{ priority_id: string }>).map((r) => r.priority_id),
    );
    if (icps.length === 0) return [];

    const prompt = `You are running a silent audit of a sales operator's ICP (ideal customer profile) set. Your job is to identify up to 3 things they should look at first, prioritised by severity.

You will be given the user's own company profile and every ICP they've defined. Find issues like:
- **overlap**: two ICPs that share so many criteria (TAs, modalities, sizes, funding) they're effectively redundant — usually a merge candidate
- **gap**: a market the user's company clearly serves (per their products, therapeutic areas, customer segments) but no ICP targets
- **too_broad**: an ICP whose criteria are so loose it would match half the market
- **too_narrow**: an ICP so specific only a handful of companies could fit
- **rename**: an ICP whose name no longer reflects its criteria (e.g. "Oncology Biotech" but the criteria now span 4 TAs)

Return STRICT JSON ONLY in this exact shape — no prose, no backticks, no preamble:

{
  "priorities": [
    {
      "kind": "overlap" | "gap" | "too_broad" | "too_narrow" | "rename" | "other",
      "severity": "high" | "medium" | "low",
      "headline": "One short line (max 70 chars) the user reads first",
      "detail": "1-2 sentences explaining the issue and why it matters, grounded in actual fields you can see",
      "cta": {
        "label": "Short button text (max 22 chars) like 'Merge them', 'Draft an ICP', 'Tighten it'",
        "seedPrompt": "Natural-language opener for the company-criteria chat. Name ICPs by creation order plus title only, e.g. 'ICP 2 (Preclinical Multi-Modality Drug Discovery CRO) and ICP 3 (…)'. Never include hyphenated UUIDs or '(id: …)' parentheses — the UI must stay free of raw database ids."
      },
      "icpIds": ["uuid-of-each-icp-touched-by-this-priority"]
    }
  ]
}

Rules:
- Return at most 3 priorities. Fewer is fine. Zero is fine if nothing notable.
- Sort by severity (high first), then by impact.
- Only flag real issues you can ground in the data. Never invent overlaps or gaps.
- The headline, detail, and seedPrompt must NEVER contain raw UUIDs, database ids, or '(id: …)' suffixes — the operator sees this copy directly.
- The icpIds array MUST list exact UUID values from the ICP data below (machine use only — do not paste them into headline, detail, or seedPrompt).
- If nothing is wrong, return {"priorities": []}.

## The user's company profile
${myCompany ? JSON.stringify(myCompany, null, 2) : '(no profile saved)'}

## The user's ICPs (${icps.length} total)
${JSON.stringify(icps, null, 2)}`;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system:
        'You output only the JSON object specified by the user. No prose before or after. No markdown fences. The JSON must parse cleanly on the first try.',
      messages: [{ role: 'user', content: prompt }],
    });

    await recordLlmUsageEvent({
      userId,
      userEmail,
      provider: 'anthropic',
      feature: 'icp_priorities_audit',
      route: '/api/agent/icp-priorities',
      model: MODEL,
      usage: message.usage,
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let parsed: { priorities?: unknown[] } = {};
    try {
      parsed = JSON.parse(jsonText) as { priorities?: unknown[] };
    } catch (err) {
      console.error('[icp-audit] JSON parse failed:', err, 'raw:', raw.slice(0, 200));
      return [];
    }

    const validIcpIds = new Set(icps.map((row: { id: string }) => row.id));
    const rawList = Array.isArray(parsed.priorities) ? parsed.priorities : [];

    const priorities: IcpPriority[] = rawList
      .map((entry): IcpPriority | null => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const kind = isKind(e.kind) ? e.kind : 'other';
        const severity = isSeverity(e.severity) ? e.severity : 'medium';
        const headline =
          typeof e.headline === 'string'
            ? redactInternalIdsFromAgentUserText(e.headline.trim())
            : '';
        const detail =
          typeof e.detail === 'string'
            ? redactInternalIdsFromAgentUserText(e.detail.trim())
            : '';
        const ctaRaw = e.cta && typeof e.cta === 'object' ? (e.cta as Record<string, unknown>) : {};
        const ctaLabel = typeof ctaRaw.label === 'string' ? ctaRaw.label.trim() : '';
        const ctaSeed =
          typeof ctaRaw.seedPrompt === 'string'
            ? redactInternalIdsFromAgentUserText(ctaRaw.seedPrompt.trim())
            : '';
        const icpIdsRaw = Array.isArray(e.icpIds) ? (e.icpIds as unknown[]) : [];
        const icpIds = icpIdsRaw.filter((v): v is string => typeof v === 'string' && validIcpIds.has(v));
        if (!headline || !ctaLabel || !ctaSeed) return null;
        return {
          id: hashPriority(kind, icpIds),
          kind,
          severity,
          headline,
          detail,
          cta: { label: ctaLabel, seedPrompt: ctaSeed },
          icpIds,
        };
      })
      // Filter out priorities the user has explicitly dismissed. Dismissed ids that no
      // longer match anything (because the underlying ICPs changed) are silently ignored.
      .filter((p): p is IcpPriority => p !== null && !dismissedIds.has(p.id))
      .slice(0, 3);

    return priorities;
  } catch (err) {
    console.error('[icp-audit] computeIcpAuditPriorities failed:', err);
    return [];
  }
}

/**
 * Collapse a list of raw icp-audit priorities into a single grouped TodayPriority for the
 * /today agenda. Returns null when the list is empty so the aggregator can skip the row.
 *
 * Deliberately count-free: the row just says "Review your ICPs" regardless of how many
 * findings sit behind it. Avoids the awkwardness of /today saying "3 flagged" when the
 * user has already dismissed two on /company-criteria.
 */
export function groupIcpAuditForToday(items: IcpPriority[]): TodayPriority | null {
  if (items.length === 0) return null;
  // Highest severity in the bucket dictates the row's severity.
  const sevRank: Record<IcpPrioritySeverity, number> = { high: 3, medium: 2, low: 1 };
  const topSeverity = items.reduce<IcpPrioritySeverity>((acc, p) => {
    return sevRank[p.severity] > sevRank[acc] ? p.severity : acc;
  }, 'low');

  return {
    source: 'icp-audit',
    groupKey: 'default',
    severity: topSeverity,
    title: 'Review your ICPs',
    detail: 'Arcova has some observations about your ICP set — take a look when you have a moment.',
    href: ROUTES.setup.icps,
    cta: 'Open ICPs',
  };
}
