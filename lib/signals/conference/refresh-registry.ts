/**
 * Conference registry-refresh monitor — keeps the `conferences` table current.
 *
 * The exhibitor + presenter pollers only ever read the edition a registry row
 * points at. Rows are seeded manually, so when next year's edition of a recurring
 * show publishes the row still aims at last year's (now dead) URL/eventId/dates
 * and the pollers quietly pull nothing. This sync detects the live edition per
 * platform and refreshes the row so the existing pollers stay pointed at it.
 *
 * Mirrors sync-conference-delta.ts exactly: bounded rotating batch
 * (least-recently-refreshed first, per-run cap via env), a best-effort
 * sync-runs row, per-row failure isolation, and a structured result. It writes
 * ONLY existing columns on `conferences` (event_url, exhibitor_source_url,
 * agenda_source_url, platform_params, start_date, end_date, updated_at) — no
 * schema change.
 *
 * Per-platform edition resolution (registry-refresh-helpers.ts):
 *   • templated (mapyourshow, smallworldlabs) — derive the next-year candidate
 *     source-key, probe it for real data, and rewrite the row to it if live.
 *   • stable (terrapinn, informa) — re-fetch the year-stable page and read the
 *     current edition's dates off it, updating start/end if they changed.
 *   • manual (everything else, incl. abstractsonline's opaque eventId) — left
 *     unchanged and RECORDED as unresolved so it surfaces for manual seeding.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import type { ConferencePlatform } from './adapters/types';
import { conferenceFetch } from './fetch';
import {
  bumpYearToken,
  extractEditionDates,
  harvesterEventKey,
  harvesterIndexUrl,
  looksLikeLiveEdition,
  mapYourShowProbeUrl,
  nextEditionSourceKey,
  parseHarvesterEventIds,
  refreshStrategyForPlatform,
  smallWorldLabsProbeUrl,
} from './registry-refresh-helpers';

type Admin = ReturnType<typeof createAdminClient>;

/** Max registry rows refreshed per cron run (bounds runtime; the schedule rotates). */
const REGISTRY_REFRESH_BATCH = 8;

type ConferenceRow = {
  id: string;
  name: string;
  platform: string;
  event_url: string | null;
  exhibitor_source_url: string | null;
  agenda_source_url: string | null;
  platform_params: Record<string, unknown> | null;
  start_date: string | null;
  end_date: string | null;
};

export type RegistryRefreshResult = {
  rows_checked: number;
  rows_refreshed: number;
  /** Rows we couldn't confidently resolve — surfaced for manual seeding. */
  rows_unresolved: Array<{ conference_id: string; name: string; platform: string; reason: string }>;
  failures: Array<{ conference_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Replace the year-bearing host label of a full URL (event_url) when present. */
function bumpYearInUrl(url: string | null | undefined, by = 1): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const [first, ...rest] = u.hostname.split('.');
    const bumped = bumpYearToken(first, by);
    if (!bumped) return null;
    u.hostname = [bumped, ...rest].join('.');
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve a TEMPLATED-platform row to its live next edition, if published.
 * Derives the next-year source-key, probes the page for real data, and (only on
 * a confident live hit) returns the column patch pointing the row at it. Returns
 * null when the next edition isn't live yet (the common case mid-cycle) so the
 * caller leaves the row unchanged.
 */
async function resolveTemplatedEdition(
  conf: ConferenceRow,
): Promise<{ patch: Record<string, unknown>; toEdition: string } | null> {
  const platform = conf.platform as ConferencePlatform;
  const nextKey = nextEditionSourceKey(platform, conf.exhibitor_source_url);
  if (!nextKey) return null;

  const probeUrl =
    platform === 'mapyourshow'
      ? mapYourShowProbeUrl(nextKey)
      : smallWorldLabsProbeUrl(nextKey);

  const res = await conferenceFetch(probeUrl, { redirect: 'follow' });
  const body = await res.text();
  if (!looksLikeLiveEdition(res.status, body)) return null;

  const patch: Record<string, unknown> = { exhibitor_source_url: nextKey };
  // Bump the year token in the other URL columns so the whole row moves together.
  const nextEventUrl = bumpYearInUrl(conf.event_url);
  if (nextEventUrl && nextEventUrl !== conf.event_url) patch.event_url = nextEventUrl;
  const nextAgendaUrl = bumpYearInUrl(conf.agenda_source_url);
  if (nextAgendaUrl && nextAgendaUrl !== conf.agenda_source_url) patch.agenda_source_url = nextAgendaUrl;

  // Pull the new edition's dates off the probed page when we can; otherwise leave
  // dates for the next stable re-check (the source-key move is the win here).
  const dates = extractEditionDates(body);
  if (dates.startDate) patch.start_date = dates.startDate;
  if (dates.endDate) patch.end_date = dates.endDate;

  return { patch, toEdition: nextKey };
}

/**
 * Resolve a STABLE-URL row by re-fetching its year-stable page and reading the
 * current edition's dates. Returns a date patch only when the dates actually
 * changed (so we don't churn updated_at on a no-op), or null when no confident
 * date could be read.
 */
async function resolveStableEdition(
  conf: ConferenceRow,
): Promise<{ patch: Record<string, unknown> } | null> {
  const pageUrl = conf.event_url || conf.exhibitor_source_url;
  if (!pageUrl) return null;
  const res = await conferenceFetch(pageUrl, { redirect: 'follow' });
  if (!res.ok) return null;
  const body = await res.text();
  const dates = extractEditionDates(body);
  if (!dates.startDate) return null;

  const patch: Record<string, unknown> = {};
  if (dates.startDate !== conf.start_date) patch.start_date = dates.startDate;
  if (dates.endDate && dates.endDate !== conf.end_date) patch.end_date = dates.endDate;
  if (Object.keys(patch).length === 0) return null;
  return { patch };
}

/**
 * Resolve a CONFERENCE HARVESTER row by re-scraping its floorplan index page for
 * the row's existing EventKey and refreshing the derived EventID/EventClientID
 * (and dates) into the row when they've changed — i.e. when the society rolled the
 * floorplan over to a new edition AT THE SAME EventKey. Returns null when nothing
 * changed (no-op) or the index can't be read. See parseHarvesterEventIds for the
 * caveat: a brand-new EventKey per edition is NOT caught here (stays unresolved).
 */
async function resolveHarvesterEdition(
  conf: ConferenceRow,
): Promise<{ patch: Record<string, unknown> } | null> {
  const eventKey = harvesterEventKey(conf.exhibitor_source_url);
  if (!eventKey) return null;
  const res = await conferenceFetch(harvesterIndexUrl(eventKey), { redirect: 'follow' });
  if (!res.ok) return null;
  const body = await res.text();
  const { eventId, eventClientId } = parseHarvesterEventIds(body);
  if (!eventId || !eventClientId) return null;

  const currentId =
    conf.platform_params?.eventId != null ? String(conf.platform_params.eventId) : null;
  const currentClientId =
    conf.platform_params?.eventClientId != null ? String(conf.platform_params.eventClientId) : null;

  const patch: Record<string, unknown> = {};
  if (eventId !== currentId || eventClientId !== currentClientId) {
    // Keep ids as strings to match the seed convention; preserve any other params.
    patch.platform_params = { ...(conf.platform_params ?? {}), eventId, eventClientId };
  }
  const dates = extractEditionDates(body);
  if (dates.startDate && dates.startDate !== conf.start_date) patch.start_date = dates.startDate;
  if (dates.endDate && dates.endDate !== conf.end_date) patch.end_date = dates.endDate;

  if (Object.keys(patch).length === 0) return null;
  return { patch };
}

export async function refreshConferenceRegistry(params: {
  admin: Admin;
  /** Restrict to specific conferences (else a rotating batch of registry rows). */
  conferenceIds?: string[];
  /** Override the per-run batch size (default REGISTRY_REFRESH_BATCH). */
  limit?: number;
}): Promise<RegistryRefreshResult> {
  const { admin } = params;

  const { data: runRow } = await admin
    .from('conference_registry_refresh_runs')
    .insert({ status: 'running' })
    .select('id')
    .single<{ id: string }>();
  const runId = runRow?.id ?? null;

  let query = admin
    .from('conferences')
    .select(
      'id,name,platform,event_url,exhibitor_source_url,agenda_source_url,platform_params,start_date,end_date',
    );
  if (params.conferenceIds?.length) {
    query = query.in('id', params.conferenceIds);
    // Bound per-run work so the cron can't time out as the registry grows. Rotate
    // on the dedicated last_refreshed_at cursor — least-recently-refreshed first
    // (nulls, i.e. never-refreshed rows, first) — and cap the batch. EVERY checked
    // row is stamped below (even manual/unresolved ones), so the batch always
    // advances and the monthly schedule walks the whole registry over runs.
    query = query
      .order('last_refreshed_at', { ascending: true, nullsFirst: true })
      .limit(params.limit ?? REGISTRY_REFRESH_BATCH);
  }
  const { data: confs, error } = await query;
  if (error) throw new Error(`conferences query: ${error.message}`);

  const result: RegistryRefreshResult = {
    rows_checked: 0,
    rows_refreshed: 0,
    rows_unresolved: [],
    failures: [],
  };
  const now = new Date();
  const nowIso = now.toISOString();

  // Stamp the rotation cursor on a checked row. Called for EVERY row (resolved,
  // unresolved, manual, or failed) so the bounded batch always advances and the
  // same rows don't get re-picked next run. Best-effort: a stamp failure must not
  // mask the row's real outcome.
  const stamp = async (id: string, extra?: Record<string, unknown>) => {
    try {
      await admin
        .from('conferences')
        .update({ last_refreshed_at: nowIso, ...extra })
        .eq('id', id);
    } catch {
      /* non-fatal */
    }
  };

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    result.rows_checked += 1;
    const strategy = refreshStrategyForPlatform(conf.platform);
    try {
      if (strategy === 'manual') {
        result.rows_unresolved.push({
          conference_id: conf.id,
          name: conf.name,
          platform: conf.platform,
          reason: 'no programmatic edition signal for platform',
        });
        await stamp(conf.id);
        continue;
      }

      const resolved =
        strategy === 'templated'
          ? await resolveTemplatedEdition(conf)
          : strategy === 'harvester'
            ? await resolveHarvesterEdition(conf)
            : await resolveStableEdition(conf);

      if (!resolved) {
        const reason =
          strategy === 'templated'
            ? 'next edition not live yet'
            : strategy === 'harvester'
              ? 'no new EventKeys on index page (same edition, or new EventKey not yet linked)'
              : 'no confident edition date on page';
        result.rows_unresolved.push({
          conference_id: conf.id,
          name: conf.name,
          platform: conf.platform,
          reason,
        });
        await stamp(conf.id);
        continue;
      }

      // Fold the rotation stamp into the same write as the edition patch.
      const { error: upErr } = await admin
        .from('conferences')
        .update({ ...resolved.patch, updated_at: nowIso, last_refreshed_at: nowIso })
        .eq('id', conf.id);
      if (upErr) throw new Error(`update: ${upErr.message}`);
      result.rows_refreshed += 1;
    } catch (error) {
      result.failures.push({ conference_id: conf.id, error: messageFromUnknown(error) });
      // Stamp even on failure so a persistently-failing row can't jam the batch.
      await stamp(conf.id);
    }
  }

  if (runId) {
    await admin
      .from('conference_registry_refresh_runs')
      .update({
        status: result.failures.length ? 'failed' : 'success',
        finished_at: new Date().toISOString(),
        rows_checked: result.rows_checked,
        rows_refreshed: result.rows_refreshed,
        rows_unresolved: result.rows_unresolved.length,
        error: result.failures.length ? JSON.stringify(result.failures).slice(0, 2000) : null,
      })
      .eq('id', runId);
  }

  return result;
}
