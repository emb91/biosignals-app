/**
 * Conference exhibitor platform-adapter interface.
 *
 * One adapter per event-tech platform (Map Your Show, Conference Harvester,
 * SPARGO/a2zinc, Small World Labs, …). The monitor is platform-agnostic: it
 * picks the adapter for a conference's `platform` and calls `fetchExhibitors`.
 * This is the "one parser, many shows" unit — see
 * docs/conference-ingestion-deep.md for the cracked endpoints behind each.
 *
 * Field depth varies by platform: PDF exports (Map Your Show) give name+booth
 * only (enough to MATCH a company); JSON/HTML platforms can also yield
 * website/category (enough to ENRICH). Keep optional fields optional.
 */

/** A conference row as the adapter needs to fetch its exhibitor list. */
export type ConferenceForFetch = {
  /** Stable conference id (uuid in the `conferences` table). */
  id?: string;
  /** Human name, for logging. */
  name?: string;
  /** Which adapter to use. Matches the adapter registry key. */
  platform: ConferencePlatform;
  /**
   * The public exhibitor-list URL or the platform-specific source key. For
   * Map Your Show this is the show code; for Conference Harvester the EventKey;
   * for SPARGO the events.jspargo.com slug; for Small World Labs the subdomain.
   * Adapters document exactly what they expect.
   */
  exhibitorSourceUrl: string;
  /**
   * Optional per-platform parameters that can't be derived from the URL alone
   * (e.g. Conference Harvester needs EventID + EventClientID scraped from the
   * floorplan index page). Adapters read what they need from here.
   */
  platformParams?: Record<string, string | number>;
};

export type ConferencePlatform =
  | 'mapyourshow'
  | 'conference_harvester'
  | 'spargo'
  | 'a2z'
  | 'informa'
  | 'smallworldlabs'
  | 'terrapinn'
  | 'swapcard';

/** A single exhibitor as returned by an adapter. */
export type ExhibitorRecord = {
  /** Company display name as printed in the source. Required — drives matching. */
  name: string;
  /** Booth number / label, if the source carries it. */
  booth?: string;
  /** Company website, if the source carries it (richer JSON/HTML platforms). */
  website?: string;
  /** Exhibitor category / sector, if the source carries it. */
  category?: string;
  /** The URL the record was pulled from (for provenance + source_url). */
  sourceUrl: string;
};

export interface ConferenceAdapter {
  /** The platform this adapter handles. */
  readonly platform: ConferencePlatform;
  /** Fetch the full exhibitor list for one conference. */
  fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]>;
}
