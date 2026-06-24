/**
 * CadmiumCD / eventScribe presenter adapter.
 *
 * eventScribe is the agenda half of CadmiumCD (same vendor as Conference
 * Harvester, which Phase 1 cracked for exhibitors). The full schedule is
 * SERVER-RENDERED — no headless browser required.
 *
 * Cracked endpoint (curl-verified, no auth, 2026-06-24 — see
 * docs/CONFERENCE_PHASE2_PRESENTERS.md §1):
 *
 *   GET {agendaSourceUrl}/agenda.asp?pfp=FullSchedule&all=1
 *     → HTTP 200, full HTML schedule (211 KB for ASCPT 2026)
 *     → 145 distinct named presenters, each rendered inline inside a
 *       presentation block keyed by a PresentationInfo.asp?PresentationID=N
 *       list row whose first .list-row-primary span holds the SESSION TITLE:
 *
 *       <li ... data-url="ajaxcalls/PresentationInfo.asp?PresentationID=1752904" ...>
 *         <div class="list-row-content">
 *           <div class="list-row-secondary prestime">…8:00 AM - 10:30 AM…</div>
 *           <div class="list-row-primary"><span …>Opening Plenary</span>…</div>
 *         </div>
 *         …
 *         Chair: <a class="loadbyurl popup-link"
 *            data-url="/ajaxcalls/presenterInfo.asp?HPRID=830451">Sandra A.G Visser, PhD (she/her/hers)</a>
 *            &ndash; Quantivis LLC, ASCPT President
 *       </li>
 *
 *   Per-presenter detail (bio + session list, NOT fetched here — leave it for a
 *   gated enrich pass, one request each):
 *   GET {agendaSourceUrl}/ajaxcalls/presenterInfo.asp?HPRID={id}
 *
 * NOTE: the eventScribe subdomain slug is PER-EVENT and must be discovered, not
 * guessed (ascpt2026 works; sitc2025/aacr2025 use different slugs). The caller
 * passes the discovered event root as `agendaSourceUrl`. Build/validate against
 * the most-recently-published program (often last year's) — the org swaps next
 * year's program in at the same path, so the parser lights up automatically.
 *
 * Emails are NOT present in eventScribe agendas (publishedEmail is left
 * undefined here — contact-MATCHING, not contact-acquisition).
 */
import { conferenceFetch } from '../fetch';
import type {
  AppearanceRecord,
  AppearanceType,
  ConferenceForAppearanceFetch,
  PresenterSourceAdapter,
} from './types';

// ── HTML helpers ─────────────────────────────────────────────────────────────

/** Decode the small set of HTML entities eventScribe emits in agenda text. */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** Collapse whitespace and trim. */
function squashWs(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Map an eventScribe role label (the text immediately before a presenter anchor)
 * to one of our AppearanceType buckets. Unknown labels fall back to 'presenter'.
 */
export function roleLabelToAppearanceType(label: string): AppearanceType {
  const l = label.toLowerCase();
  if (l.includes('chair')) return 'chair';
  if (l.includes('moderator')) return 'moderator';
  if (l.includes('poster')) return 'poster';
  if (l.includes('speaker') || l.includes('lecturer')) return 'speaker';
  // "Presenter", "Partner Presenter", "Award Presenter", "Award Recipient", …
  return 'presenter';
}

/**
 * Split the trailing role/qualifier off an affiliation string. eventScribe
 * prints the affiliation then (optionally) a comma + a role title, e.g.
 *   "Quantivis LLC, ASCPT President" → "Quantivis LLC"
 *   "University of Florida"          → "University of Florida"
 * We keep only the first comma-segment as the company affiliation, since the
 * company resolver wants the institution, not the honorific.
 */
export function cleanAffiliation(raw: string): string | undefined {
  const decoded = squashWs(decodeHtmlEntities(raw));
  if (!decoded) return undefined;
  // Strip a leading en/em dash separator if it survived.
  const noLead = decoded.replace(/^[–—-]\s*/, '').trim();
  if (!noLead) return undefined;
  const firstSegment = noLead.split(',')[0]?.trim();
  return firstSegment || undefined;
}

/**
 * Split a presenter display name into the base name + credential/pronoun tail.
 * eventScribe prints e.g. "Sandra A.G Visser, PhD (she/her/hers)". We keep the
 * full string as speakerName (person matching tolerates the credential because
 * it tokenizes to "Last F"), and surface the credential/pronoun tail as
 * speakerTitle for the card.
 */
export function splitNameAndCredential(raw: string): {
  speakerName: string;
  speakerTitle?: string;
} {
  const decoded = squashWs(decodeHtmlEntities(raw));
  // Pull a trailing parenthetical (pronouns) off the end first.
  const parenMatch = decoded.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const base = parenMatch ? squashWs(parenMatch[1]) : decoded;
  const pronouns = parenMatch ? squashWs(parenMatch[2]) : '';

  // A trailing ", PhD" / ", MD" / ", PharmD" style credential.
  const credMatch = base.match(/^(.*?),\s*([A-Za-z.]{2,}(?:\s*,\s*[A-Za-z.]{2,})*)$/);
  let speakerName = base;
  const credentialParts: string[] = [];
  if (credMatch) {
    speakerName = squashWs(credMatch[1]);
    credentialParts.push(squashWs(credMatch[2]));
  }
  if (pronouns) credentialParts.push(pronouns);

  const speakerTitle = credentialParts.length ? credentialParts.join(' · ') : undefined;
  return { speakerName: speakerName || decoded, speakerTitle };
}

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * Matches a single presenter anchor with its preceding role label and optional
 * trailing affiliation, e.g.:
 *
 *   Chair: <a class="loadbyurl popup-link"
 *      data-url="/ajaxcalls/presenterInfo.asp?HPRID=830451">Sandra A.G Visser, PhD</a>
 *      &ndash; Quantivis LLC, ASCPT President
 *
 * Group 1: role label ("Chair", "Speaker", "Award Recipient", …)
 * Group 2: HPRID
 * Group 3: display name (+ credential + pronouns)
 * Group 4: trailing affiliation segment (may be empty — the &ndash; is optional)
 */
const PRESENTER_RE =
  /([A-Za-z][A-Za-z .&/'-]{1,40}?):\s*<a\s+class="loadbyurl popup-link"\s+data-url="\/ajaxcalls\/presenterInfo\.asp\?HPRID=(\d+)">([^<]+)<\/a>((?:\s*&ndash;\s*[^<]+)?)/gi;

/** Every session-title span (`.list-row-primary > span`) with its document offset. */
const SESSION_TITLE_RE = /list-row-primary"><span[^>]*>([^<]+)<\/span>/gi;

/**
 * Pure parse of an eventScribe FullSchedule HTML document into AppearanceRecords.
 * No network — exported for unit testing against a fixture.
 *
 * eventScribe nests each presentation's presenters INSIDE the markup that
 * follows its `.list-row-primary` session-title span (the next presentation's
 * `<li>` opens before the prior PresentationID marker closes), so a block split
 * on the PresentationID marker mis-attributes titles. Instead we attribute each
 * presenter anchor to the NEAREST PRECEDING session-title span by document
 * offset — verified correct against the live ASCPT 2026 program.
 */
export function parseEventScribeAgenda(html: string, sourceUrl: string): AppearanceRecord[] {
  const records: AppearanceRecord[] = [];
  const seen = new Set<string>(); // dedupe identical (hprid|session) pairs within the doc

  // Collect session-title offsets (ascending) for nearest-preceding lookup.
  const titleOffsets: number[] = [];
  const titleText: string[] = [];
  {
    SESSION_TITLE_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = SESSION_TITLE_RE.exec(html)) !== null) {
      titleOffsets.push(tm.index);
      titleText.push(squashWs(decodeHtmlEntities(tm[1])));
    }
  }

  function sessionTitleAt(pos: number): string | undefined {
    // Binary search for the greatest offset <= pos.
    let lo = 0;
    let hi = titleOffsets.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (titleOffsets[mid] <= pos) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found < 0) return undefined;
    return titleText[found] || undefined;
  }

  PRESENTER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRESENTER_RE.exec(html)) !== null) {
    const roleLabel = squashWs(decodeHtmlEntities(m[1]));
    const hprid = m[2];
    const rawName = m[3];
    const rawAffiliation = m[4] ?? '';

    const { speakerName, speakerTitle } = splitNameAndCredential(rawName);
    if (!speakerName) continue;

    const sessionTitle = sessionTitleAt(m.index);

    const dedupeKey = `${hprid}|${sessionTitle ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const affiliationRaw = cleanAffiliation(rawAffiliation);

    records.push({
      speakerName,
      speakerTitle,
      appearanceType: roleLabelToAppearanceType(roleLabel),
      sessionTitle,
      affiliationRaw,
      // Per-presenter detail page — kept as evidence, NOT scraped for emails.
      abstractUrl: `${stripTrailingSlash(sourceUrl)}/ajaxcalls/presenterInfo.asp?HPRID=${hprid}`,
      sourceUrl,
    });
  }

  return records;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export const eventScribeAdapter: PresenterSourceAdapter = {
  platform: 'eventscribe',

  async fetchAppearances(conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]> {
    const base = stripTrailingSlash(conf.agendaSourceUrl);
    if (!base) {
      throw new Error('eventScribeAdapter: agendaSourceUrl is required');
    }
    const url = `${base}/agenda.asp?pfp=FullSchedule&all=1`;
    const res = await conferenceFetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`eventScribe agenda HTTP ${res.status} (${url})`);
    }
    const html = await res.text();
    // The 404 shell is a tiny (~714 byte) page with no presenter anchors; the
    // parser simply returns [] for it, which the caller treats as "no agenda
    // published yet" — exactly the last-year/next-year republish behavior.
    return parseEventScribeAgenda(html, url);
  },
};
