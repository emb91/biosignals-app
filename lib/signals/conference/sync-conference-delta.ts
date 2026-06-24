/**
 * Conference exhibitor delta sync — populates the shared mirror.
 *
 * Mirrors sync-nih-grants-delta.ts: pull the external source (per-platform
 * adapter) into the local mirror (conference_exhibitors_local) and resolve each
 * exhibitor name to a canonical company AT INGEST (once, shared across users),
 * stamping mentioned_company_ids + mentioned_company_matches. The per-user
 * monitor then reads the mirror by company id — it never re-resolves.
 *
 * Conferences are loaded from the `conferences` registry. Expired conferences
 * (>21d after end, conference-phase.ts) are skipped. Platforms without a cracked
 * adapter (terrapinn, swapcard) are skipped cleanly.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import { getConferenceAdapter } from './adapters';
import type { ConferencePlatform } from './adapters/types';
import { conferencePhase } from './conference-phase';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import {
  buildCompanyMentionMatches,
  verifiedMentionCompanyIds,
} from '@/lib/companies/mention-provenance';

type Admin = ReturnType<typeof createAdminClient>;

export const CONFERENCE_SOURCE = 'conference_exhibitor';

type ConferenceRow = {
  id: string;
  name: string;
  platform: string;
  exhibitor_source_url: string | null;
  platform_params: Record<string, unknown> | null;
  start_date: string | null;
  end_date: string | null;
};

export type ConferenceSyncResult = {
  conferences_polled: number;
  conferences_skipped: number;
  exhibitors_upserted: number;
  failures: Array<{ conference_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function syncConferenceDelta(params: {
  admin: Admin;
  /** Restrict to specific conferences (else all registry rows). */
  conferenceIds?: string[];
}): Promise<ConferenceSyncResult> {
  const { admin } = params;
  const startedAt = new Date();

  const { data: runRow } = await admin
    .from('conference_exhibitor_sync_runs')
    .insert({ status: 'running' })
    .select('id')
    .single<{ id: string }>();
  const runId = runRow?.id ?? null;

  let query = admin
    .from('conferences')
    .select('id,name,platform,exhibitor_source_url,platform_params,start_date,end_date');
  if (params.conferenceIds?.length) query = query.in('id', params.conferenceIds);
  const { data: confs, error } = await query;
  if (error) throw new Error(`conferences query: ${error.message}`);

  const result: ConferenceSyncResult = {
    conferences_polled: 0,
    conferences_skipped: 0,
    exhibitors_upserted: 0,
    failures: [],
  };
  const now = new Date();

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    try {
      if (conferencePhase(conf.start_date, conf.end_date, now) === 'expired') {
        result.conferences_skipped += 1;
        continue;
      }
      const adapter = getConferenceAdapter(conf.platform as ConferencePlatform);
      if (!adapter) {
        result.conferences_skipped += 1;
        continue;
      }

      const exhibitors = await adapter.fetchExhibitors({
        id: conf.id,
        name: conf.name,
        platform: conf.platform as ConferencePlatform,
        exhibitorSourceUrl: conf.exhibitor_source_url ?? '',
        platformParams: (conf.platform_params ?? undefined) as
          | Record<string, string | number>
          | undefined,
      });

      // Resolve each exhibitor name → canonical company (with provenance), at
      // ingest. De-dup by normalized name within the conference first so we
      // resolve each distinct name once.
      const byNorm = new Map<string, (typeof exhibitors)[number]>();
      for (const ex of exhibitors) {
        const norm = normalizeCompanyForMatching(ex.name);
        if (norm && !byNorm.has(norm)) byNorm.set(norm, ex);
      }

      const rows: Record<string, unknown>[] = [];
      for (const [norm, ex] of byNorm) {
        const matches = await buildCompanyMentionMatches(admin, [
          { sourceText: ex.name, sourceField: 'company_name' },
        ]);
        const ids = verifiedMentionCompanyIds(matches);
        rows.push({
          conference_id: conf.id,
          company_name_raw: ex.name,
          company_name_normalized: norm,
          booth: ex.booth ?? null,
          website: ex.website ?? null,
          category: ex.category ?? null,
          source: CONFERENCE_SOURCE,
          source_url: ex.sourceUrl,
          mentioned_company_ids: ids.length ? ids : null,
          mentioned_company_matches: matches as unknown,
          fetched_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        });
      }

      for (let i = 0; i < rows.length; i += 500) {
        const { error: upErr } = await admin
          .from('conference_exhibitors_local')
          .upsert(rows.slice(i, i + 500), { onConflict: 'conference_id,company_name_normalized' });
        if (upErr) throw new Error(`upsert: ${upErr.message}`);
      }

      result.exhibitors_upserted += rows.length;
      await admin.from('conferences').update({ last_polled_at: now.toISOString() }).eq('id', conf.id);
      result.conferences_polled += 1;
    } catch (error) {
      result.failures.push({ conference_id: conf.id, error: messageFromUnknown(error) });
    }
  }

  if (runId) {
    await admin
      .from('conference_exhibitor_sync_runs')
      .update({
        status: result.failures.length ? 'failed' : 'success',
        finished_at: new Date().toISOString(),
        conferences_polled: result.conferences_polled,
        exhibitors_upserted: result.exhibitors_upserted,
        error: result.failures.length ? JSON.stringify(result.failures).slice(0, 2000) : null,
      })
      .eq('id', runId);
  }

  void startedAt;
  return result;
}
