/**
 * Shared icp-audit logic. Used by:
 * - `POST /api/agent/icp-priorities` — returns the raw individual priorities for the
 *   agent inbox on `/icps`
 * - `GET /api/today/priorities` (aggregator) — collapses the same raw priorities into
 *   a single grouped TodayPriority for /today's agenda
 *
 * Owns the Claude call + the JSON-validation guard so the prompt isn't duplicated.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { completeLlm } from '@/lib/llm-client';
import { recordLlmUsageEvent } from '@/lib/llm-usage';
import { redactInternalIdsFromAgentUserText } from '@/lib/agent-redact';
import { ROUTES } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

// Provider routing happens in lib/llm-client (`feature: 'icp_audit'`).
// Defaults to Haiku 4.5 on both routes — plenty for structured-output audits
// that ask for JSON not deep reasoning.

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
  icpLabels: string[];
}


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
 * Stable hash of the user's full ICP set + their company profile + dismissed-priority ids.
 * Used to skip the Claude call when nothing relevant has changed since the last audit —
 * the cache holds the hash that produced its priorities, and we only re-run when the
 * current data hashes to something different.
 *
 * Includes `updated_at` so even an in-place edit to one ICP busts the hash, but ignores
 * fields that change without affecting the audit (e.g. reenrichment status).
 */
function hashAuditInputs(args: {
  myCompany: Record<string, unknown> | null;
  icps: Array<Record<string, unknown>>;
  dismissedIds: string[];
}): string {
  const companyKey =
    args.myCompany
      ? [
          args.myCompany['id'],
          args.myCompany['updated_at'] ?? args.myCompany['created_at'],
        ].join(':')
      : 'none';
  const icpKeys = args.icps
    .map((row) => [row['id'], row['updated_at'] ?? row['created_at']].join(':'))
    .sort()
    .join('|');
  const dismissals = [...args.dismissedIds].sort().join(',');
  const input = `c=${companyKey};i=${icpKeys};d=${dismissals}`;
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `audit_${Math.abs(h).toString(36)}`;
}

/** Cheap heuristic: compute just the inputs-hash without running Claude. */
export async function getIcpAuditHash(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const [companyRes, icpsRes, dismissalsRes] = await Promise.all([
    supabase.from('user_company').select('id, updated_at, created_at').eq('user_id', userId).maybeSingle(),
    supabase
      .from('icps')
      .select('id, updated_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('agent_priority_dismissals')
      .select('priority_id')
      .eq('user_id', userId)
      .eq('source', 'icp-audit'),
  ]);
  return hashAuditInputs({
    myCompany: (companyRes.data as Record<string, unknown> | null) ?? null,
    icps: (icpsRes.data as Array<Record<string, unknown>> | null) ?? [],
    dismissedIds: ((dismissalsRes.data ?? []) as Array<{ priority_id: string }>).map((r) => r.priority_id),
  });
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
      "detail": "ONE short sentence — max 25 words, max 150 characters. State the issue plainly. NEVER list every field or write paragraphs. The user already sees the cards; explain just why this matters.",
      "cta": {
        "label": "Short button text (max 22 chars) like 'Merge them', 'Draft an ICP', 'Tighten it'",
        "seedPrompt": "Natural-language opener for the company-criteria agent chat. Name ICPs by creation order plus title only, e.g. 'ICP 2 (Preclinical Multi-Modality Drug Discovery CRO) and ICP 3 (…)'. Never include hyphenated UUIDs or '(id: …)' parentheses — the UI must stay free of raw database ids."
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

    const completion = await completeLlm({
      feature: 'icp_audit',
      prompt,
      system:
        'You output only the JSON object specified by the user. No prose before or after. No markdown fences. The JSON must parse cleanly on the first try.',
      maxTokens: 1500,
    });

    await recordLlmUsageEvent({
      userId,
      userEmail,
      provider: completion.provider,
      feature: 'icp_priorities_audit',
      route: '/api/agent/icp-priorities',
      model: completion.model,
      usage: completion.usage,
    });

    const raw = completion.text.trim();
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
        // Hard cap on detail length so even if the model overshoots the prompt we don't
        // render a paragraph. Cuts to the end of the previous sentence/word if possible
        // so the trim doesn't look mid-thought.
        const rawDetail =
          typeof e.detail === 'string'
            ? redactInternalIdsFromAgentUserText(e.detail.trim())
            : '';
        const detail = (() => {
          const MAX = 150;
          if (rawDetail.length <= MAX) return rawDetail;
          // Prefer cutting at the end of the first sentence.
          const sentenceEnd = rawDetail.slice(0, MAX).search(/[.!?](?:\s|$)/);
          if (sentenceEnd > 60) return rawDetail.slice(0, sentenceEnd + 1).trim();
          // Otherwise cut at the last word boundary inside the limit and add an ellipsis.
          const wordCut = rawDetail.slice(0, MAX).replace(/\s+\S*$/, '').trim();
          return `${wordCut}…`;
        })();
        const ctaRaw = e.cta && typeof e.cta === 'object' ? (e.cta as Record<string, unknown>) : {};
        const ctaLabel = typeof ctaRaw.label === 'string' ? ctaRaw.label.trim() : '';
        const ctaSeed =
          typeof ctaRaw.seedPrompt === 'string'
            ? redactInternalIdsFromAgentUserText(ctaRaw.seedPrompt.trim())
            : '';
        const icpIdsRaw = Array.isArray(e.icpIds) ? (e.icpIds as unknown[]) : [];
        const icpIds = icpIdsRaw.filter((v): v is string => typeof v === 'string' && validIcpIds.has(v));
        // Pills always show position labels ("ICP 1", "ICP 5"). Short, unambiguous, and the
        // full names are already mentioned in the headline. Falls back to "ICP ?" if the id
        // somehow doesn't resolve (shouldn't happen because of the validIcpIds filter above).
        const icpLabels = icpIds.map((id) => {
          const idx = (icps as Array<{ id: string }>).findIndex((icp) => icp.id === id);
          return idx >= 0 ? `ICP ${idx + 1}` : 'ICP ?';
        });
        if (!headline || !ctaLabel || !ctaSeed) return null;
        return {
          id: hashPriority(kind, icpIds),
          kind,
          severity,
          headline,
          detail,
          cta: { label: ctaLabel, seedPrompt: ctaSeed },
          icpIds,
          icpLabels,
        };
      })
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
 * user has already dismissed two on `/icps`.
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
