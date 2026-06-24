/**
 * Adapter registry — maps a conference `platform` to its adapter.
 *
 * The monitor stays platform-agnostic: look up the adapter, call fetchExhibitors.
 * Adapters not in the registry return undefined from `getConferenceAdapter`, so
 * the monitor skips those conferences cleanly.
 */
import type { ConferenceAdapter, ConferencePlatform } from './types';
import { mapYourShowAdapter } from './mapyourshow';
import { conferenceHarvesterAdapter } from './conference-harvester';
import { spargoAdapter } from './spargo';
import { a2zAdapter } from './a2z';
import { informaAdapter } from './informa';
import { swapcardAdapter } from './swapcard';
import { terrapinnAdapter } from './terrapinn';
import { smallWorldLabsAdapter } from './smallworldlabs';

const REGISTRY: Partial<Record<ConferencePlatform, ConferenceAdapter>> = {
  mapyourshow: mapYourShowAdapter,
  conference_harvester: conferenceHarvesterAdapter,
  spargo: spargoAdapter,
  a2z: a2zAdapter,
  informa: informaAdapter,
  swapcard: swapcardAdapter, // full list via public GraphQL
  terrapinn: terrapinnAdapter, // server-rendered sponsor/exhibitor logo wall (subset)
  smallworldlabs: smallWorldLabsAdapter, // first-page subset (rest needs the widget XHR)
};

export function getConferenceAdapter(platform: ConferencePlatform): ConferenceAdapter | undefined {
  return REGISTRY[platform];
}

export {
  mapYourShowAdapter,
  conferenceHarvesterAdapter,
  spargoAdapter,
  a2zAdapter,
  informaAdapter,
  swapcardAdapter,
  terrapinnAdapter,
  smallWorldLabsAdapter,
};
