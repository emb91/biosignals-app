/**
 * Map Your Show adapter — REFERENCE implementation (already proven).
 *
 * Map Your Show powers BIO, AACR, and many others. The exhibitor list is
 * available as a public PDF export with no auth:
 *
 *   https://{code}.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf
 *
 * where {code} is the show code (e.g. "bio2026"). The PDF is a simple list of
 * "Name … Booth" rows. BIO 2026 returned ~1,630 rows ("as of 6/23/26").
 *
 * ── Font encoding: use ToUnicode, NOT a hardcoded offset ───────────────────
 * IMPORTANT (corrected from the initial spike): the "+29 offset" is an ARTIFACT
 * of crude raw-stream extraction (zlib-inflate the content stream + read glyph
 * codes naively), where BIO 2026's subset font happened to be shifted +29.
 * It is NOT a stable property — subset-font offsets are assigned per-document,
 * so other shows (or a re-export) may differ or have none.
 *
 * The PRODUCTION parser should decode via the PDF's own font encoding (the
 * ToUnicode CMap), which pdfjs-dist applies automatically in getTextContent() —
 * that yields correct text with NO offset hack. Only if a given PDF lacks a
 * usable ToUnicode map do we fall back to a per-document *calibrated* offset
 * (anchor on a known header token like "Booth" to learn the shift), never a
 * hardcoded constant. `decodeMysGlyphs` below is kept ONLY as that calibrated
 * fallback, not the primary path.
 *
 * Implementation: `extractPdfRows` decodes the PDF with `unpdf` (pdfjs-dist),
 * keeps each text fragment's (x, y), and `rowsFromPositionedText` rebuilds the
 * two-column table — splitting name vs. booth by x, re-joining wrapped names by
 * y — then runs each row through the stable, load-bearing `splitMysRow`.
 */
import type { ConferenceAdapter, ConferenceForFetch, ExhibitorRecord } from './types';

/**
 * Per-document fallback offset only (BIO 2026 happened to be +29). NOT a stable
 * constant — see file header. Production decodes via the font ToUnicode (pdfjs);
 * this is used only when calibration determines a fixed shift is needed.
 */
export const MYS_GLYPH_OFFSET_FALLBACK = 29;

/**
 * Calibrated-fallback decode: apply a known per-document offset to stored glyph
 * codes. Default offset is the BIO-observed 29; callers that calibrate should
 * pass the learned value. Exported for the test stub.
 */
export function decodeMysGlyphs(storedCodes: number[], offset: number = MYS_GLYPH_OFFSET_FALLBACK): string {
  return storedCodes.map((code) => String.fromCharCode(code + offset)).join('');
}

/**
 * Calibrate the per-document glyph offset by anchoring on a header token we know
 * the export always prints ("Name" / "Booth"). Given the stored glyph codes for
 * a header item plus its known plaintext, learn the constant shift (or 0 if the
 * codes already decode cleanly via ToUnicode). Used ONLY on the fallback path
 * when a PDF lacks a usable ToUnicode map. Returns null if no single offset maps
 * the codes onto the expected text (so the caller can bail rather than emit
 * garbage). Exported for the test stub.
 */
export function calibrateMysOffset(headerCodes: number[], expectedText: string): number | null {
  if (headerCodes.length !== expectedText.length || headerCodes.length === 0) return null;
  const offset = expectedText.charCodeAt(0) - headerCodes[0];
  for (let i = 0; i < headerCodes.length; i++) {
    if (headerCodes[i] + offset !== expectedText.charCodeAt(i)) return null;
  }
  return offset;
}

/**
 * Build the public PDF-export URL for a show code.
 * Accepts either a bare show code ("bio2026") or a full URL (used verbatim).
 */
export function mapYourShowPdfUrl(codeOrUrl: string): string {
  if (/^https?:\/\//i.test(codeOrUrl)) return codeOrUrl;
  return `https://${codeOrUrl}.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf`;
}

/**
 * Split one decoded PDF line into { name, booth }. The export lays each row out
 * as "Company Name <runs of spaces / tab> Booth". Booth is the trailing
 * alphanumeric token (e.g. "1430", "SC-12"); everything before it is the name.
 */
export function splitMysRow(line: string): { name: string; booth?: string } | null {
  const raw = line.replace(/\s+$/g, '').replace(/^\s+/g, '');
  if (!raw) return null;
  // Booth = trailing token after a gap of 2+ whitespace chars (the layout
  // separator between name and booth). Match on the ORIGINAL spacing — do not
  // collapse whitespace first, or the 2+ gap disappears. Fall back to name-only.
  const m = raw.match(/^(.*?)\s{2,}([A-Za-z0-9-]+)$/);
  if (m && m[1].trim()) {
    return { name: m[1].replace(/\s+/g, ' ').trim(), booth: m[2].trim() };
  }
  return { name: raw.replace(/\s+/g, ' ').trim() };
}

/**
 * A positioned text fragment pulled from a PDF text layer. `x`/`y` are the
 * glyph-baseline coordinates in PDF user space (origin bottom-left).
 */
type PositionedText = { str: string; x: number; y: number };

/**
 * The export is a rigid two-column table: company names anchored at the left
 * margin (x ≈ 47) and booth labels in a right-hand column (x ≈ 451). Anything at
 * or past this x is a booth; anything before it is part of a name.
 */
const MYS_BOOTH_COLUMN_X = 400;

/**
 * Half the row pitch (rows sit ~22pt apart). A long company name wraps onto a
 * second line within the name column; both fragments fall within this band of
 * the booth's vertical center, so we can re-join them into one exhibitor.
 */
const MYS_ROW_BAND = 12;

/** Header/title tokens the export prints above the table — never exhibitors. */
const MYS_NON_EXHIBITOR = /^(name|booth)$/i;
const MYS_TITLE = /(International Convention|Exhibitor Listing)/i;

/**
 * Re-assemble the two-column "Name … Booth" rows from positioned PDF text.
 *
 * Pure + position-only, so it is unit-testable against a fixture without a
 * network call or a real PDF. Each page is processed independently (the export
 * never splits a single row across a page boundary). For every page we:
 *   1. split fragments into the name column vs. the booth column by x;
 *   2. attach each name fragment to the nearest booth within MYS_ROW_BAND
 *      (this re-joins wrapped multi-line names onto their booth);
 *   3. emit name fragments with no booth nearby as booth-less rows (some
 *      exhibitors genuinely list no booth yet).
 * Each reconstructed row is rendered as "<name>␣␣<booth>" and handed to the
 * load-bearing `splitMysRow` for the canonical name/booth split.
 */
export function rowsFromPositionedText(pages: PositionedText[][], sourceUrl: string): ExhibitorRecord[] {
  const out: ExhibitorRecord[] = [];
  for (const page of pages) {
    const names: PositionedText[] = [];
    const booths: PositionedText[] = [];
    for (const item of page) {
      const s = item.str.trim();
      if (!s) continue;
      if (item.x >= MYS_BOOTH_COLUMN_X) {
        booths.push({ str: s, x: item.x, y: item.y });
        continue;
      }
      if (MYS_NON_EXHIBITOR.test(s) || MYS_TITLE.test(s)) continue;
      names.push({ str: s, x: item.x, y: item.y });
    }

    const fragsByBooth = new Map<number, PositionedText[]>();
    const standalone: PositionedText[] = [];
    for (const name of names) {
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < booths.length; i++) {
        const d = Math.abs(booths[i].y - name.y);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best >= 0 && bestDist <= MYS_ROW_BAND) {
        const list = fragsByBooth.get(best);
        if (list) list.push(name);
        else fragsByBooth.set(best, [name]);
      } else {
        standalone.push(name);
      }
    }

    for (const [boothIdx, frags] of fragsByBooth) {
      // Top-to-bottom: a wrapped name reads first line (higher y) then second.
      frags.sort((a, b) => b.y - a.y);
      const line = `${frags.map((f) => f.str).join(' ')}  ${booths[boothIdx].str}`;
      const row = splitMysRow(line);
      if (row) out.push({ ...row, sourceUrl });
    }
    for (const name of standalone) {
      const row = splitMysRow(name.str);
      if (row) out.push({ ...row, sourceUrl });
    }
  }
  return out;
}

/**
 * Pull the raw PDF and extract decoded "Name … Booth" rows.
 *
 * Decodes via the PDF's own font encoding: `unpdf` (pdfjs-dist under the hood)
 * applies the ToUnicode CMap in getTextContent(), so BIO 2026's subset font
 * comes out as correct text with NO offset hack (the "+29" was a raw-stream
 * artifact — see the file header). We keep each fragment's (x, y) and rebuild
 * the two-column rows in `rowsFromPositionedText`.
 *
 * Fallback: if a given export ever lacks a usable ToUnicode map, calibrate a
 * per-document offset by anchoring on the "Name"/"Booth" header token
 * (`calibrateMysOffset` + `decodeMysGlyphs`) rather than hardcoding a constant.
 * BIO 2026's export does NOT need this path.
 */
async function extractPdfRows(pdfUrl: string): Promise<ExhibitorRecord[]> {
  const res = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'Arcova GTM conference-monitor (contact: emma@arcova.bio)' },
  });
  if (!res.ok) {
    throw new Error(`mapyourshow PDF fetch ${res.status} for ${pdfUrl}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  // Lazy import: keep the PDF reader out of the bundle for callers that never
  // hit a Map Your Show show.
  const { getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);

  const pages: PositionedText[][] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items: PositionedText[] = [];
    for (const item of content.items) {
      if (!('str' in item) || typeof item.str !== 'string') continue;
      // transform = [a, b, c, d, e, f]; e = x, f = y (glyph baseline origin).
      const transform = item.transform as number[];
      items.push({ str: item.str, x: transform[4], y: transform[5] });
    }
    pages.push(items);
  }

  return rowsFromPositionedText(pages, pdfUrl);
}

export const mapYourShowAdapter: ConferenceAdapter = {
  platform: 'mapyourshow',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const pdfUrl = mapYourShowPdfUrl(conf.exhibitorSourceUrl);
    const rows = await extractPdfRows(pdfUrl);
    return rows.map((r) => ({ ...r, sourceUrl: pdfUrl }));
  },
};
