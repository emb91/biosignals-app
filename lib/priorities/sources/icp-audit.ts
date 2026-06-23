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

// Provider routing happens in lib/llm-client (`feature: 'icp_audit'`).
// Defaults to Haiku 4.5 on both routes — plenty for structured-output audits
// that ask for JSON not deep reasoning.

// Only the CRITERIA columns the audit actually reasons over. Deliberately
// EXCLUDES the heavy jsonb blobs (`example_company_enrichment`, `competitors`)
// and the re-enrichment status columns — pulling `*` made each call ~99k input
// tokens (the example_company_enrichment blob dominated) for a task that only
// compares ICP criteria. This is the single biggest lever on this feature's cost.
const AUDIT_ICP_COLUMNS =
  'id, name, therapeutic_areas, funding_stages, company_type, modalities, ' +
  'development_stages, company_sizes, example_companies, li_follower_sizes, ' +
  'icp_summary, example_company_url, customer_therapeutic_areas, customer_modalities, ' +
  'customer_development_stages, platform_category, target_customers, buyer_types, ' +
  'created_at, updated_at';

// The user's own company profile for "gap" detection — the offering/market
// fields only. Excludes the heavy jsonb blobs (apollo_firmographics,
// apify_firmographics, competitors_enriched) that the audit never reads.
const AUDIT_COMPANY_COLUMNS =
  'id, company_name, description, products_services, services, target_customers, ' +
  'value_propositions, industries, technologies, customers_we_serve, why_customers_buy, ' +
  'differentiated_value, capabilities, good_fit, bad_fit, therapeutic_areas, modalities, ' +
  'development_stages, company_type, customer_therapeutic_areas, customer_modalities, ' +
  'customer_development_stages, platform_category, buyer_prerequisites, buyer_disqualifiers, ' +
  'updated_at, created_at';

// The criteria fields whose CONTENT defines whether an audit needs re-running.
// The hash is built from these values (not the row's `updated_at`) so that
// re-enrichment status writes — which bump `updated_at` without changing any
// criterion — no longer bust the cache and trigger a needless (paid) re-audit.
const AUDIT_HASH_FIELDS = [
  'name', 'therapeutic_areas', 'funding_stages', 'company_type', 'modalities',
  'development_stages', 'company_sizes', 'example_companies',
  'li_follower_sizes', 'icp_summary', 'customer_therapeutic_areas',
  'customer_modalities', 'customer_development_stages', 'platform_category',
  'target_customers', 'buyer_types',
] as const;

/** Stable, order-insensitive signature of one ICP's audit-relevant criteria. */
function canonicalIcpCriteria(row: Record<string, unknown>): string {
  return AUDIT_HASH_FIELDS.map((f) => {
    const v = row[f];
    if (Array.isArray(v)) return `${f}=[${[...v].map((x) => String(x)).sort().join(',')}]`;
    return `${f}=${v == null ? '' : String(v)}`;
  }).join(';');
}

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
  // Company key still uses updated_at (one row, low churn, and its profile edits
  // genuinely should re-audit). ICP keys use CRITERIA CONTENT, not updated_at —
  // so re-enrichment status churn doesn't bust the cache.
  const companyKey =
    args.myCompany
      ? [
          args.myCompany['id'],
          args.myCompany['updated_at'] ?? args.myCompany['created_at'],
        ].join(':')
      : 'none';
  const icpKeys = args.icps
    .map((row) => `${row['id']}:${canonicalIcpCriteria(row)}`)
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
      .select(AUDIT_ICP_COLUMNS)
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
      supabase.from('user_company').select(AUDIT_COMPANY_COLUMNS).eq('user_id', userId).maybeSingle(),
      supabase
        .from('icps')
        .select(AUDIT_ICP_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('agent_priority_dismissals')
        .select('priority_id')
        .eq('user_id', userId)
        .eq('source', 'icp-audit'),
    ]);

    // Cast: select() with a runtime column-list string can't infer row types,
    // so Supabase returns GenericStringError[]. The columns are real (AUDIT_ICP_COLUMNS).
    const myCompany = (companyRes.data as Record<string, unknown> | null) ?? null;
    const icps = (icpsRes.data as Array<Record<string, unknown>> | null) ?? [];
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

    const validIcpIds = new Set(icps.map((row) => row.id as string));
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
          const idx = icps.findIndex((icp) => (icp.id as string) === id);
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

// NOTE: /today no longer groups the audit live. The audit now persists a note via
// writeIcpNote (lib/priorities/sources/icp-note) and /today reads it — no LLM on /today.
