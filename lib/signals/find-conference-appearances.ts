/**
 * Find recent and upcoming conference appearances for a single company via
 * Sonnet 4.6 + web_search.
 *
 * The LLM is anchored on a biotech-relevant conference taxonomy and is
 * instructed to return only events it can cite. Speculative or
 * unverifiable entries should come back empty rather than fabricated.
 *
 * Cost shape per call:
 *   - Sonnet 4.6 with web_search (max_uses: 6)
 *   - ~5-12K input tokens (search results pulled in), ~600 output tokens
 *   - ~$0.05-0.10 per call
 *
 * Cached in company_conference_appearances + companies.conferences_checked_at.
 * Re-runs are gated by the monitor — this module is a pure LLM helper.
 */
import Anthropic from '@anthropic-ai/sdk';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

const ANALYSIS_MODEL = 'claude-sonnet-4-6';
const MAX_WEB_SEARCHES = 6;

export type ConferenceAppearance = {
  conference_name: string;
  conference_dates_text: string | null;
  conference_start_date: string | null; // ISO YYYY-MM-DD
  conference_end_date: string | null;   // ISO YYYY-MM-DD
  location: string | null;
  appearance_type:
    | 'presentation'
    | 'speaker'
    | 'panel'
    | 'poster'
    | 'exhibitor'
    | 'sponsor'
    | 'attendee'
    | 'other';
  session_title: string | null;
  speaker_name: string | null;
  speaker_title: string | null;
  abstract_url: string | null;
  source_url: string | null;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
};

export type FindConferenceAppearancesInput = {
  companyName: string;
  aliases?: string[];
  domain?: string | null;
  /** Override the lookahead/lookbehind window (default ±90 days). */
  windowDays?: number;
};

export type FindConferenceAppearancesResult = {
  appearances: ConferenceAppearance[];
  raw_output: string;
};

const ALLOWED_APPEARANCE_TYPES: ReadonlySet<ConferenceAppearance['appearance_type']> =
  new Set([
    'presentation',
    'speaker',
    'panel',
    'poster',
    'exhibitor',
    'sponsor',
    'attendee',
    'other',
  ]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPrompt(opts: FindConferenceAppearancesInput): string {
  const aliases = (opts.aliases ?? []).filter((a) => a && a.trim().length > 0);
  const aliasLine = aliases.length > 0 ? `\nKnown aliases / subsidiaries: ${aliases.join(', ')}` : '';
  const domainLine = opts.domain ? `\nDomain: ${opts.domain}` : '';
  const windowDays = opts.windowDays ?? 90;

  return `You are researching conference appearances for a B2B biotech sales-intelligence platform.

Company: ${opts.companyName}${aliasLine}${domainLine}
Today is ${todayIso()}.

Use web search to find SPECIFIC events in the window [today − ${windowDays} days, today + ${windowDays} days] where this company is or was:
 - presenting research, posters, or abstracts
 - speaking on panels or giving keynotes
 - hosting investor / partnering / R&D Day meetings
 - sponsoring or exhibiting at major conferences
 - announcing a product or data release at a conference

Prioritise these biotech-relevant conference families:
 - Oncology: ASCO Annual Meeting, ASCO GU/GI/BR, ASH Annual Meeting, AACR Annual Meeting, SITC, ESMO Congress, EHA
 - Diagnostics / genomics / molecular: AGBT, ASHG, AMP, AACC, ESHG, ASGCT, ESGCT
 - Investor / strategic / partnering: JPM Healthcare Conference, BIO International, Cowen Healthcare, BIO CEO & Investor, BIO-Europe, LSX
 - Clinical / regulatory: DIA Global, FDA workshops, ACR (rheumatology), RSNA (radiology), HIMSS (health IT)
 - Therapeutic-area: AHA Scientific Sessions, AAN, ATS, ARVO, ENDO, AAAAI, IDWeek, CROI
 - Lab tech / instrumentation: Pittcon, SLAS, ASCB

Return ONLY valid JSON. No markdown fences, no prose. Shape:

{
  "appearances": [
    {
      "conference_name": "ASCO Annual Meeting 2026",
      "conference_dates_text": "May 30 – June 3, 2026",
      "conference_start_date": "2026-05-30",
      "conference_end_date": "2026-06-03",
      "location": "Chicago, IL",
      "appearance_type": "presentation",
      "session_title": "Phase 2 trial of XYZ in metastatic breast cancer",
      "speaker_name": "Dr. Jane Doe",
      "speaker_title": "Chief Medical Officer",
      "abstract_url": "https://meetings.asco.org/abstracts-presentations/XXXX",
      "source_url": "https://www.example.com/press-release",
      "confidence": "high",
      "rationale": "Single sentence in plain English describing what is happening, suitable for a salesperson"
    }
  ]
}

Rules:
 - Only include events you can cite with a specific URL (press release, abstract listing, conference programme page, news article). The source_url is REQUIRED.
 - Do NOT invent dates, speakers, or session titles. If a field is unknown, use null.
 - confidence: "high" when the source is the conference's own programme or the company's own press release; "medium" when reputable third-party news; "low" when only inferred from social media or partial mentions.
 - appearance_type values: presentation | speaker | panel | poster | exhibitor | sponsor | attendee | other.
 - If no qualifying appearances are found in the window, return {"appearances": []}.
 - Be conservative. Skip generic "they attend ASCO every year" claims unless tied to a specific year/session.`;
}

function extractTextBlocks(message: { content?: unknown }): string {
  const blocks = Array.isArray(message?.content) ? (message.content as unknown[]) : [];
  return blocks
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => (b.text as string).trim())
    .join('\n')
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let candidate = text.trim();
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function coerceString(value: unknown, maxLen = 500): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function coerceIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function coerceConfidence(value: unknown): 'low' | 'medium' | 'high' {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function coerceAppearanceType(value: unknown): ConferenceAppearance['appearance_type'] {
  if (typeof value === 'string' && ALLOWED_APPEARANCE_TYPES.has(value as ConferenceAppearance['appearance_type'])) {
    return value as ConferenceAppearance['appearance_type'];
  }
  return 'other';
}

function normalizeAppearance(raw: Record<string, unknown>): ConferenceAppearance | null {
  const conferenceName = coerceString(raw.conference_name, 300);
  const rationale = coerceString(raw.rationale, 600);
  const sourceUrl = coerceString(raw.source_url, 600);
  if (!conferenceName || !rationale || !sourceUrl) {
    // Hard requirement: conference name, rationale text, and a citation. Reject the appearance
    // rather than emit an evidence-less signal — the LLM is told this is required.
    return null;
  }
  return {
    conference_name: conferenceName,
    conference_dates_text: coerceString(raw.conference_dates_text, 200),
    conference_start_date: coerceIsoDate(raw.conference_start_date),
    conference_end_date: coerceIsoDate(raw.conference_end_date),
    location: coerceString(raw.location, 200),
    appearance_type: coerceAppearanceType(raw.appearance_type),
    session_title: coerceString(raw.session_title, 400),
    speaker_name: coerceString(raw.speaker_name, 200),
    speaker_title: coerceString(raw.speaker_title, 200),
    abstract_url: coerceString(raw.abstract_url, 600),
    source_url: sourceUrl,
    confidence: coerceConfidence(raw.confidence),
    rationale,
  };
}

export async function findConferenceAppearances(
  input: FindConferenceAppearancesInput,
): Promise<FindConferenceAppearancesResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey });

  const prompt = buildPrompt(input);
  const message = await client.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: MAX_WEB_SEARCHES,
      } as unknown as Parameters<typeof client.messages.create>[0] extends { tools?: Array<infer T> } ? T : never,
    ],
  });

  await recordLlmUsageEvent({
    provider: 'anthropic',
    feature: 'conferences_finder',
    route: 'lib/signals/find-conference-appearances#findConferenceAppearances',
    model: ANALYSIS_MODEL,
    usage: message.usage,
    metadata: {
      company_name: input.companyName,
      tool: 'web_search_20250305',
    },
  });

  const rawText = extractTextBlocks(message as { content?: unknown });
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    // Model returned no parseable JSON — treat as empty result rather than throwing.
    return { appearances: [], raw_output: rawText };
  }
  const rawAppearances = Array.isArray(parsed.appearances) ? parsed.appearances : [];
  const appearances: ConferenceAppearance[] = [];
  for (const item of rawAppearances) {
    if (item && typeof item === 'object') {
      const normalized = normalizeAppearance(item as Record<string, unknown>);
      if (normalized) appearances.push(normalized);
    }
  }
  return { appearances, raw_output: rawText };
}
