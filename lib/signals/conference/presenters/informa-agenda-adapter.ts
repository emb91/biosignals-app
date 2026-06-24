/**
 * Informa Connect agenda adapter — CRACKED (presenter side).
 *
 * Informa shows host their exhibitor roster at /{event}/sponsors/ (see
 * ../adapters/informa.ts) and their SPEAKERS at /{event}/speakers/. The speakers
 * page server-renders a JSON blob of `EsSpeakerView` objects:
 *
 *   {"@class":"informa.event.view.speaker.EsSpeakerView",
 *    "forename":"Todd","surname":"McDevitt",
 *    "jobTitle":"Vice President, Cell Therapy","company":"Genentech",
 *    "path":"todd-mcdevitt", ...}
 *
 * forename+surname → speaker name (person match); company → affiliation (company
 * match); jobTitle → speaker title. No session title per speaker on this page and
 * no emails — appearanceType defaults to 'speaker'. `path` is an internal slug,
 * never a URL. Unlocks the Informa cluster (CGT US, Antibody Engineering, Biotech
 * Week Boston, LSX, RNA Leaders, …) for the presenter pipeline.
 *
 * agendaSourceUrl is the full /speakers/ URL (set per-show on conferences.agenda_source_url).
 */
import type {
  AppearanceRecord,
  ConferenceForAppearanceFetch,
  PresenterSourceAdapter,
} from './types';
import { conferenceFetch } from '../fetch';

const SPEAKER_MARKER = '"@class":"informa.event.view.speaker.EsSpeakerView"';
// EsSpeakerView keeps forename/surname/jobTitle/company right after @class, before
// the nested logo object — a bounded slice avoids brace-matching the nested JSON.
const SPEAKER_SLICE = 700;

/** Unescape a JSON string body (handles \uXXXX, \", \\). */
function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

function field(slice: string, key: string): string | undefined {
  const m = slice.match(new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`));
  return m ? decodeJsonString(m[1]) : undefined;
}

/**
 * Parse the Informa /speakers/ page into AppearanceRecords. Pure + testable
 * (no network). Walks each EsSpeakerView object, dedupes on name+company.
 */
export function parseInformaSpeakers(html: string, sourceUrl: string): AppearanceRecord[] {
  const out: AppearanceRecord[] = [];
  const seen = new Set<string>();
  let i = html.indexOf(SPEAKER_MARKER);
  while (i !== -1) {
    const slice = html.slice(i, i + SPEAKER_SLICE);
    const forename = field(slice, 'forename');
    const surname = field(slice, 'surname');
    const name = [forename, surname].filter(Boolean).join(' ').trim();
    if (name) {
      const company = field(slice, 'company');
      const key = `${name.toLowerCase()}|${(company ?? '').toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          speakerName: name,
          speakerTitle: field(slice, 'jobTitle') || undefined,
          affiliationRaw: company || undefined,
          appearanceType: 'speaker',
          sourceUrl,
        });
      }
    }
    i = html.indexOf(SPEAKER_MARKER, i + SPEAKER_MARKER.length);
  }
  return out;
}

export const informaAgendaAdapter: PresenterSourceAdapter = {
  platform: 'informa',
  async fetchAppearances(conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]> {
    const url = conf.agendaSourceUrl;
    const res = await conferenceFetch(url);
    if (!res.ok) throw new Error(`informa agenda ${res.status} for ${url}`);
    return parseInformaSpeakers(await res.text(), url);
  },
};
