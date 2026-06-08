import Anthropic from '@anthropic-ai/sdk';
import { recordLlmUsageEvent } from '@/lib/llm-usage';

type ApolloEmploymentLike = {
  organization_name?: string | null;
  title?: string | null;
  current?: boolean | null;
};

type ApolloPersonLike = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  employment_history?: ApolloEmploymentLike[] | null;
};

export type LinkedinResolutionInput = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  location?: string | null;
  apollo_person?: ApolloPersonLike | null;
};

export type LinkedinResolutionResult = {
  linkedin_url: string | null;
  source: 'csv' | 'apollo' | 'anthropic_search' | 'openrouter_search' | null;
  confidence: number;
  search_summary?: string | null;
};

const SEARCH_MODEL = 'claude-sonnet-4-6';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
// Fallback when Anthropic web search is unavailable (e.g. credits exhausted).
// perplexity/sonar is a cheap, web-search-native model — the prompt still
// demands a linkedin.com/in URL + >=0.8 confidence, so off-target results filter out.
const OPENROUTER_SEARCH_MODEL = 'perplexity/sonar';

function normalizeString(value?: string | null): string {
  return (value || '').trim();
}

function normalizeDomain(value?: string | null): string | null {
  const trimmed = normalizeString(value).toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function normalizeLinkedinProfileUrl(value?: string | null): string | null {
  const trimmed = normalizeString(value);
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
    const path = url.pathname.replace(/\/+$/, '');

    if (hostname !== 'linkedin.com') return null;
    if (!path.startsWith('/in/') && !path.startsWith('/pub/')) return null;

    return `https://www.linkedin.com${path}`;
  } catch {
    return null;
  }
}

function summarizeApolloEmployment(person?: ApolloPersonLike | null): string {
  const history = (person?.employment_history || []).slice(0, 5);
  if (history.length === 0) return 'No Apollo employment history available.';

  return history
    .map((job) => {
      const org = normalizeString(job.organization_name) || 'Unknown organization';
      const title = normalizeString(job.title) || 'Unknown title';
      const current = job.current ? 'current' : 'past';
      return `${org} — ${title} (${current})`;
    })
    .join('; ');
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }
  return new Anthropic({ apiKey });
}

function extractTextBlocks(message: any): string {
  const texts: string[] = [];

  for (const item of arrayFromUnknown(message?.content)) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type !== 'text') continue;

    const textValue = typeof block.text === 'string' ? block.text : '';
    if (textValue.trim()) {
      texts.push(textValue.trim());
    }
  }

  return texts.join('\n').trim();
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseResolutionJson(text: string): { linkedin_url?: string | null; confidence?: number; summary?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]) as { linkedin_url?: string | null; confidence?: number; summary?: string };
  } catch {
    return null;
  }
}

/** Shared prompt for both the Anthropic and perplexity searchers. */
function buildResolutionPrompt(input: LinkedinResolutionInput): {
  prompt: string;
  fullName: string;
  companyDomain: string | null;
} {
  const fullName =
    normalizeString(input.full_name) ||
    [normalizeString(input.first_name), normalizeString(input.last_name)].filter(Boolean).join(' ');
  const companyDomain = normalizeDomain(input.company_domain);
  const emailDomain = normalizeDomain(
    normalizeString(input.email).includes('@')
      ? normalizeString(input.email).split('@')[1]
      : null
  );
  const apolloPerson = input.apollo_person;
  const uploadedLinkedinHint = normalizeLinkedinProfileUrl(input.linkedin_url);

  const prompt = `Find the most likely personal LinkedIn profile URL for this person.

Return only valid JSON:
{
  "linkedin_url": "<personal LinkedIn profile URL or null>",
  "confidence": <number between 0 and 1>,
  "summary": "<short explanation>"
}

Rules:
- Only return a personal LinkedIn profile URL (linkedin.com/in/...), not a company page.
- Only return a URL if confidence is at least 0.8.
- If you are not confident, return null for linkedin_url.
- Prefer exact matches that align across name, company hints, email-domain hints, location, and Apollo employment history.
- Treat company and domain hints as search clues, not as guaranteed current-employment truth.
- Treat any uploaded LinkedIn URL as a low-confidence hint, not as proof that it is the correct profile.

Person context:
- Full name: ${fullName || 'Unknown'}
- Email: ${normalizeString(input.email) || 'Unknown'}
- Email domain hint: ${emailDomain || 'Unknown'}
- Company name hint: ${normalizeString(input.company_name) || 'Unknown'}
- Company domain hint: ${companyDomain || 'Unknown'}
- Location hint: ${normalizeString(input.location) || normalizeString(apolloPerson?.city) || normalizeString(apolloPerson?.country) || 'Unknown'}
- Uploaded LinkedIn URL hint: ${uploadedLinkedinHint || 'None provided'}
- Apollo person name: ${normalizeString(apolloPerson?.name) || 'Unknown'}
- Apollo employment history: ${summarizeApolloEmployment(apolloPerson)}
`;

  return { prompt, fullName, companyDomain };
}

/** Turn an LLM's text answer into a result, applying the linkedin.com + >=0.8 gate. */
function interpretResolution(
  text: string,
  source: 'anthropic_search' | 'openrouter_search',
): LinkedinResolutionResult {
  const parsed = parseResolutionJson(text);
  const normalizedUrl = normalizeLinkedinProfileUrl(parsed?.linkedin_url || null);
  const confidence = typeof parsed?.confidence === 'number' ? parsed.confidence : 0;

  if (!normalizedUrl || confidence < 0.8) {
    return {
      linkedin_url: null,
      source: null,
      confidence: confidence || 0,
      search_summary: parsed?.summary || text || null,
    };
  }
  return { linkedin_url: normalizedUrl, source, confidence, search_summary: parsed?.summary || null };
}

async function searchLinkedinUrlWithAnthropic(input: LinkedinResolutionInput): Promise<LinkedinResolutionResult> {
  const client = getAnthropicClient();
  const { prompt, fullName, companyDomain } = buildResolutionPrompt(input);

  const message = await client.messages.create({
    model: SEARCH_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 4,
        allowed_domains: ['linkedin.com'],
      },
    ],
  });
  await recordLlmUsageEvent({
    provider: 'anthropic',
    feature: 'linkedin_url_resolution',
    route: 'lib/linkedin-url-resolver#searchLinkedinUrlWithAnthropic',
    model: SEARCH_MODEL,
    usage: message.usage,
    metadata: {
      full_name: fullName || null,
      company_name: normalizeString(input.company_name) || null,
      company_domain: companyDomain,
      tool: 'web_search_20250305',
    },
  });

  return interpretResolution(extractTextBlocks(message), 'anthropic_search');
}

/**
 * Fallback web-search resolution via OpenRouter (perplexity/sonar). Used when
 * the direct-Anthropic web search is unavailable — most importantly when the
 * Anthropic balance is exhausted — so enrichment doesn't hard-stop on one
 * provider being down. perplexity/sonar does its own web search natively.
 */
async function searchLinkedinUrlWithPerplexity(input: LinkedinResolutionInput): Promise<LinkedinResolutionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
  const { prompt, fullName, companyDomain } = buildResolutionPrompt(input);

  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_SEARCH_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter LinkedIn search failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json?.choices?.[0]?.message?.content || '';

  await recordLlmUsageEvent({
    provider: 'openrouter',
    feature: 'linkedin_url_resolution',
    route: 'lib/linkedin-url-resolver#searchLinkedinUrlWithPerplexity',
    model: OPENROUTER_SEARCH_MODEL,
    usage: {
      input_tokens: json?.usage?.prompt_tokens,
      output_tokens: json?.usage?.completion_tokens,
    },
    metadata: {
      full_name: fullName || null,
      company_name: normalizeString(input.company_name) || null,
      company_domain: companyDomain,
      tool: 'perplexity_web_search',
    },
  });

  return interpretResolution(text, 'openrouter_search');
}

export async function resolveLinkedinUrl(input: LinkedinResolutionInput): Promise<LinkedinResolutionResult> {
  const apolloUrl = normalizeLinkedinProfileUrl(input.apollo_person?.linkedin_url || null);
  if (apolloUrl) {
    return {
      linkedin_url: apolloUrl,
      source: 'apollo',
      confidence: 0.95,
      search_summary: null,
    };
  }

  // Web-search resolution: Anthropic (web_search, linkedin-scoped) is primary;
  // on failure (e.g. Anthropic credits exhausted / outage) fall back to
  // perplexity/sonar via OpenRouter so resolution survives an Anthropic outage.
  // If BOTH fail, return a null result (don't throw) so the caller stores the
  // contact with a failure_reason instead of crashing the whole enrichment.
  try {
    return await searchLinkedinUrlWithAnthropic(input);
  } catch (anthropicError) {
    console.warn(
      '[linkedin-resolver] Anthropic search failed, falling back to perplexity/sonar:',
      anthropicError instanceof Error ? anthropicError.message : anthropicError,
    );
    try {
      return await searchLinkedinUrlWithPerplexity(input);
    } catch (fallbackError) {
      console.error(
        '[linkedin-resolver] perplexity fallback also failed:',
        fallbackError instanceof Error ? fallbackError.message : fallbackError,
      );
      return { linkedin_url: null, source: null, confidence: 0, search_summary: null };
    }
  }
}
