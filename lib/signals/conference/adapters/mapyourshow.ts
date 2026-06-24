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
 * Scaffold: `extractPdfRows` is where the pdfjs parse goes; row-splitting
 * (`splitMysRow`) is the stable, load-bearing part.
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
 * Pull the raw PDF and extract decoded "Name … Booth" rows.
 *
 * SCAFFOLD: wire the real PDF parse here (e.g. pdfjs-dist getDocument →
 * getTextContent, applying MYS_GLYPH_OFFSET per glyph). The proven decode +
 * row-split helpers above are what the extracted text must flow through.
 */
async function extractPdfRows(pdfUrl: string): Promise<ExhibitorRecord[]> {
  const res = await fetch(pdfUrl, {
    headers: { 'User-Agent': 'Arcova GTM conference-monitor (contact: emma@arcova.bio)' },
  });
  if (!res.ok) {
    throw new Error(`mapyourshow PDF fetch ${res.status} for ${pdfUrl}`);
  }
  const _bytes = new Uint8Array(await res.arrayBuffer());
  // TODO(productionize): parse `_bytes` with a PDF reader, decode each glyph via
  // decodeMysGlyphs(...) (the +29 offset), join into lines, then map each line
  // through splitMysRow(...) to produce ExhibitorRecord rows. Returning [] for
  // now keeps the scaffold compiling without bundling a PDF dependency.
  return [];
}

export const mapYourShowAdapter: ConferenceAdapter = {
  platform: 'mapyourshow',
  async fetchExhibitors(conf: ConferenceForFetch): Promise<ExhibitorRecord[]> {
    const pdfUrl = mapYourShowPdfUrl(conf.exhibitorSourceUrl);
    const rows = await extractPdfRows(pdfUrl);
    return rows.map((r) => ({ ...r, sourceUrl: pdfUrl }));
  },
};
