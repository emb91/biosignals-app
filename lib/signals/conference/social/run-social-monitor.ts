/**
 * Conference SOCIAL-intent monitor (Phase 3) — per-user, CONTACT-level.
 *
 * Reads the shared mirror (conference_social_attendees_local, populated by
 * sync-social-delta.ts) and, for each in-window conference, cross-matches scraped
 * attendee author tokens against the USER'S OWN tracked contacts — exactly like the
 * contact cross-match in run-publications-monitor.ts:
 *
 *   1. Build the user's contacts' "last f" token lookup (carry employer name +
 *      aliases for the disambiguation guard).
 *   2. For each mirror attendee whose author token matches one of the user's
 *      contacts, VERIFY the contact's employer matches the attendee's stated
 *      company (companyInAffiliations-style whole-word guard) — a common token
 *      alone is too noisy.
 *   3. Admission guard (fail-closed) + ownership gate (assertUserOwnsSignalEntity,
 *      requireContactCompanyMatch).
 *   4. Dedupe via signal_source_events on
 *      `conference_social:{conference_id}:{contact_id}:attending_conference`.
 *   5. Emit CONTACT-level `attending_conference` (cast SignalKey), with the
 *      conference-date phase in metadata driving the outreach angle.
 *   6. Recompute the contact's readiness (+ account readiness for its company).
 *
 * Cadence is plan-tiered by the caller via the contact sweep-target dispatcher.
 * Expired conferences are skipped (hard expiry).
 */
import { createAdminClient } from '@/lib/supabase-admin';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';
import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
  recomputeContactReadiness,
} from '@/lib/signals/readiness-service';
import type { SignalKey } from '@/lib/signals/readiness-types';
import { assertUserOwnsSignalEntity } from '@/lib/signals/signal-ownership';
import { buildAdmissionMetadata } from '@/lib/signals/signal-admission';
import { conferencePhase } from '../conference-phase';
import { CONFERENCE_SOCIAL_SOURCE } from './sync-social-delta';
import { authorNameToken } from './author-token';
import { employerMatches, normalizeLinkedinKey } from './social-resolution';

const SIGNAL_KEY: SignalKey = 'attending_conference';

type AdminClient = ReturnType<typeof createAdminClient>;

type SocialMonitorInput = {
  userId: string;
  /** Restrict to a subset of the user's contacts. */
  contactIds?: string[];
  /** Restrict to specific conferences (else all active registry rows). */
  conferenceIds?: string[];
  limit?: number;
};

export type SocialMonitorResult = {
  processed_conferences: number;
  failed_conferences: number;
  attendees_scanned: number;
  candidate_events_matched_before_dedupe: number;
  events_skipped_as_duplicates: number;
  emitted_signal_types: string[];
  recomputed_contacts: string[];
  failures: Array<{ conference_id: string; error: string }>;
};

type ConferenceRow = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  event_url: string | null;
};

type AttendeeRow = {
  author_name_raw: string | null;
  author_name_token: string | null;
  author_profile_url: string | null;
  author_company_raw: string | null;
  post_url: string | null;
  post_text: string | null;
  confidence: number | null;
  assertion_cue: string | null;
  source_url: string | null;
};

type ContactRow = {
  id: string;
  full_name: string | null;
  company_id: string | null;
  linkedin_url: string | null;
};

type ContactMatchEntry = {
  contact: ContactRow;
  companyName: string;
  companyAliases: string[];
};

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
  }
  return 'Internal server error';
}

async function fetchExistingSourceEventIds(
  admin: AdminClient,
  userId: string,
  sourceEventIds: string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(sourceEventIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Set<string>();
  const found = new Set<string>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const slice = uniqueIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('signal_source_events')
      .select('source_event_id')
      .eq('user_id', userId)
      .eq('source', CONFERENCE_SOCIAL_SOURCE)
      .in('source_event_id', slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = (row as { source_event_id?: unknown }).source_event_id;
      if (typeof id === 'string' && id) found.add(id);
    }
  }
  return found;
}

export async function runConferenceSocialMonitor(
  input: SocialMonitorInput,
): Promise<SocialMonitorResult> {
  const admin = createAdminClient();

  const result: SocialMonitorResult = {
    processed_conferences: 0,
    failed_conferences: 0,
    attendees_scanned: 0,
    candidate_events_matched_before_dedupe: 0,
    events_skipped_as_duplicates: 0,
    emitted_signal_types: [],
    recomputed_contacts: [],
    failures: [],
  };

  // The user's active tracked companies (contact must belong to one).
  const ownedCompanyIds = new Set(
    (await listActiveCompanyStateForUser(admin, input.userId)).map((r) => r.company_id),
  );
  if (ownedCompanyIds.size === 0) return result;

  // Load the user's contacts (scoped by user_id) and keep only those at an active
  // tracked company.
  let contactQuery = admin
    .from('contacts')
    .select('id, full_name, company_id, linkedin_url')
    .eq('user_id', input.userId)
    .is('archived_at', null)
    .not('full_name', 'is', null);
  if (input.contactIds?.length) contactQuery = contactQuery.in('id', input.contactIds);
  const { data: contacts, error: contactsError } = await contactQuery;
  if (contactsError) throw new Error(`contacts query: ${contactsError.message}`);

  const contactRows = ((contacts ?? []) as ContactRow[]).filter(
    (c) => Boolean(c.company_id && ownedCompanyIds.has(c.company_id)),
  );
  if (contactRows.length === 0) return result;

  // Employer info for the contacts' companies, for the cross-check guard.
  const companyInfo = new Map<string, { name: string; aliases: string[] }>();
  const companyIds = [...new Set(contactRows.map((c) => c.company_id).filter(Boolean))] as string[];
  for (let i = 0; i < companyIds.length; i += 200) {
    const slice = companyIds.slice(i, i + 200);
    const { data } = await admin
      .from('companies')
      .select('id, company_name, aliases')
      .in('id', slice);
    for (const row of data ?? []) {
      const r = row as { id: string; company_name?: string | null; aliases?: string[] | null };
      companyInfo.set(r.id, {
        name: r.company_name ?? '',
        aliases: Array.isArray(r.aliases) ? r.aliases : [],
      });
    }
  }

  // Token + profile-URL lookups over the user's contacts.
  const contactsByToken = new Map<string, ContactMatchEntry[]>();
  const contactByLinkedin = new Map<string, ContactMatchEntry>();
  for (const contact of contactRows) {
    if (!contact.company_id) continue;
    const info = companyInfo.get(contact.company_id);
    if (!info) continue;
    const entry: ContactMatchEntry = {
      contact,
      companyName: info.name,
      companyAliases: info.aliases,
    };
    const token = authorNameToken(contact.full_name);
    if (token) {
      const arr = contactsByToken.get(token) ?? [];
      arr.push(entry);
      contactsByToken.set(token, arr);
    }
    const liKey = normalizeLinkedinKey(contact.linkedin_url);
    if (liKey) contactByLinkedin.set(liKey, entry);
  }

  // Load conferences (optionally filtered).
  let confQuery = admin.from('conferences').select('id,name,start_date,end_date,event_url');
  if (input.conferenceIds?.length) confQuery = confQuery.in('id', input.conferenceIds);
  const { data: confs, error: confError } = await confQuery;
  if (confError) throw new Error(`conferences query: ${confError.message}`);

  const emittedSignalTypes = new Set<string>();
  const recomputedContactIds = new Set<string>();
  const now = new Date();

  for (const conf of (confs ?? []) as ConferenceRow[]) {
    try {
      const phase = conferencePhase(conf.start_date, conf.end_date, now);
      if (phase === 'expired') continue; // hard expiry

      const { data: rows, error: rowsError } = await admin
        .from('conference_social_attendees_local')
        .select(
          'author_name_raw,author_name_token,author_profile_url,author_company_raw,post_url,post_text,confidence,assertion_cue,source_url',
        )
        .eq('conference_id', conf.id);
      if (rowsError) throw new Error(rowsError.message);

      const attendees = (rows ?? []) as AttendeeRow[];
      result.attendees_scanned += attendees.length;

      // Resolve each attendee → at most one of the user's contacts. Profile-URL
      // match is the strongest path (no employer cross-check needed); else the
      // token + employer cross-check.
      type Hit = { contact: ContactRow; attendee: AttendeeRow; strength: 'profile' | 'token_employer' };
      const hits: Hit[] = [];
      const seenContactIds = new Set<string>();
      for (const att of attendees) {
        let entry: ContactMatchEntry | undefined;
        let strength: Hit['strength'] = 'token_employer';

        const liKey = normalizeLinkedinKey(att.author_profile_url);
        if (liKey && contactByLinkedin.has(liKey)) {
          entry = contactByLinkedin.get(liKey);
          strength = 'profile';
        } else if (att.author_name_token) {
          const candidates = contactsByToken.get(att.author_name_token) ?? [];
          entry = candidates.find(
            (c) => employerMatches(c.companyName, c.companyAliases, att.author_company_raw) !== null,
          );
          strength = 'token_employer';
        }
        if (!entry) continue;
        if (seenContactIds.has(entry.contact.id)) continue; // one signal per contact per show
        seenContactIds.add(entry.contact.id);
        hits.push({ contact: entry.contact, attendee: att, strength });
      }

      const candidateSourceEventIds = hits.map(
        (h) => `${CONFERENCE_SOCIAL_SOURCE}:${conf.id}:${h.contact.id}:attending_conference`,
      );
      const existingSourceEventIds = await fetchExistingSourceEventIds(
        admin,
        input.userId,
        candidateSourceEventIds,
      );

      const eventAt = conf.start_date ?? null;

      for (const hit of hits) {
        result.candidate_events_matched_before_dedupe += 1;

        // Ownership gate — fail-closed.
        const ownership = await assertUserOwnsSignalEntity(admin, {
          userId: input.userId,
          contactId: hit.contact.id,
          companyId: hit.contact.company_id,
          requireContactCompanyMatch: true,
        });
        if (!ownership.ok) continue;

        const sourceEventId = `${CONFERENCE_SOCIAL_SOURCE}:${conf.id}:${hit.contact.id}:attending_conference`;
        if (existingSourceEventIds.has(sourceEventId)) {
          result.events_skipped_as_duplicates += 1;
          continue;
        }

        const matchedEmployer =
          hit.strength === 'profile'
            ? hit.attendee.author_company_raw ?? null
            : employerMatches(
                companyInfo.get(hit.contact.company_id ?? '')?.name ?? '',
                companyInfo.get(hit.contact.company_id ?? '')?.aliases ?? [],
                hit.attendee.author_company_raw,
              );

        const admissionMetadata = buildAdmissionMetadata({
          admitted: true,
          reason:
            hit.strength === 'profile'
              ? 'Social author profile URL matches the tracked contact.'
              : 'Social author name token matched the contact and the stated employer matches the contact company.',
          confidence: hit.strength === 'profile' ? 'high' : 'medium',
          entityScope: 'contact',
          contactId: hit.contact.id,
          companyId: hit.contact.company_id ?? undefined,
          matchType: 'verified_social_attendee',
          metadata: {
            role_gate: 'passed',
            role_gate_reason:
              hit.strength === 'profile'
                ? 'author profile URL match'
                : 'author token plus employer cross-check',
            matched_source_field:
              hit.strength === 'profile' ? 'author_profile_url' : 'author_name',
            matched_source_text: hit.attendee.author_name_raw ?? hit.contact.full_name ?? '',
            matched_employer: matchedEmployer,
            post_confidence: hit.attendee.confidence ?? null,
            assertion_cue: hit.attendee.assertion_cue ?? null,
          },
        });

        const summary = `${hit.contact.full_name ?? 'A tracked contact'} is self-declaring attendance at ${conf.name} on LinkedIn.`;
        const title = 'attending_conference detected from a social attendance post';
        const sourceUrl = hit.attendee.post_url ?? hit.attendee.source_url ?? conf.event_url ?? '';
        const metadata: Record<string, unknown> = {
          conference_id: conf.id,
          conference_name: conf.name,
          event_start_date: conf.start_date ?? null,
          event_end_date: conf.end_date ?? null,
          conference_phase: phase, // upcoming | live | recent — drives outreach angle
          network: 'linkedin',
          author_name_raw: hit.attendee.author_name_raw,
          author_company_raw: hit.attendee.author_company_raw,
          post_url: hit.attendee.post_url,
          post_confidence: hit.attendee.confidence ?? null,
          assertion_cue: hit.attendee.assertion_cue ?? null,
          match_strength: hit.strength,
          ...admissionMetadata,
        };

        const ingest = await ingestSignalSourceEvent(admin, {
          userId: input.userId,
          entityScope: 'contact',
          contactId: hit.contact.id,
          companyId: hit.contact.company_id ?? undefined,
          source: CONFERENCE_SOCIAL_SOURCE,
          sourceEventType: 'conference_social_attendance',
          sourceEventId,
          sourceUrl,
          title,
          summary,
          excerpt: summary,
          eventAt: eventAt ?? new Date().toISOString(),
          metadata,
        });

        await normalizeSignalSourceEvent(admin, {
          userId: input.userId,
          rawEvent: {
            id: ingest.sourceEventId,
            userId: input.userId,
            entityId: hit.contact.id,
            entityScope: 'contact',
            source: CONFERENCE_SOCIAL_SOURCE,
            sourceUrl,
            sourceEventType: 'conference_social_attendance',
            sourceEventId,
            title,
            summary,
            excerpt: summary,
            eventAt,
            observedAt: new Date().toISOString(),
            metadata,
          },
          signalKeys: [SIGNAL_KEY],
          contactId: hit.contact.id,
          companyId: hit.contact.company_id ?? undefined,
        });

        existingSourceEventIds.add(sourceEventId);
        emittedSignalTypes.add(SIGNAL_KEY as string);

        await recomputeContactReadiness(admin, {
          userId: input.userId,
          contactId: hit.contact.id,
        });
        if (hit.contact.company_id) {
          await recomputeAccountReadiness(admin, {
            userId: input.userId,
            companyId: hit.contact.company_id,
          });
          await generateAccountReason(admin, {
            userId: input.userId,
            companyId: hit.contact.company_id,
          });
        }
        recomputedContactIds.add(hit.contact.id);
      }

      result.processed_conferences += 1;
    } catch (error) {
      result.failed_conferences += 1;
      result.failures.push({ conference_id: conf.id, error: messageFromUnknown(error) });
    }
  }

  result.emitted_signal_types = [...emittedSignalTypes];
  result.recomputed_contacts = [...recomputedContactIds];
  return result;
}
