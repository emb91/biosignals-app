import Anthropic from '@anthropic-ai/sdk';

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
  source: 'csv' | 'apollo' | 'anthropic_search' | null;
  confidence: number;
  search_summary?: string | null;
};

const SEARCH_MODEL = 'claude-sonnet-4-6';

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

async function searchLinkedinUrlWithAnthropic(input: LinkedinResolutionInput): Promise<LinkedinResolutionResult> {
  const client = getAnthropicClient();

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
- Only return a personal LinkedIn profile URL, not a company page.
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

  const text = extractTextBlocks(message);
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

  return {
    linkedin_url: normalizedUrl,
    source: 'anthropic_search',
    confidence,
    search_summary: parsed?.summary || null,
  };
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

  return searchLinkedinUrlWithAnthropic(input);
}
