// lemlist API adapter.
//
// Auth: HTTP Basic with empty username + API key as password.
// Each customer brings their own lemlist account + API key (stored in
// user_outreach_credentials). We never hold a master key.
//
// Docs reference: https://developer.lemlist.com/

import { createClient } from '@/lib/supabase-server';

const LEMLIST_BASE = 'https://api.lemlist.com/api';
export const LEMLIST_PROVIDER = 'lemlist';

// ── Types ─────────────────────────────────────────────────────────────────

export interface LemlistTeam {
  _id: string;
  name: string;
  createdBy?: string;
  createdAt?: string;
}

export interface LemlistCampaign {
  _id: string;
  name: string;
  status?: string;
  createdAt?: string;
}

export interface LemlistLeadInput {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  linkedinUrl?: string;
  phone?: string;
  // Arbitrary personalization variables — the LLM's generated hook, first line,
  // PS, etc. lemlist exposes these as {{customVar}} in the campaign template.
  customVars?: Record<string, string>;
}

export interface LemlistAddLeadResult {
  _id?: string;
  email: string;
  campaignId: string;
  state?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────

function authHeader(apiKey: string): string {
  // lemlist uses Basic auth with EMPTY username and key-as-password.
  // → base64(":<key>")
  return 'Basic ' + Buffer.from(':' + apiKey).toString('base64');
}

async function lemlistFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${LEMLIST_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(apiKey),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new LemlistError(res.status, body || res.statusText);
  }
  // Some lemlist endpoints return empty body on success.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export class LemlistError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`lemlist API error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

// ── Credential retrieval ──────────────────────────────────────────────────

/**
 * Fetch the current authenticated user's lemlist API key from the DB.
 * Returns null if not connected.
 */
export async function getLemlistKeyForCurrentUser(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('user_outreach_credentials')
    .select('api_key')
    .eq('user_id', user.id)
    .eq('provider', LEMLIST_PROVIDER)
    .maybeSingle();

  return data?.api_key ?? null;
}

// ── Public API operations ─────────────────────────────────────────────────

/** Verify a key works — used at connect time. Returns the team identity. */
export async function checkAuth(apiKey: string): Promise<LemlistTeam> {
  return lemlistFetch<LemlistTeam>(apiKey, '/team');
}

/** List campaigns on the account (used by the dispatch picker). */
export async function listCampaigns(apiKey: string): Promise<LemlistCampaign[]> {
  return lemlistFetch<LemlistCampaign[]>(apiKey, '/campaigns');
}

/**
 * Add a lead to a campaign + push personalization variables.
 *
 * lemlist treats anything outside the reserved fields as a customVar,
 * accessible as {{key}} in the campaign template. So if our LLM emits
 * { hook: "…", first_line: "…", ps: "…" }, those land as
 * {{hook}}, {{first_line}}, {{ps}} in the user's templated copy.
 */
export async function addLeadToCampaign(
  apiKey: string,
  campaignId: string,
  lead: LemlistLeadInput,
): Promise<LemlistAddLeadResult> {
  const { customVars, ...reserved } = lead;
  const body = { ...reserved, ...(customVars ?? {}) };
  return lemlistFetch<LemlistAddLeadResult>(
    apiKey,
    `/campaigns/${encodeURIComponent(campaignId)}/leads`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Pause a specific lead in a specific campaign (used for cross-channel pause). */
export async function pauseLead(
  apiKey: string,
  campaignId: string,
  email: string,
): Promise<void> {
  await lemlistFetch<unknown>(
    apiKey,
    `/campaigns/${encodeURIComponent(campaignId)}/leads/${encodeURIComponent(email)}/pause`,
    { method: 'POST' },
  );
}
