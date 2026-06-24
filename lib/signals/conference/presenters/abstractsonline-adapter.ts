/**
 * abstractsonline / OASIS itinerary planner adapter.
 *
 * CTI Meeting Technology's "Program Planner" (the `pp8` SPA at
 * abstractsonline.com/pp8/#!/{eventId}) powers AACR / ASCO / AHA / many large
 * society programs. It was previously logged as "not cracked" because the data
 * API is 401-gated behind a per-request `Backpack` token. That conclusion was
 * WRONG: the token is mintable over plain HTTP with a PUBLIC service credential
 * baked into the SPA, and every data endpoint then works server-side with no
 * browser. Verified live end-to-end against AACR 2025 (eventId 20273) on
 * 2026-06-24 — see docs/CONFERENCE_PHASE2_PRESENTERS.md §"abstractsonline (OASIS)".
 *
 * ── The cracked recipe (all plain HTTPS, no headless, no cookies) ────────────
 *
 *   base = https://www.abstractsonline.com/oe3
 *
 *   1. Mint a token (the SPA ships a fixed anonymous service login):
 *        POST {base}/Backpack/create
 *        headers: { Content-Type: application/json, Accept: application/json, Caller: PP8 }
 *        body:    { "Username": "backpack", "Password": "89j34jks98cnjks989p;nfs44" }
 *        → 201 { ID: <token>, Expiration }   // token valid ~to end of UTC day
 *      (the SPA's app/config.js + util.getBackpackId() — credential is in clear
 *       text in the bundle; this is not our secret, it is theirs and public.)
 *
 *   2. Every subsequent call carries `Backpack: <token>` (+ Caller: PP8).
 *
 *   3. Search is ASYNC — create, poll, page:
 *        POST {base}/Program/{eventId}/Search/New/{Presentation|Session|Person}
 *             body { "Phrase": "<query>" }            → { SearchId, Status:"Not Started" }
 *        GET  {base}/Program/{eventId}/Search/{SearchId}      → poll until Status:"Complete" (gives Count)
 *        GET  {base}/Program/{eventId}/Search/{SearchId}/Results?page=N&pagesize=M
 *             → { Page, PageSize, Results:[{ Id, Body(title), Head(datetime), Type }], Search:{ Count } }
 *      NOTE: empty Phrase returns 0 — the list browse is FILTER-driven, not
 *      phrase-driven (facet tree at …/Search/{SearchId}/Filters).
 *      DECIDED (2026-06-24): do NOT mirror all ~8k presentations. Scrape against
 *      OUR entities, company-first — search per TRACKED COMPANY and confirm
 *      presenters via the AuthorBlock (catches both known contacts and new names
 *      at target accounts), plus a per-tracked-contact surname `Person` search.
 *      Build-time caveat to verify: that a company/affiliation phrase actually
 *      matches author institutions in search (the `Person` dataset matched names,
 *      not topics) — if not, filter `Presentation` results by AuthorBlock
 *      institution instead.
 *
 *   4. Per-record detail carries the speakers + affiliations:
 *        GET {base}/Program/{eventId}/Presentation/{Id}
 *          → { PresenterDisplayName, AuthorBlock(HTML names+institutions),
 *              DisclosureBlock, PresentationNumber, Abstract, ... }
 *        GET {base}/Program/{eventId}/Session/{Id}/presentations
 *        GET {base}/Program/{eventId}/Participant/{Id}/presentations
 *      `AuthorBlock` is the gold: every author with a superscript-numbered
 *      institution (incl. company affiliations). Parsed by parseAuthorBlock below.
 *
 * ── Build status — LIVE (company-first) ──
 *   fetchAppearances is implemented: for each TRACKED company (conf.targetCompanies)
 *   it runs mint → Presentation search by company name → page Results → GET each
 *   Presentation detail → presentationDetailToAppearances (parseAuthorBlock +
 *   affiliation⊇company filter). NOT a full mirror — Person search by surname does
 *   NOT work (returns 0), so company-name Presentation search is the only viable
 *   targeting, which is also exactly the company-first decision. Bounded by the
 *   OASIS_MAX_* caps; the per-conference sync rotates. Verified live vs AACR 2025
 *   (eventId 20273). Dormant in practice until an OASIS show is seeded + in-window.
 *
 * NEW file — touches no working adapter.
 */
import type {
  AppearanceRecord,
  AppearanceType,
  ConferenceForAppearanceFetch,
  PresenterSourceAdapter,
} from './types';

/** Recipe is verified end-to-end. */
export const ABSTRACTSONLINE_RECIPE_VERIFIED = true as const;
/** fetchAppearances is LIVE — company-first targeted search (see fetchAppearances). */
export const ABSTRACTSONLINE_LIVE = true as const;

/** OASIS data-API origin. */
export const OASIS_DOMAIN = 'https://www.abstractsonline.com/oe3';

/**
 * Public anonymous service login the pp8 SPA ships in its bundle to mint a
 * Backpack token. This is CTI's own public credential (clear-text in their
 * JavaScript), not an Arcova secret. POST it to {OASIS_DOMAIN}/Backpack/create.
 */
export const OASIS_PUBLIC_BACKPACK_LOGIN = {
  Username: 'backpack',
  Password: '89j34jks98cnjks989p;nfs44',
} as const;

/**
 * Build the OASIS data-API routes for an eventId. Pure (no network) so the
 * deferred live build — and the test — can use the exact routes. `eventId` is the
 * numeric id in the planner hash (abstractsonline.com/pp8/#!/{eventId}).
 */
export function abstractsOnlineApiRoutes(eventId: string | number): {
  domain: string;
  backpackCreate: string;
  meeting: string;
  searchNew: (dataset: 'Presentation' | 'Session' | 'Person') => string;
  searchStatus: (searchId: string | number) => string;
  searchFilters: (searchId: string | number) => string;
  searchResults: (searchId: string | number, page: number, pageSize: number) => string;
  presentation: (id: string | number) => string;
  sessionPresentations: (id: string | number) => string;
  participantPresentations: (id: string | number) => string;
} {
  const domain = OASIS_DOMAIN;
  const program = `${domain}/Program/${eventId}`;
  return {
    domain,
    backpackCreate: `${domain}/Backpack/create`,
    meeting: `${domain}/program/meeting/${eventId}`,
    searchNew: (dataset) => `${program}/Search/New/${dataset}`,
    searchStatus: (searchId) => `${program}/Search/${searchId}`,
    searchFilters: (searchId) => `${program}/Search/${searchId}/Filters`,
    searchResults: (searchId, page, pageSize) =>
      `${program}/Search/${searchId}/Results?page=${page}&pagesize=${pageSize}`,
    presentation: (id) => `${program}/Presentation/${id}`,
    sessionPresentations: (id) => `${program}/Session/${id}/presentations`,
    participantPresentations: (id) => `${program}/Participant/${id}/presentations`,
  };
}

/** One author parsed out of an OASIS `AuthorBlock`. */
export type AuthorBlockEntry = {
  /** Author display name, tags + superscripts stripped. */
  name: string;
  /** Institution(s) for this author's superscript number(s), joined with "; ". */
  affiliationRaw: string;
  /** The superscript institution indexes this author carried. */
  affiliationNums: number[];
  /** True if the source bolded this author (the presenting / first author). */
  isBold: boolean;
};

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parse an OASIS `AuthorBlock` (from a Presentation detail) into authors with
 * their affiliations. The block is two segments separated by a `<br>`:
 *   "<b>First Author</b><sup>1</sup>, Second<sup>2,3</sup>, …<br><br/>
 *    <sup>1</sup>Inst One, City, ST,<sup>2</sup>Inst Two, Country,…"
 * The first segment lists authors each tagged with superscript institution
 * indexes; the second maps each index → institution text. We join them so each
 * author carries its real affiliation string (the company-matching key).
 *
 * Pure + synchronous — the hardest parse detail, locked in against real AACR 2025
 * data (see presenters.test.ts). The live fetch maps these → AppearanceRecord[].
 */
export function parseAuthorBlock(authorBlock: string): AuthorBlockEntry[] {
  if (!authorBlock) return [];
  // Split authors / institutions at the first <br> boundary.
  const brMatch = authorBlock.search(/<br\s*\/?>/i);
  const authorsPart = brMatch >= 0 ? authorBlock.slice(0, brMatch) : authorBlock;
  const instPart = brMatch >= 0 ? authorBlock.slice(brMatch) : '';

  // Institution index → text. Each entry is "<sup>N</sup>Text" until the next sup.
  const institutions = new Map<number, string>();
  const instRe = /<sup>\s*(\d+)\s*<\/sup>([\s\S]*?)(?=<sup>\s*\d+\s*<\/sup>|$)/g;
  let im: RegExpExecArray | null;
  while ((im = instRe.exec(instPart)) !== null) {
    const num = Number(im[1]);
    const text = stripTags(im[2]).replace(/[,;\s]+$/, '').trim();
    if (text) institutions.set(num, text);
  }

  // Authors: "<name><sup>n[,n…]</sup>", comma-separated. [^,] keeps names from
  // spanning the comma separators between authors.
  const authors: AuthorBlockEntry[] = [];
  const authRe = /([^,]*?)<sup>\s*([\d,\s]+?)\s*<\/sup>/g;
  let am: RegExpExecArray | null;
  while ((am = authRe.exec(authorsPart)) !== null) {
    const rawName = am[1];
    const isBold = /<b>/i.test(rawName);
    const name = stripTags(rawName);
    if (!name) continue;
    const nums = am[2]
      .split(/[,\s]+/)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
    const affiliationRaw = nums
      .map((n) => institutions.get(n))
      .filter((v): v is string => Boolean(v))
      .join('; ');
    authors.push({ name, affiliationRaw, affiliationNums: nums, isBold });
  }
  return authors;
}

/** Loose normalize for the affiliation⊇company contains-check (not the resolver). */
function normalizeForContains(s: string): string {
  return s
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|sa|srl|s r l|gmbh|ag|plc|nv|bv|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map one OASIS Presentation detail → appearance records for the authors AFFILIATED
 * with `company` (the company we searched for). Pure + synchronous so it can be
 * unit-tested against a real detail object. We keep only authors whose affiliation
 * contains the searched company (the rest are co-authors at other institutions —
 * not this account's signal); the downstream resolver still does the strict
 * person/company match. `detail` is the JSON from GET Program/{eventId}/Presentation/{Id}.
 */
export function presentationDetailToAppearances(
  detail: { AuthorBlock?: string; PresenterDisplayName?: string; Body?: string | null; PresentationNumber?: string | null },
  company: string,
  sourceUrl: string,
): AppearanceRecord[] {
  const authors = parseAuthorBlock(detail.AuthorBlock ?? '');
  if (!authors.length) return [];
  const companyNorm = normalizeForContains(company);
  if (!companyNorm) return [];
  // Presenter display name like "Jason Willis, MD;PhD" → "Jason Willis".
  const presenter = (detail.PresenterDisplayName ?? '').split(',')[0].trim().toLowerCase();
  const sessionTitle = stripTags(detail.Body ?? '') || undefined;
  const out: AppearanceRecord[] = [];
  const seen = new Set<string>();
  for (const a of authors) {
    if (!a.affiliationRaw) continue;
    if (!normalizeForContains(a.affiliationRaw).includes(companyNorm)) continue;
    const key = a.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const isPresenter = a.isBold || (presenter && a.name.toLowerCase() === presenter);
    const appearanceType: AppearanceType = isPresenter ? 'presenter' : 'speaker';
    out.push({
      speakerName: a.name,
      appearanceType,
      sessionTitle,
      affiliationRaw: a.affiliationRaw,
      sourceUrl,
    });
  }
  return out;
}

// ── Live orchestration caps (bound runtime + API calls per conference per run) ──
const OASIS_MAX_COMPANIES = 30; // target companies searched per conference per run
const OASIS_MAX_PRES_PER_COMPANY = 40; // presentations pulled per company
const OASIS_MAX_DETAIL_FETCHES = 250; // overall per-conference detail-GET ceiling
const OASIS_PAGE_SIZE = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mintBackpack(): Promise<string> {
  const res = await fetch(`${OASIS_DOMAIN}/Backpack/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Caller: 'PP8' },
    body: JSON.stringify(OASIS_PUBLIC_BACKPACK_LOGIN),
  });
  if (!res.ok) throw new Error(`OASIS Backpack/create ${res.status}`);
  const j = (await res.json()) as { ID?: string };
  if (!j.ID) throw new Error('OASIS Backpack/create returned no token');
  return j.ID;
}

type Routes = ReturnType<typeof abstractsOnlineApiRoutes>;

/** Create→poll→page a Presentation search for `phrase`; return up to `cap` ids. */
async function searchPresentationIds(
  routes: Routes,
  headers: Record<string, string>,
  phrase: string,
  cap: number,
): Promise<string[]> {
  const cr = (await (
    await fetch(routes.searchNew('Presentation'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ Phrase: phrase }),
    })
  ).json()) as { SearchId?: string };
  const sid = cr.SearchId;
  if (!sid) return [];
  let count = 0;
  for (let i = 0; i < 12; i++) {
    const st = (await (await fetch(routes.searchStatus(sid), { headers })).json()) as {
      Status?: string;
      Count?: string;
    };
    if (/complete/i.test(st.Status ?? '')) {
      count = parseInt(st.Count ?? '0', 10) || 0;
      break;
    }
    await sleep(1000);
  }
  if (!count) return [];
  const ids: string[] = [];
  const pages = Math.ceil(Math.min(count, cap) / OASIS_PAGE_SIZE);
  for (let p = 1; p <= pages && ids.length < cap; p++) {
    const rr = (await (
      await fetch(routes.searchResults(sid, p, OASIS_PAGE_SIZE), { headers })
    ).json()) as { Results?: Array<{ Id?: string | number; Type?: string }> };
    for (const r of rr.Results ?? []) {
      if (r.Type === 'Presentation' && r.Id != null) {
        ids.push(String(r.Id));
        if (ids.length >= cap) break;
      }
    }
  }
  return ids;
}

export const abstractsOnlineAdapter: PresenterSourceAdapter = {
  platform: 'abstractsonline',
  /**
   * LIVE — company-first targeted fetch (DECIDED approach; not a full mirror).
   * For each TRACKED company (passed in via conf.targetCompanies), search the
   * program by company name, pull the matching presentations, fetch each detail,
   * and emit appearance records for the authors affiliated with that company. The
   * downstream sync resolver does the strict person↔contact / affiliation↔company
   * match. Verified live vs AACR 2025 (eventId 20273): "Nouscom" → 17 presentations,
   * "Genentech" → 369. Bounded by the OASIS_MAX_* caps; the sync rotates conferences.
   *
   * Requires platform_params.eventId (the planner #!/{eventId}). With no target
   * companies it returns nothing (company-first ⇒ nothing to search).
   */
  async fetchAppearances(conf: ConferenceForAppearanceFetch): Promise<AppearanceRecord[]> {
    const eventId = conf.platformParams?.eventId;
    if (eventId == null) {
      throw new Error('abstractsonline: platform_params.eventId is required');
    }
    const companies = (conf.targetCompanies ?? [])
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, OASIS_MAX_COMPANIES);
    if (!companies.length) return [];

    const routes = abstractsOnlineApiRoutes(eventId);
    const token = await mintBackpack();
    const headers = {
      Backpack: token,
      Accept: 'application/json',
      Caller: 'PP8',
      'Content-Type': 'application/json',
    };
    const sourceUrl = conf.agendaSourceUrl || `https://www.abstractsonline.com/pp8/#!/${eventId}`;

    const byKey = new Map<string, AppearanceRecord>();
    const fetchedPres = new Set<string>();
    let detailFetches = 0;

    for (const company of companies) {
      if (detailFetches >= OASIS_MAX_DETAIL_FETCHES) break;
      let ids: string[];
      try {
        ids = await searchPresentationIds(routes, headers, company, OASIS_MAX_PRES_PER_COMPANY);
      } catch {
        continue; // one company's search failing shouldn't abort the others
      }
      for (const id of ids) {
        if (detailFetches >= OASIS_MAX_DETAIL_FETCHES) break;
        if (fetchedPres.has(id)) continue;
        fetchedPres.add(id);
        detailFetches += 1;
        try {
          const detail = (await (await fetch(routes.presentation(id), { headers })).json()) as
            Parameters<typeof presentationDetailToAppearances>[0];
          for (const rec of presentationDetailToAppearances(detail, company, sourceUrl)) {
            byKey.set(`${rec.speakerName.toLowerCase()}|${id}`, rec);
          }
        } catch {
          // skip a bad detail; keep going
        }
      }
    }
    return [...byKey.values()];
  },
};
