/**
 * Adapter registry — maps a conference `platform` to its adapter.
 *
 * The monitor stays platform-agnostic: look up the adapter, call fetchExhibitors.
 * Adapters that aren't cracked yet (terrapinn, swapcard) are intentionally
 * absent — `getConferenceAdapter` returns undefined for them so the monitor
 * skips those conferences cleanly. See docs/conference-ingestion-deep.md.
 */
import type { ConferenceAdapter, ConferencePlatform } from './types';
import { mapYourShowAdapter } from './mapyourshow';
import { conferenceHarvesterAdapter } from './conference-harvester';
import { spargoAdapter } from './spargo';
import { smallWorldLabsAdapter } from './smallworldlabs';

const REGISTRY: Partial<Record<ConferencePlatform, ConferenceAdapter>> = {
  mapyourshow: mapYourShowAdapter,
  conference_harvester: conferenceHarvesterAdapter,
  spargo: spargoAdapter,
  smallworldlabs: smallWorldLabsAdapter,
  // terrapinn: not cracked (JS-hydrated list, no public feed)
  // swapcard: not cracked (GraphQL requires per-event auth token)
};

export function getConferenceAdapter(platform: ConferencePlatform): ConferenceAdapter | undefined {
  return REGISTRY[platform];
}

export { mapYourShowAdapter, conferenceHarvesterAdapter, spargoAdapter, smallWorldLabsAdapter };
