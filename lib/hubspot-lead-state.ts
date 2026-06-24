/**
 * Shared HubSpot lead-state resolution.
 *
 * Used by both /api/contacts (per-contact) and /api/companies (aggregated per company).
 * The companies route feeds all contacts on the page through this and then picks
 * the highest-priority state per company.
 */

import { HUBSPOT_CLOSED_DEAL_STAGES } from '@/lib/hubspot-deals';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HubSpotLeadState = 'active' | 'customer' | 'dormant' | 'context_only' | 'none';

export type ResolvedContactState = {
  state: HubSpotLeadState;
  dealStage: string | null;
  dealName: string | null;
  modifiedAt: string | null;
};

// Highest-priority state wins when aggregating multiple contacts per company.
export const HUBSPOT_STATE_PRIORITY: Record<HubSpotLeadState, number> = {
  customer:     5,
  active:       4,
  context_only: 3,
  dormant:      2,
  none:         1,
};

// ── Label formatting ──────────────────────────────────────────────────────────

/** Maps normalised HubSpot deal stage keys to short human-readable labels. */
const KNOWN_STAGE_LABELS: Record<string, string> = {
  appointmentscheduled: 'Appt set',
  qualifiedtobuy:       'Qualified',
  presentationscheduled:'Presentation',
  decisionmakerboughtin:'Buy-in',
  contractsent:         'Contract',
  closedwon:            'Closed won',
  closedlost:           'Closed lost',
  dealswon:             'Won',
};

export function formatHubSpotStageLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (KNOWN_STAGE_LABELS[normalized]) return KNOWN_STAGE_LABELS[normalized];
  // CamelCase / snake_case → Title Case
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(' ');
}

// ── Core helpers ──────────────────────────────────────────────────────────────

export function hubSpotLeadStateForStage(
  stage: string | null,
  suppressed: boolean,
): HubSpotLeadState {
  const normalized = (stage || '').trim().toLowerCase();
  if (!normalized) return suppressed ? 'context_only' : 'none';
  if (normalized === 'closedwon') return 'customer';
  if (normalized === 'closedlost') return 'dormant';
  if (suppressed) return 'context_only';
  if (HUBSPOT_CLOSED_DEAL_STAGES.has(normalized)) return 'context_only';
  return 'active';
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Given a list of contacts (id + email), resolve the HubSpot lead state for
 * each one.  Uses the same dual-lookup (arcova_contact_id AND hubspot_contact_email)
 * and "most-recently-modified deal wins" logic as attachHubSpotLeadStateBestEffort
 * in /api/contacts.
 *
 * Returns a Map<contactId, ResolvedContactState>.  Contacts with no deal link
 * are omitted from the map (callers can default to 'none').
 *
 * Runs best-effort: throws on hard auth errors but returns empty map on data
 * gaps (no crm tables, empty results, etc.).
 */
export async function resolveContactHubSpotStates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  userId: string,
  contacts: Array<{ id: string; email: string | null }>,
): Promise<Map<string, ResolvedContactState>> {
  if (!contacts.length) return new Map();

  const contactIds = [...new Set(contacts.map((c) => c.id).filter(Boolean))];
  const emails = [
    ...new Set(
      contacts
        .map((c) => c.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e)),
    ),
  ];

  if (!contactIds.length && !emails.length) return new Map();

  try {
    // 1. Dual-lookup — contact ID and email in parallel
    type RawLink = {
      arcova_contact_id: string | null;
      hubspot_deal_id: unknown;
      hubspot_contact_email: string | null;
      raw_payload: unknown;
    };

    const [idLinksResult, emailLinksResult] = await Promise.all([
      contactIds.length
        ? supabase
            .from('crm_deal_contact_links')
            .select('arcova_contact_id, hubspot_deal_id, hubspot_contact_email, raw_payload')
            .eq('user_id', userId)
            .in('arcova_contact_id', contactIds)
        : Promise.resolve({ data: [] as RawLink[], error: null }),
      emails.length
        ? supabase
            .from('crm_deal_contact_links')
            .select('arcova_contact_id, hubspot_deal_id, hubspot_contact_email, raw_payload')
            .eq('user_id', userId)
            .in('hubspot_contact_email', emails)
        : Promise.resolve({ data: [] as RawLink[], error: null }),
    ]);

    if (idLinksResult.error || emailLinksResult.error) return new Map();

    const allLinks: RawLink[] = [
      ...((idLinksResult.data ?? []) as RawLink[]),
      ...((emailLinksResult.data ?? []) as RawLink[]),
    ];

    const dealIds = [
      ...new Set(
        allLinks
          .map((l) => l.hubspot_deal_id != null ? String(l.hubspot_deal_id) : null)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (!dealIds.length) return new Map();

    // 2. Fetch deal stages + company suppression flags
    const [dealsResult, companyLinksResult] = await Promise.all([
      supabase
        .from('crm_deals')
        .select('hubspot_deal_id, deal_name, deal_stage, hs_lastmodifieddate, synced_at')
        .eq('user_id', userId)
        .in('hubspot_deal_id', dealIds),
      supabase
        .from('crm_deal_company_links')
        .select('hubspot_deal_id, raw_payload')
        .eq('user_id', userId)
        .in('hubspot_deal_id', dealIds),
    ]);

    if (dealsResult.error || !dealsResult.data?.length) return new Map();

    type DealRow = {
      hubspot_deal_id: unknown;
      deal_name: string | null;
      deal_stage: string | null;
      hs_lastmodifieddate: string | null;
      synced_at: string | null;
    };
    const dealsById = new Map(
      (dealsResult.data as DealRow[]).map((d) => [String(d.hubspot_deal_id), d]),
    );

    const companyLinksByDealId = new Map(
      ((companyLinksResult.data ?? []) as Array<{ hubspot_deal_id: unknown; raw_payload: unknown }>)
        .map((r) => [String(r.hubspot_deal_id), r]),
    );

    // 3. Build lookup maps: contactId → links, email → links
    const linksByContactId = new Map<string, RawLink[]>();
    const linksByEmail = new Map<string, RawLink[]>();

    for (const link of allLinks) {
      if (typeof link.arcova_contact_id === 'string' && link.arcova_contact_id) {
        const arr = linksByContactId.get(link.arcova_contact_id) ?? [];
        arr.push(link);
        linksByContactId.set(link.arcova_contact_id, arr);
      }
      if (typeof link.hubspot_contact_email === 'string' && link.hubspot_contact_email) {
        const e = link.hubspot_contact_email.trim().toLowerCase();
        const arr = linksByEmail.get(e) ?? [];
        arr.push(link);
        linksByEmail.set(e, arr);
      }
    }

    // 4. For each contact: deduplicate deal links, rank by modifiedAt, pick latest
    const result = new Map<string, ResolvedContactState>();

    for (const contact of contacts) {
      const { id: contactId, email } = contact;
      const emailNorm = email?.trim().toLowerCase() ?? null;

      const candidateLinks = [
        ...(linksByContactId.get(contactId) ?? []),
        ...(emailNorm ? (linksByEmail.get(emailNorm) ?? []) : []),
      ].filter((link) => {
        // Skip links that were detached when the contact's
        // recently_changed_company signal fired — the closed-won / closed-lost
        // status at their OLD employer shouldn't follow them to a new role.
        const payload = (link.raw_payload ?? {}) as Record<string, unknown>;
        return payload.detached_due_to_job_change !== true;
      });

      // Deduplicate on deal ID
      const dedupedLinks = Array.from(
        new Map(
          candidateLinks
            .map((link) => [String(link.hubspot_deal_id), link] as const)
            .filter((entry): entry is readonly [string, RawLink] => Boolean(entry[0])),
        ).values(),
      );

      const rankedDeals = dedupedLinks
        .map((link) => {
          const dealId = String(link.hubspot_deal_id);
          const deal = dealsById.get(dealId);
          if (!deal) return null;

          const companyPayload = (companyLinksByDealId.get(dealId)?.raw_payload ?? {}) as Record<string, unknown>;
          const suppressed =
            companyPayload.resolution_suppressed === true ||
            companyPayload.resolution_suppressed === 'true';

          const modifiedAt =
            typeof deal.hs_lastmodifieddate === 'string'
              ? deal.hs_lastmodifieddate
              : typeof deal.synced_at === 'string'
              ? deal.synced_at
              : null;

          return {
            dealStage: deal.deal_stage,
            dealName: deal.deal_name,
            modifiedAt,
            state: hubSpotLeadStateForStage(deal.deal_stage, suppressed),
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .sort((a, b) => {
          const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
          const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
          return bTime - aTime; // most-recently-modified deal wins
        });

      const latest = rankedDeals[0];
      if (latest) {
        result.set(contactId, {
          state: latest.state,
          dealStage: latest.dealStage,
          dealName: latest.dealName,
          modifiedAt: latest.modifiedAt,
        });
      }
    }

    return result;
  } catch {
    return new Map();
  }
}
