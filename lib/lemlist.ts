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

// ── Sequence shape used by our app ────────────────────────────────────────

/**
 * A single step in a generated sequence. The channel selector lives in the
 * /outreach editor's cell side panel — defaults to 'email'.
 */
export interface AppSequenceStep {
  day_offset: number;
  subject: string;
  body: string;
  /** 'email' | 'linkedin'. Stored per-message; used by the channel router. */
  channel?: 'email' | 'linkedin';
}

/**
 * Flatten our app's 7-step sequence + anchor context into lemlist customVars.
 *
 * lemlist exposes anything passed alongside the reserved lead fields as
 * {{key}} interpolation tokens in the campaign template. We emit:
 *   subject_1, body_1, channel_1, day_offset_1, … subject_7, body_7, …
 *   anchor_hook, anchor_signal_type
 *
 * The customer's lemlist template references {{subject_1}} / {{body_1}} in
 * its step 1 email, {{subject_2}} / {{body_2}} in step 2, etc. — so the
 * cadence shape is owned by lemlist (the template), and the content is
 * owned by our LLM (these vars). Channel selection is informational in v1:
 * the lemlist template decides actual send channel; channel_N is exposed
 * so the customer can branch templates if they want.
 */
export function flattenSequenceToCustomVars(
  messages: AppSequenceStep[],
  anchor: { hookText: string; signalType?: string | null },
): Record<string, string> {
  const vars: Record<string, string> = {
    anchor_hook: anchor.hookText,
    anchor_signal_type: anchor.signalType ?? '',
  };
  messages.forEach((m, i) => {
    const n = i + 1;
    vars[`subject_${n}`] = m.subject;
    vars[`body_${n}`] = m.body;
    vars[`channel_${n}`] = m.channel ?? 'email';
    vars[`day_offset_${n}`] = String(m.day_offset);
  });
  return vars;
}

/**
 * One-call dispatch: take an app-shaped sequence + a chosen campaign +
 * the contact's basic details, hand it to lemlist as a lead.
 *
 * Returns the lemlist lead id (when available) so we can store it in
 * outreach_sequences.external_ref and use it for reply-webhook matching.
 */
export async function dispatchSequence(
  apiKey: string,
  args: {
    campaignId: string;
    contact: {
      email: string;
      firstName?: string;
      lastName?: string;
      companyName?: string;
      linkedinUrl?: string;
      phone?: string;
    };
    messages: AppSequenceStep[];
    anchor: { hookText: string; signalType?: string | null };
  },
): Promise<LemlistAddLeadResult> {
  const customVars = flattenSequenceToCustomVars(args.messages, args.anchor);
  return addLeadToCampaign(apiKey, args.campaignId, {
    ...args.contact,
    customVars,
  });
}

/**
 * Look up a lead's current state in a lemlist campaign. Used by the /outreach
 * page to poll for replies as a fallback when the reply webhook isn't wired.
 *
 * lemlist's lead state values include: paused, deleted, sent, opened, clicked,
 * replied, bounced, optedOut, etc. We collapse them into our 4-state model
 * (sent/replied/failed) for the dispatch_status column.
 */
export async function getLeadState(
  apiKey: string,
  campaignId: string,
  email: string,
): Promise<{ state: string | null } | null> {
  try {
    const data = await lemlistFetch<{ state?: string; emailsReplied?: number; linkedinReplied?: number }>(
      apiKey,
      `/campaigns/${encodeURIComponent(campaignId)}/leads/${encodeURIComponent(email)}`,
    );
    // Some responses surface emailsReplied / linkedinReplied counters even when
    // 'state' isn't authoritative — treat any positive count as a reply.
    const replied = (data.emailsReplied ?? 0) > 0 || (data.linkedinReplied ?? 0) > 0;
    if (replied) return { state: 'replied' };
    return { state: data.state ?? null };
  } catch {
    return null;
  }
}

// ── Arcova template auto-provisioning ─────────────────────────────────────
// Customers shouldn't have to hand-build a 7-step template in lemlist's UI.
// On first dispatch (or via Settings) we look for a campaign named "Arcova
// Multichannel" on their account, and create one if it's missing — with the
// canonical step shape + {{subject_N}}/{{body_N}} interpolation tokens so
// the customVars our dispatch sends actually land in the right slots.

export const ARCOVA_TEMPLATE_NAME = 'Arcova Multichannel';

interface LemlistCampaignCreateResponse {
  _id: string;
  sequenceId?: string;
  scheduleIds?: string[];
}

/** Step shape we send to lemlist's POST /sequences/{id}/steps. */
type LemlistStepInput =
  | { type: 'email'; delay: number; subject: string; message: string }
  | { type: 'linkedinInvite'; delay: number; message?: string }
  | { type: 'linkedinSend'; delay: number; message: string };

/**
 * Canonical 7-step Arcova template — delays are RELATIVE (days since the
 * previous step). Mirrors the cadence the generator + stage endpoint use.
 *
 * Each step references the matching customVar slot — when dispatch pushes
 * a lead with subject_1/body_1/…/body_6 vars, lemlist interpolates them
 * into these templates per-lead.
 */
const ARCOVA_TEMPLATE_STEPS: LemlistStepInput[] = [
  // Day 1 — Email #1 (first send, delay from campaign start)
  { type: 'email',          delay: 1, subject: '{{subject_1}}', message: '{{body_1}}' },
  // Day 4 — Email #2  (+3 days)
  { type: 'email',          delay: 3, subject: '{{subject_2}}', message: '{{body_2}}' },
  // Day 7 — LinkedIn invite (+3 days). Pure connect action — no personalised note for now.
  { type: 'linkedinInvite', delay: 3 },
  // Day 8 — LinkedIn message (+1 day)
  { type: 'linkedinSend',   delay: 1, message: '{{body_4}}' },
  // Day 11 — Email (+3 days)
  { type: 'email',          delay: 3, subject: '{{subject_5}}', message: '{{body_5}}' },
  // Day 14 — LinkedIn message (+3 days)
  { type: 'linkedinSend',   delay: 3, message: '{{body_6}}' },
  // Day 21 — Email breakup (+7 days)
  { type: 'email',          delay: 7, subject: '{{subject_7}}', message: '{{body_7}}' },
];

/**
 * Find or create the Arcova Multichannel campaign template on the user's
 * lemlist account. Idempotent — safe to call from dispatch every time.
 *
 * Returns { campaignId, created } where `created` is true only when we just
 * provisioned (so callers can surface a one-time "set up template" toast).
 */
export async function ensureArcovaTemplate(
  apiKey: string,
): Promise<{ campaignId: string; created: boolean }> {
  // 1. Look for an existing campaign by name.
  const campaigns = await listCampaigns(apiKey).catch(() => [] as LemlistCampaign[]);
  const existing = campaigns.find((c) => c.name?.trim() === ARCOVA_TEMPLATE_NAME);
  if (existing?._id) {
    return { campaignId: existing._id, created: false };
  }

  // 2. Create a new campaign.
  const created = await lemlistFetch<LemlistCampaignCreateResponse>(apiKey, '/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name: ARCOVA_TEMPLATE_NAME,
      autoReview: true,
      // Use UTC so dispatch behaviour is predictable across customers.
      timezone: 'Etc/UTC',
    }),
  });
  const sequenceId = created.sequenceId;
  if (!sequenceId) {
    throw new LemlistError(500, 'lemlist POST /campaigns did not return a sequenceId');
  }

  // 3. Add the 7 steps in order.
  for (const step of ARCOVA_TEMPLATE_STEPS) {
    await lemlistFetch<unknown>(
      apiKey,
      `/sequences/${encodeURIComponent(sequenceId)}/steps`,
      { method: 'POST', body: JSON.stringify(step) },
    );
  }

  return { campaignId: created._id, created: true };
}

export function dispatchStatusFromLemlistState(state: string | null): 'sent' | 'replied' | 'failed' | null {
  if (!state) return null;
  const s = state.toLowerCase();
  if (s.includes('replied')) return 'replied';
  if (s === 'bounced' || s === 'optedout' || s === 'failed') return 'failed';
  // Anything else (sent, opened, clicked, paused, etc.) stays as 'sent' in our model.
  return null;
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
