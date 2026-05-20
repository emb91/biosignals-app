/**
 * Sync recently-updated clinical trials from ClinicalTrials.gov into the local
 * clinical_trials table.
 *
 * Uses query.term filter on `lastUpdatePostDate` to pull only trials updated
 * since the cutoff. ~5-10K updates per week globally, so 8-day window is
 * a small fetch.
 *
 * Used by both the daily cron and the admin "clinical-trials" button's
 * optional sync_first step.
 */
import { fetchWithRetry, TokenBucket } from '@/lib/signals/fetch-with-retry';
import { normalizeCompanyForMatching } from '@/lib/signals/company-name-variants';
import type { createAdminClient } from '@/lib/supabase-admin';

const DEFAULT_OVERLAP_DAYS = 8;
const PAGE_SIZE = 1000; // CT.gov supports up to 1000 per page
const MAX_PAGES = 25; // 25K trials max per run — way more than typical weekly volume
const UPSERT_CHUNK = 500;

// ClinicalTrials.gov has no documented limit but ~50 req/sec is well below
// what they consider abusive. Token bucket prevents bursts.
const ctLimiter = new TokenBucket({
  capacity: 25,
  refillPerSecond: 25,
  label: 'clinicaltrials.gov',
});

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function yyyymmddDashed(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type CtStudyRaw = {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: {
      overallStatus?: string;
      lastUpdatePostDateStruct?: { date?: string };
    };
    designModule?: { phases?: string[] };
    conditionsModule?: { conditions?: string[] };
    contactsLocationsModule?: { locations?: Array<unknown> };
    sponsorCollaboratorsModule?: {
      leadSponsor?: { name?: string };
      collaborators?: Array<{ name?: string }>;
    };
  };
};

export type SyncCtDeltaResult = {
  cutoff_date: string;
  trials_upserted: number;
  duration_ms: number;
};

function buildUrl(cutoffIso: string, pageToken: string | null): string {
  const fields = [
    'protocolSection.identificationModule.nctId',
    'protocolSection.identificationModule.briefTitle',
    'protocolSection.statusModule.overallStatus',
    'protocolSection.statusModule.lastUpdatePostDateStruct',
    'protocolSection.designModule.phases',
    'protocolSection.conditionsModule.conditions',
    'protocolSection.contactsLocationsModule.locations',
    'protocolSection.sponsorCollaboratorsModule.leadSponsor',
    'protocolSection.sponsorCollaboratorsModule.collaborators',
  ].join(',');
  // ClinicalTrials.gov v2 API: filter.lastUpdatePostDate accepts a date range.
  const filter = encodeURIComponent(`AREA[LastUpdatePostDate]RANGE[${cutoffIso},MAX]`);
  const base = `https://clinicaltrials.gov/api/v2/studies?query.term=&filter.advanced=${filter}&fields=${encodeURIComponent(fields)}&pageSize=${PAGE_SIZE}`;
  return pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base;
}

async function* paginate(cutoffIso: string): AsyncGenerator<CtStudyRaw[], void, void> {
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = buildUrl(cutoffIso, pageToken);
    const response = await fetchWithRetry(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'ArcovaSignalBot/1.0' },
      label: `clinicaltrials.gov page ${page + 1}`,
      rateLimiter: ctLimiter,
    });
    if (!response.ok) {
      throw new Error(`clinicaltrials.gov request failed (${response.status})`);
    }
    const payload = (await response.json()) as { studies?: CtStudyRaw[]; nextPageToken?: string };
    const studies = Array.isArray(payload.studies) ? payload.studies : [];
    if (studies.length === 0) return;
    yield studies;
    if (!payload.nextPageToken) return;
    pageToken = payload.nextPageToken;
  }
}

function extractCollaborators(study: CtStudyRaw): string[] {
  const raw = study.protocolSection?.sponsorCollaboratorsModule?.collaborators ?? [];
  return raw
    .map((c) => (typeof c?.name === 'string' ? c.name.trim() : ''))
    .filter(Boolean);
}

export async function syncCtDelta(opts: {
  admin: ReturnType<typeof createAdminClient>;
  overlapDays?: number;
}): Promise<SyncCtDeltaResult> {
  const admin = opts.admin;
  const overlapDays = opts.overlapDays ?? DEFAULT_OVERLAP_DAYS;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const cutoffDate = new Date(Date.now() - overlapDays * 24 * 60 * 60 * 1000);
  const cutoffIsoDate = yyyymmddDashed(cutoffDate);

  const { data: runRow, error: runInsertErr } = await admin
    .from('ct_delta_sync_runs')
    .insert({ status: 'running', cutoff_date: cutoffIsoDate, started_at: startedAtIso })
    .select('id')
    .single();
  if (runInsertErr) throw new Error(`ct_delta_sync_runs insert: ${runInsertErr.message}`);
  const runId = runRow?.id as string;

  try {
    let trialsUpserted = 0;
    let buffer: Record<string, unknown>[] = [];
    for await (const page of paginate(cutoffIsoDate)) {
      for (const study of page) {
        const ps = study.protocolSection ?? {};
        const nctId = ps.identificationModule?.nctId?.trim();
        if (!nctId) continue;
        const leadSponsor = ps.sponsorCollaboratorsModule?.leadSponsor?.name?.trim() ?? null;
        const collaborators = extractCollaborators(study);
        buffer.push({
          nct_id: nctId,
          brief_title: ps.identificationModule?.briefTitle ?? null,
          overall_status: ps.statusModule?.overallStatus ?? null,
          phases: ps.designModule?.phases ?? [],
          conditions: ps.conditionsModule?.conditions ?? [],
          lead_sponsor: leadSponsor,
          lead_sponsor_normalized: leadSponsor ? normalizeCompanyForMatching(leadSponsor) : null,
          collaborators,
          collaborators_normalized: collaborators.map((c) => normalizeCompanyForMatching(c)),
          locations_count: Array.isArray(ps.contactsLocationsModule?.locations)
            ? ps.contactsLocationsModule!.locations!.length
            : null,
          last_update_post_date: ps.statusModule?.lastUpdatePostDateStruct?.date ?? null,
          last_seen_at: startedAtIso,
        });
        if (buffer.length >= UPSERT_CHUNK) {
          const chunk = buffer;
          buffer = [];
          const { error } = await admin
            .from('clinical_trials')
            .upsert(chunk, { onConflict: 'nct_id' });
          if (error) throw new Error(`clinical_trials upsert: ${error.message}`);
          trialsUpserted += chunk.length;
        }
      }
    }
    if (buffer.length > 0) {
      const { error } = await admin
        .from('clinical_trials')
        .upsert(buffer, { onConflict: 'nct_id' });
      if (error) throw new Error(`clinical_trials upsert: ${error.message}`);
      trialsUpserted += buffer.length;
    }

    const finishedAt = new Date();
    await admin
      .from('ct_delta_sync_runs')
      .update({
        finished_at: finishedAt.toISOString(),
        status: 'success',
        trials_upserted: trialsUpserted,
      })
      .eq('id', runId);

    return {
      cutoff_date: cutoffIsoDate,
      trials_upserted: trialsUpserted,
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    };
  } catch (error) {
    await admin
      .from('ct_delta_sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: 'failed',
        error: messageFromUnknown(error),
      })
      .eq('id', runId);
    throw error;
  }
}
