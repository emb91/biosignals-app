/**
 * Conference PRESENTER delta sync — populates the shared appearances mirror.
 *
 * Mirrors sync-conference-delta.ts (the exhibitor delta): for each active
 * conference of an agenda platform with a cracked adapter, fetch the named
 * appearances and resolve EACH one — at ingest, once, shared across users — to:
 *   • a canonical COMPANY (from affiliation_raw) via buildCompanyMentionMatches
 *     + verifiedMentionCompanyIds — the SAME helpers the exhibitor delta uses.
 *   • a canonical PERSON (from speaker_name + affiliation) via the two-factor
 *     guard in presenter-resolution.ts: the "Last F" token must match a person
 *     at a tracked company AND that company must appear in the affiliation.
 *
 * The resolved ids + provenance are stamped onto conference_appearances_local
 * (mentioned_company_ids/matches + mentioned_contact_ids/matches). The per-user
 * monitor (run-presenter-monitor.ts) then reads the mirror by contact id and
 * never re-resolves.
 *
 * NO EMAIL CAPTURE — the signal is who + session + company + when. Contact
 * MATCHING, not contact acquisition. (abstract_url is kept as evidence only.)
 *
 * Expired conferences (>21d after end) are skipped. Platforms without a cracked
 * adapter are skipped cleanly. Do NOT apply DB writes from an agent run.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { conferencePhase } from '../conference-phase';
import {
  buildCompanyMentionMatches,
  verifiedMentionCompanyIds,
} from '@/lib/companies/mention-provenance';
import { eventScribeAdapter } from './eventscribe-adapter';
import { informaAgendaAdapter } from './informa-agenda-adapter';
import {
  normalizedSpeakerToken,
  resolvePresenterPeople,
  type PersonTokenCandidate,
} from './presenter-resolution';
import type {
  AppearanceRecord,
  ConferenceForAppearanceFetch,
  PresenterPlatform,
  PresenterSourceAdapter,
} from './types';

type Admin = ReturnType<typeof createAdminClient>;

export const PRESENTER_SOURCE = 'conference_presenter';

/** Adapter registry — keyed by agenda platform (eventScribe + Informa cracked). */
const PRESENTER_ADAPTERS: Partial<Record<PresenterPlatform, PresenterSourceAdapter>> = {
  eventscribe: eventScribeAdapter,
  informa: informaAgendaAdapter,
};

export function getPresenterAdapter(
  platform: PresenterPlatform,
): PresenterSourceAdapter | null {
  return PRESENTER_ADAPTERS[platform] ?? null;
}

type ConferenceRow = {
  id: string;
  name: string;
  agenda_platform: string | null;
  agenda_source_url: string | null;
  platform_params: Record<string, unknown> | null;
  start_date: string | null;
  end_date: string | null;
};

export type PresenterSyncResult = {
  conferences_polled: number;
  conferences_skipped: number;
  appearances_upserted: number;
  people_resolved: number;
  companies_resolved: number;
  failures: Array<{ conference_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Build the global token→person-candidate index used for the person resolver.
 * Every canonical person with a company_id is keyed by their "Last F" token; the
 * company row supplies the name + aliases for the affiliation cross-check.
 *
 * Cross-user/global by design — the mirror is shared. The per-user monitor later
 * scopes to the requesting user's own contacts.
 */
async function buildPersonTokenIndex(
  admin: Admin,
): Promise<Map<string, PersonTokenCandidate[]>> {
  const index = new Map<string, PersonTokenCandidate[]>();

  // Pull people with a company_id, in pages.
  const companyIds = new Set<string>();
  type PersonRow = { id: string; full_name: string | null; company_id: string | null };
  const people: PersonRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('people')
      .select('id, full_name, company_id')
      .not('full_name', 'is', null)
      .not('company_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`people query: ${error.message}`);
    const rows = (data ?? []) as PersonRow[];
    for (const r of rows) {
      if (r.company_id) companyIds.add(r.company_id);
      people.push(r);
    }
    if (rows.length < PAGE) break;
  }

  // Company name + aliases for the affiliation cross-check.
  const companyInfo = new Map<string, { name: string; aliases: string[] }>();
  const idList = [...companyIds];
  for (let i = 0; i < idList.length; i += 500) {
    const slice = idList.slice(i, i + 500);
    const { data, error } = await admin
      .from('companies')
      .select('id, company_name, aliases')
      .in('id', slice);
    if (error) throw new Error(`companies query: ${error.message}`);
    for (const r of (data ?? []) as Array<{
      id: string;
      company_name: string | null;
      aliases: string[] | null;
    }>) {
      if (r.company_name) {
        companyInfo.set(r.id, {
          name: r.company_name,
          aliases: (r.aliases ?? []).filter(Boolean) as string[],
        });
      }
    }
  }

  for (const p of people) {
    const fullName = p.full_name?.trim();
    if (!fullName || !p.company_id) continue;
    const info = companyInfo.get(p.company_id);
    if (!info) continue;
    const token = normalizedSpeakerToken(fullName);
    if (!token) continue;
    const arr = index.get(token) ?? [];
    arr.push({
      personId: p.id,
      companyId: p.company_id,
      companyName: info.name,
      companyAliases: info.aliases,
    });
    index.set(token, arr);
  }

  return index;
}

/** Max conferences polled per cron run (bounds runtime; the schedule rotates). */
const PRESENTER_SYNC_BATCH = 5;

export async function syncPresentersDelta(params: {
  admin: Admin;
  /** Restrict to specific conferences (else a rotating batch with an agenda URL). */
  conferenceIds?: string[];
  /** Override the per-run batch size. */
  limit?: number;
}): Promise<PresenterSyncResult> {
  const { admin } = params;

  const { data: runRow } = await admin
    .from('conference_appearance_sync_runs')
    .insert({ status: 'running' })
    .select('id')
    .single<{ id: string }>();
  const runId = runRow?.id ?? null;

  const result: PresenterSyncResult = {
    conferences_polled: 0,
    conferences_skipped: 0,
    appearances_upserted: 0,
    people_resolved: 0,
    companies_resolved: 0,
    failures: [],
  };

  let query = admin
    .from('conferences')
    .select('id,name,agenda_platform,agenda_source_url,platform_params,start_date,end_date');
  if (params.conferenceIds?.length) {
    query = query.in('id', params.conferenceIds);
  } else {
    // Bound per-run work (see sync-conference-delta.ts): only shows with an agenda
    // URL, skip clearly-expired, least-recently-polled first, capped per run.
    const expiryCutoff = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
    query = query
      .not('agenda_source_url', 'is', null)
      .or(`end_date.is.null,end_date.gte.${expiryCutoff}`)
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(params.limit ?? PRESENTER_SYNC_BATCH);
  }
  const { data: confs, error } = await query;
  if (error) throw new Error(`conferences query: ${error.message}`);

  const now = new Date();

  // Build the person index once for the whole run (it is global).
  const personIndex = await buildPersonTokenIndex(admin);

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    try {
      if (!conf.agenda_platform || !conf.agenda_source_url) {
        result.conferences_skipped += 1;
        continue;
      }
      if (conferencePhase(conf.start_date, conf.end_date, now) === 'expired') {
        result.conferences_skipped += 1;
        continue;
      }
      const adapter = getPresenterAdapter(conf.agenda_platform as PresenterPlatform);
      if (!adapter) {
        result.conferences_skipped += 1;
        continue;
      }

      const fetchInput: ConferenceForAppearanceFetch = {
        id: conf.id,
        name: conf.name,
        agendaPlatform: conf.agenda_platform as PresenterPlatform,
        agendaSourceUrl: conf.agenda_source_url,
        platformParams: (conf.platform_params ?? undefined) as
          | Record<string, string | number>
          | undefined,
      };
      const appearances = await adapter.fetchAppearances(fetchInput);

      // Dedupe within the conference by (speaker token, session) — one resolve
      // per distinct appearance. NULL session still gets a row.
      const byKey = new Map<string, AppearanceRecord>();
      for (const a of appearances) {
        const token = normalizedSpeakerToken(a.speakerName) ?? a.speakerName.toLowerCase();
        const key = `${token}|${a.sessionTitle ?? ''}`;
        if (!byKey.has(key)) byKey.set(key, a);
      }

      // Resolve distinct affiliations once (company resolver), reuse across rows.
      const affiliationCache = new Map<
        string,
        { ids: string[]; matches: unknown }
      >();

      const rows: Record<string, unknown>[] = [];
      for (const a of byKey.values()) {
        const speakerNorm = normalizedSpeakerToken(a.speakerName);

        // ── Company resolver (from affiliation_raw) ──────────────────────────
        let companyIds: string[] = [];
        let companyMatches: unknown = null;
        const aff = a.affiliationRaw?.trim();
        if (aff) {
          const cached = affiliationCache.get(aff.toLowerCase());
          if (cached) {
            companyIds = cached.ids;
            companyMatches = cached.matches;
          } else {
            const matches = await buildCompanyMentionMatches(admin, [
              { sourceText: aff, sourceField: 'affiliation' },
            ]);
            companyIds = verifiedMentionCompanyIds(matches);
            companyMatches = matches as unknown;
            affiliationCache.set(aff.toLowerCase(), { ids: companyIds, matches: companyMatches });
          }
        }
        if (companyIds.length) result.companies_resolved += 1;

        // ── Person resolver (two-factor: token + affiliation matches company) ─
        const people = resolvePresenterPeople(a.speakerName, a.affiliationRaw, personIndex);
        const contactIds = people.map((p) => p.personId);
        const contactMatches = people.map((p) => ({
          source_field: 'speaker_name',
          source_text: a.speakerName,
          person_id: p.personId,
          company_id: p.companyId,
          company_name: p.companyName,
          resolved_by: 'token_plus_affiliation',
          confidence: 'medium',
          verified: true,
          verification_reason: p.verificationReason,
          // NO published_email — contact MATCHING only, never acquisition.
        }));
        if (contactIds.length) result.people_resolved += 1;

        rows.push({
          conference_id: conf.id,
          speaker_name_raw: a.speakerName,
          speaker_name_normalized: speakerNorm,
          speaker_title: a.speakerTitle ?? null,
          appearance_type: a.appearanceType,
          session_title: a.sessionTitle ?? null,
          affiliation_raw: a.affiliationRaw ?? null,
          abstract_url: a.abstractUrl ?? null,
          source: PRESENTER_SOURCE,
          source_url: a.sourceUrl,
          mentioned_company_ids: companyIds.length ? companyIds : null,
          mentioned_company_matches: companyMatches,
          mentioned_contact_ids: contactIds.length ? contactIds : null,
          mentioned_contact_matches: contactMatches.length ? (contactMatches as unknown) : null,
          fetched_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        });
      }

      for (let i = 0; i < rows.length; i += 500) {
        const { error: upErr } = await admin
          .from('conference_appearances_local')
          .upsert(rows.slice(i, i + 500), {
            onConflict: 'conference_id,speaker_name_normalized,session_title',
          });
        if (upErr) throw new Error(`upsert: ${upErr.message}`);
      }

      result.appearances_upserted += rows.length;
      await admin
        .from('conferences')
        .update({ last_polled_at: now.toISOString() })
        .eq('id', conf.id);
      result.conferences_polled += 1;
    } catch (error) {
      result.failures.push({ conference_id: conf.id, error: messageFromUnknown(error) });
    }
  }

  if (runId) {
    await admin
      .from('conference_appearance_sync_runs')
      .update({
        status: result.failures.length ? 'failed' : 'success',
        finished_at: new Date().toISOString(),
        conferences_polled: result.conferences_polled,
        appearances_upserted: result.appearances_upserted,
        error: result.failures.length ? JSON.stringify(result.failures).slice(0, 2000) : null,
      })
      .eq('id', runId);
  }

  return result;
}
