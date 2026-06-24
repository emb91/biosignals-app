/**
 * Conference SOCIAL-intent delta sync (Phase 3) — populates the shared mirror.
 *
 * Sibling to sync-conference-delta.ts (exhibitors). Differences:
 *   - SOURCE actor is paid Apify (harvestapi/linkedin-post-search), so the scrape
 *     is HARD-GATED to in-window conferences with social_tags (the cost + precision
 *     gate). A dead hashtag is both wasted spend and noise.
 *   - The unit is a PERSON self-declaring attendance, not a company booth. So the
 *     mirror (conference_social_attendees_local) carries the normalized author
 *     token + author block, a resolver-at-ingest canonical COMPANY match (from the
 *     author's stated employer), the attendance-assertion result, and confidence.
 *   - The scrape is SHARED across users (deduped per-user at signal_source_events
 *     by run-social-monitor.ts). This module never touches a user's feed.
 *
 * Resolution-at-ingest, here, is: (1) attendance-assertion filter + confidence,
 * (2) author-name → normalized "Last F" token (the per-user contact cross-match key
 * the monitor uses, exactly like run-publications-monitor.ts), (3) best-effort
 * canonical company match from the stated employer (buildCompanyMentionMatches),
 * stamped with matchType context 'verified_social_attendee'. The per-user PERSON
 * resolution (author token + employer cross-check → the user's own contact) happens
 * in the monitor — a social author is global, contact ownership is per-user.
 *
 * Conferences are loaded from the registry. Out-of-window conferences (expired, or
 * before the pre-event lead) and conferences with no social_tags are skipped — zero
 * spend on dead/untagged shows.
 */
import type { createAdminClient } from '@/lib/supabase-admin';
import {
  buildCompanyMentionMatches,
  verifiedMentionCompanyIds,
} from '@/lib/companies/mention-provenance';
import { linkedInSocialSource } from './apify-source';
import { postConfidence } from './post-parsing';
import { inSocialScrapeWindow } from './scrape-window';
import { authorNameToken } from './author-token';
import type { SocialPostRecord } from './types';

type Admin = ReturnType<typeof createAdminClient>;

export const CONFERENCE_SOCIAL_SOURCE = 'conference_social';

export { SOCIAL_PRE_EVENT_LEAD_DAYS, inSocialScrapeWindow } from './scrape-window';

type ConferenceRow = {
  id: string;
  name: string;
  social_tags: string[] | null;
  start_date: string | null;
  end_date: string | null;
};

export type SocialSyncResult = {
  conferences_polled: number;
  conferences_skipped: number;
  posts_scraped: number;
  posts_asserting_attendance: number;
  attendees_upserted: number;
  failures: Array<{ conference_id: string; error: string }>;
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function syncConferenceSocialDelta(params: {
  admin: Admin;
  /** Restrict to specific conferences (else all registry rows with social_tags). */
  conferenceIds?: string[];
  now?: Date;
}): Promise<SocialSyncResult> {
  const { admin } = params;
  const now = params.now ?? new Date();

  const { data: runRow } = await admin
    .from('conference_social_sync_runs')
    .insert({ status: 'running' })
    .select('id')
    .single<{ id: string }>();
  const runId = runRow?.id ?? null;

  let query = admin
    .from('conferences')
    .select('id,name,social_tags,start_date,end_date');
  if (params.conferenceIds?.length) query = query.in('id', params.conferenceIds);
  const { data: confs, error } = await query;
  if (error) throw new Error(`conferences query: ${error.message}`);

  const result: SocialSyncResult = {
    conferences_polled: 0,
    conferences_skipped: 0,
    posts_scraped: 0,
    posts_asserting_attendance: 0,
    attendees_upserted: 0,
    failures: [],
  };

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    try {
      const tags = (conf.social_tags ?? []).filter((t) => typeof t === 'string' && t.trim());
      if (tags.length === 0) {
        result.conferences_skipped += 1;
        continue;
      }
      const { inWindow, phase } = inSocialScrapeWindow(conf.start_date, conf.end_date, now);
      if (!inWindow) {
        result.conferences_skipped += 1;
        continue;
      }

      const posts = await linkedInSocialSource.fetchPosts({
        conferenceId: conf.id,
        name: conf.name,
        socialTags: tags,
        startDate: conf.start_date,
        endDate: conf.end_date,
      });
      result.posts_scraped += posts.length;

      // Keep only posts that ASSERT attendance at/above the confidence gate, and
      // dedupe to one row per (conference, author token) — the highest-confidence
      // post is the evidence. One person, one attendee row per show.
      const byAuthorToken = new Map<
        string,
        { record: SocialPostRecord; confidence: number; cue: string | null }
      >();
      for (const post of posts) {
        const { assertion, confidence } = postConfidence(post);
        if (!assertion.asserts) continue;
        result.posts_asserting_attendance += 1;
        const token = authorNameToken(post.author.name);
        if (!token) continue;
        const prior = byAuthorToken.get(token);
        if (!prior || confidence > prior.confidence) {
          byAuthorToken.set(token, { record: post, confidence, cue: assertion.cue ?? null });
        }
      }

      // Resolve each distinct author's stated employer → canonical company at
      // ingest (best-effort; the per-user contact resolution is the monitor's job).
      const rows: Record<string, unknown>[] = [];
      for (const [token, { record, confidence, cue }] of byAuthorToken) {
        const employer = record.author.company ?? null;
        const companyMatches = employer
          ? await buildCompanyMentionMatches(admin, [
              { sourceText: employer, sourceField: 'author_company' },
            ])
          : [];
        const companyIds = verifiedMentionCompanyIds(companyMatches);
        rows.push({
          conference_id: conf.id,
          author_name_raw: record.author.name,
          author_name_token: token,
          author_profile_url: record.author.profileUrl ?? null,
          author_headline: record.author.headline ?? null,
          author_company_raw: employer,
          post_url: record.postUrl || null,
          post_text: record.text?.slice(0, 2000) ?? null,
          posted_at: record.postedAt ?? null,
          matched_tags: record.matchedTags,
          network: 'linkedin',
          assertion_cue: cue,
          confidence,
          source: CONFERENCE_SOCIAL_SOURCE,
          source_url: record.postUrl || null,
          mentioned_company_ids: companyIds.length ? companyIds : null,
          mentioned_company_matches: companyMatches as unknown,
          fetched_at: now.toISOString(),
          last_seen_at: now.toISOString(),
        });
      }

      for (let i = 0; i < rows.length; i += 500) {
        const { error: upErr } = await admin
          .from('conference_social_attendees_local')
          .upsert(rows.slice(i, i + 500), {
            onConflict: 'conference_id,author_name_token',
          });
        if (upErr) throw new Error(`upsert: ${upErr.message}`);
      }

      result.attendees_upserted += rows.length;
      result.conferences_polled += 1;
    } catch (error) {
      result.failures.push({ conference_id: conf.id, error: messageFromUnknown(error) });
    }
  }

  if (runId) {
    await admin
      .from('conference_social_sync_runs')
      .update({
        status: result.failures.length ? 'failed' : 'success',
        finished_at: new Date().toISOString(),
        conferences_polled: result.conferences_polled,
        attendees_upserted: result.attendees_upserted,
        error: result.failures.length ? JSON.stringify(result.failures).slice(0, 2000) : null,
      })
      .eq('id', runId);
  }

  return result;
}
