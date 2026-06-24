/**
 * Conference PRESENTER / speaker source-adapter interface + record shape.
 *
 * Phase 2 of the conference signal (`presenting_at_conference`). The presenter
 * analog of the exhibitor `ConferenceAdapter` (../adapters/types.ts): one adapter
 * per agenda/advance-program platform (CadmiumCD/eventScribe, society WordPress
 * abstract archive, abstractsonline/OASIS, SPARGO session planner, …). The
 * delta-sync is platform-agnostic — it picks the adapter for a conference's
 * `agenda_platform` and calls `fetchAppearances`.
 *
 * Distinct from exhibitors in TWO ways:
 *   1. It is CONTACT-level — the unit is a named person on the program, not a
 *      company with a booth.
 *   2. Each record resolves to BOTH a canonical company (from the affiliation)
 *      AND a canonical person (from the name + affiliation), so the mirror row
 *      carries two resolver arrays (mentioned_company_ids + mentioned_contact_ids).
 *
 * See docs/CONFERENCE_PHASE2_PRESENTERS.md for the cracked endpoints and the
 * full design. NEW file — does not touch the Phase 1 exhibitor adapters.
 */

/**
 * Agenda platforms. Deliberately separate from the exhibitor `ConferencePlatform`
 * union: a single show can sit on Conference Harvester for exhibitors AND
 * eventScribe for its agenda (both are CadmiumCD), so the two surfaces are keyed
 * independently.
 */
export type PresenterPlatform =
  | 'eventscribe' // CadmiumCD eventScribe — agenda.asp?pfp=FullSchedule (cracked)
  | 'informa' // Informa Connect /{event}/speakers/ — EsSpeakerView JSON blob (cracked)
  | 'society_abstract_archive' // ACR-style WordPress / OpenConf abstract archive (cracked)
  | 'abstractsonline' // AACR/ASCO OASIS itinerary planner (JS/REST — not cracked by bare curl)
  | 'spargo_sessions' // SPARGO/a2zinc session planner (same host family as the exhibitor path; partial)
  | 'society_program_pdf'; // society self-hosted advance-program PDF

/** The kind of program slot a person occupies. */
export type AppearanceType = 'speaker' | 'poster' | 'chair' | 'moderator' | 'presenter';

/** A conference row as a presenter adapter needs it to fetch the agenda. */
export type ConferenceForAppearanceFetch = {
  /** Stable conference id (uuid in the `conferences` table). */
  id?: string;
  /** Human name, for logging. */
  name?: string;
  /** Which presenter adapter to use. Matches the adapter registry key. */
  agendaPlatform: PresenterPlatform;
  /**
   * The public agenda / advance-program URL (the presenter analog of
   * `exhibitor_source_url`). For eventScribe this is the event subdomain root
   * (the slug is per-event and must be discovered — see the doc). For a society
   * archive it's the meeting's abstract-index URL; for a PDF it's the PDF URL.
   */
  agendaSourceUrl: string;
  /**
   * Optional per-platform parameters not derivable from the URL alone
   * (e.g. an abstractsonline eventId, or a SPARGO session-planner slug).
   */
  platformParams?: Record<string, string | number>;
  /**
   * Optional target company names (+ aliases) to scope the fetch to OUR tracked
   * accounts. Used by adapters that can't be enumerated whole and must query
   * per-entity (abstractsonline/OASIS: thousands of presentations, searchable by
   * company name). Adapters that server-render the full agenda ignore this and
   * return everything. Empty/undefined ⇒ a targeted adapter returns nothing.
   */
  targetCompanies?: string[];
};

/**
 * A single named appearance as returned by an adapter. `name` + `affiliationRaw`
 * are the join keys: name → canonical person, affiliation → canonical company,
 * and the two together are the disambiguation guard (a name alone is too noisy).
 */
export type AppearanceRecord = {
  /** Speaker display name as printed in the source. Required — drives person matching. */
  speakerName: string;
  /** Title / credential line as printed, e.g. "Chief Medical Officer" or "PhD". */
  speakerTitle?: string;
  /** Program slot. */
  appearanceType: AppearanceType;
  /** Session / abstract title, if the source carries it. */
  sessionTitle?: string;
  /** Affiliation as printed, e.g. "University of Florida" / "Metrum RG". Drives company matching. */
  affiliationRaw?: string;
  /** Abstract / session detail URL, if the source carries it. */
  abstractUrl?: string;
  /**
   * Corresponding-author email IFF the source PUBLISHED it (journal abstract
   * supplements only). Provenance only — never auto-written to people.email.
   * Most agenda sources carry no email; leave undefined.
   */
  publishedEmail?: string;
  /** The URL the record was pulled from (for provenance + source_url). */
  sourceUrl: string;
};

export interface PresenterSourceAdapter {
  /** The platform this adapter handles. */
  readonly platform: PresenterPlatform;
  /** Fetch the full set of named appearances for one conference. */
  fetchAppearances(conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]>;
}
