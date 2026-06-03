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
export const ARCOVA_SCHEDULE_NAME = 'Arcova Mon-Fri';

interface LemlistCampaignCreateResponse {
  _id: string;
  sequenceId?: string;
  scheduleIds?: string[];
}

interface LemlistScheduleCreateResponse {
  _id: string;
  name?: string;
}

/**
 * Provision a Mon-Fri business-hours schedule, idempotent on name.
 * weekdays: 1=Monday … 7=Sunday — we ship [1..5] so no weekend sends.
 */
async function ensureArcovaSchedule(apiKey: string): Promise<string> {
  // No "list schedules" endpoint exposed in the v2 docs, so we always POST
  // and rely on lemlist returning the existing one for duplicate names.
  // If lemlist creates duplicates instead, that's a cosmetic issue — the
  // campaign only ends up associated with one schedule via the associate call.
  const created = await lemlistFetch<LemlistScheduleCreateResponse>(apiKey, '/schedules', {
    method: 'POST',
    body: JSON.stringify({
      name: ARCOVA_SCHEDULE_NAME,
      timezone: 'Etc/UTC',
      start: '09:00',
      end: '17:00',
      weekdays: [1, 2, 3, 4, 5],
      secondsToWait: 600,
      public: false,
    }),
  });
  return created._id;
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

  // 4. Associate a Mon-Fri schedule so leads aren't sent to on weekends.
  // Best-effort: if schedule creation/association fails we don't blow up
  // the whole provisioning — the campaign still works on lemlist's default
  // schedule, which the customer can fix in the lemlist UI.
  try {
    const scheduleId = await ensureArcovaSchedule(apiKey);
    await lemlistFetch<unknown>(
      apiKey,
      `/campaigns/${encodeURIComponent(created._id)}/schedules/${encodeURIComponent(scheduleId)}`,
      { method: 'POST' },
    );
  } catch (err) {
    console.warn('[lemlist] schedule provisioning failed (campaign still usable):', err);
  }

  return { campaignId: created._id, created: true };
}

// ── Per-user sync of all sent rows ─────────────────────────────────────────
// Shared between the on-demand /api/outreach/lemlist/sync-status route and
// the daily cron job. Caller passes a supabase client (anon or service-role)
// + the user_id; returns how many rows had a status change.

const MAX_SYNC_ROWS_PER_USER = 50;

interface SyncSentRow {
  id: string;
  anchor_hook_text: string;
  messages: Array<{
    day_offset: number;
    subject: string;
    body: string;
    channel?: 'email' | 'linkedin';
    sent_at?: string | null;
    opens?: number | null;
    clicks?: number | null;
    replies?: number | null;
  }>;
  external_ref: {
    lemlist_lead_id?: string | null;
    lemlist_campaign_id?: string | null;
    lemlist_lead_email?: string | null;
  } | null;
}

type SyncSupabase = {
  from: (table: string) => unknown;
};

export async function syncUserOutreachStatus(
  supabase: SyncSupabase,
  userId: string,
  apiKey: string,
  hubspotPush?: (email: string, status: 'replied' | 'failed', anchor: string) => Promise<void>,
): Promise<{ checked: number; changed: number }> {
  // We type-assert here because the calling sites pass either a server-side
  // Supabase client or the admin client; both have the same query shape.
  const sb = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          in: (col: string, vals: string[]) => {
            order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => {
              limit: (n: number) => Promise<{ data: SyncSentRow[] | null }>;
            };
          };
        };
      };
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<unknown>;
        };
      };
    };
  };

  const { data: rows } = await sb
    .from('outreach_sequences')
    .select('id, anchor_hook_text, messages, external_ref')
    .eq('user_id', userId)
    .in('dispatch_status', ['sent', 'queued'])
    .order('last_status_at', { ascending: true, nullsFirst: true })
    .limit(MAX_SYNC_ROWS_PER_USER);

  const sentRows = rows ?? [];
  if (sentRows.length === 0) return { checked: 0, changed: 0 };

  let changed = 0;
  for (const row of sentRows) {
    const campaignId = row.external_ref?.lemlist_campaign_id;
    const email = row.external_ref?.lemlist_lead_email;
    const leadId = row.external_ref?.lemlist_lead_id;
    if (!campaignId || !email) continue;

    // Per-step send confirmations + engagement counters (opens/clicks/replies).
    let messagesUpdate: SyncSentRow['messages'] | null = null;
    if (leadId) {
      const activities = await getLeadActivities(apiKey, leadId);
      const sentAtBySeqStep = reduceActivitiesToSentSteps(activities);
      const engagementBySeqStep = reduceActivitiesToEngagement(activities);
      let anyChange = false;
      const updated = row.messages.map((m, i) => {
        const sentAt = sentAtBySeqStep[i];
        const eng = engagementBySeqStep[i];
        const nextSentAt = sentAt && m.sent_at !== sentAt ? sentAt : m.sent_at;
        const nextOpens = eng?.opens ?? m.opens ?? 0;
        const nextClicks = eng?.clicks ?? m.clicks ?? 0;
        const nextReplies = eng?.replies ?? m.replies ?? 0;
        const changed =
          nextSentAt !== m.sent_at ||
          nextOpens !== (m.opens ?? 0) ||
          nextClicks !== (m.clicks ?? 0) ||
          nextReplies !== (m.replies ?? 0);
        if (changed) anyChange = true;
        return {
          ...m,
          sent_at: nextSentAt,
          opens: nextOpens,
          clicks: nextClicks,
          replies: nextReplies,
        };
      });
      if (anyChange) messagesUpdate = updated;
    }

    // Sequence-level flip
    const state = await getLeadState(apiKey, campaignId, email);
    const newStatus = state ? dispatchStatusFromLemlistState(state.state) : null;

    if (messagesUpdate || newStatus) {
      const patch: Record<string, unknown> = {};
      if (messagesUpdate) patch.messages = messagesUpdate;
      if (newStatus) {
        patch.dispatch_status = newStatus;
        patch.last_status_at = new Date().toISOString();
      }
      await sb.from('outreach_sequences').update(patch).eq('id', row.id).eq('user_id', userId);
      changed++;
    }

    if (hubspotPush && (newStatus === 'replied' || newStatus === 'failed')) {
      try {
        await hubspotPush(email, newStatus, row.anchor_hook_text);
      } catch {
        // best-effort
      }
    }
  }

  return { checked: sentRows.length, changed };
}

// ── Per-step activities ────────────────────────────────────────────────────
// lemlist's v2 activities endpoint returns one row per event (emailSent,
// linkedinSent, etc.) with a sequenceStep (zero-indexed) + createdAt. We
// fetch this per lead from the sync-status route to produce real per-step
// "sent at" timestamps for the /outreach table, replacing the date-math
// approximation.

export interface LemlistActivity {
  _id: string;
  type: string;
  leadId: string;
  campaignId: string;
  sequenceStep: number;
  createdAt: string;
}

const ACTIVITY_SENT_TYPES = new Set([
  'emailsSent',
  'linkedinSent',
  'linkedinInviteSent',
  'linkedinInviteAccepted',
  'linkedinMessageSent',
]);

/** Pull all activities for a single lead. ≤100 per page; we page until empty. */
export async function getLeadActivities(
  apiKey: string,
  leadId: string,
  opts: { maxPages?: number } = {},
): Promise<LemlistActivity[]> {
  const maxPages = opts.maxPages ?? 5;
  const out: LemlistActivity[] = [];
  for (let page = 0; page < maxPages; page++) {
    try {
      const data = await lemlistFetch<{ activities?: LemlistActivity[] } | LemlistActivity[]>(
        apiKey,
        `/activities?version=v2&leadId=${encodeURIComponent(leadId)}&offset=${page * 100}&limit=100`,
      );
      const batch = Array.isArray(data) ? data : (data.activities ?? []);
      if (batch.length === 0) break;
      out.push(...batch);
      if (batch.length < 100) break;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Reduce activities into per-step send timestamps. Returns a map of
 * sequenceStep → ISO datetime of the FIRST "sent" event for that step.
 * Step is zero-indexed (matches lemlist's sequenceStep field).
 */
export function reduceActivitiesToSentSteps(
  activities: LemlistActivity[],
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const a of activities) {
    if (!ACTIVITY_SENT_TYPES.has(a.type)) continue;
    const existing = out[a.sequenceStep];
    if (!existing || a.createdAt < existing) {
      out[a.sequenceStep] = a.createdAt;
    }
  }
  return out;
}

/** Per-step engagement counters derived from lemlist activities. */
export interface StepEngagement {
  opens: number;
  clicks: number;
  replies: number;
}

const ACTIVITY_OPEN_TYPES = new Set(['emailsOpened']);
const ACTIVITY_CLICK_TYPES = new Set(['emailsClicked', 'emailClicked']);
const ACTIVITY_REPLY_TYPES = new Set(['emailsReplied', 'linkedinReplied']);

/**
 * Reduce activities into per-step engagement counts. Returns a map of
 * sequenceStep → { opens, clicks, replies }. Counts every individual
 * activity event (a single contact opening twice counts as 2 opens —
 * matches how lemlist itself reports it).
 */
export function reduceActivitiesToEngagement(
  activities: LemlistActivity[],
): Record<number, StepEngagement> {
  const out: Record<number, StepEngagement> = {};
  for (const a of activities) {
    if (!out[a.sequenceStep]) out[a.sequenceStep] = { opens: 0, clicks: 0, replies: 0 };
    const bucket = out[a.sequenceStep];
    if (ACTIVITY_OPEN_TYPES.has(a.type)) bucket.opens++;
    else if (ACTIVITY_CLICK_TYPES.has(a.type)) bucket.clicks++;
    else if (ACTIVITY_REPLY_TYPES.has(a.type)) bucket.replies++;
  }
  return out;
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
