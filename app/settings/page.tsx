'use client';

import Link from 'next/link';
import Nango from '@nangohq/frontend';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, CheckCircle2, X } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import TeamSettings from '@/components/TeamSettings';
import MyDetails from '@/components/MyDetails';

interface LemlistStatus {
  connected: boolean;
  accountLabel: string | null;
  updatedAt: string | null;
}

interface HubSpotStatus {
  connected: boolean;
  hubDomain: string | null;
}

type ToneExample = { subject: string; body: string };

// Six example slots — one per step in the dispatched sequence (Day 1, 4, 8, 11, 14, 21).
const TONE_EXAMPLE_SLOTS = 6;
const EMPTY_EXAMPLE = (): ToneExample => ({ subject: '', body: '' });

export default function SettingsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [lemlistStatus, setLemlistStatus] = useState<LemlistStatus | null>(null);
  const [lemlistModalOpen, setLemlistModalOpen] = useState(false);
  const [lemlistKeyInput, setLemlistKeyInput] = useState('');
  const [lemlistSubmitting, setLemlistSubmitting] = useState(false);
  const [lemlistError, setLemlistError] = useState<string | null>(null);
  const [lemlistDisconnecting, setLemlistDisconnecting] = useState(false);

  // HubSpot connection state.
  const [hubspotStatus, setHubspotStatus] = useState<HubSpotStatus | null>(null);
  const [hubspotDisconnecting, setHubspotDisconnecting] = useState(false);

  // Call-to-action link.
  const [ctaUrl, setCtaUrl] = useState('');
  const [ctaModalOpen, setCtaModalOpen] = useState(false);
  const [ctaSaving, setCtaSaving] = useState(false);
  const [ctaUrlDraft, setCtaUrlDraft] = useState('');
  const ctaConfigured = ctaUrl.trim().length > 0;

  // Tone of voice — guidance + worked examples that shape generated outreach.
  const [toneGuidance, setToneGuidance] = useState('');
  const [toneExamples, setToneExamples] = useState<ToneExample[]>([]);
  const [toneModalOpen, setToneModalOpen] = useState(false);
  const [toneSaving, setToneSaving] = useState(false);
  // Draft state while the modal is open.
  const [toneGuidanceDraft, setToneGuidanceDraft] = useState('');
  const [toneExampleDrafts, setToneExampleDrafts] = useState<ToneExample[]>(
    Array(TONE_EXAMPLE_SLOTS).fill(null).map(EMPTY_EXAMPLE),
  );
  const toneConfigured = toneGuidance.trim().length > 0 || toneExamples.length > 0;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const refreshLemlistStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/lemlist/status');
      if (res.ok) setLemlistStatus(await res.json());
    } catch { /* best-effort */ }
  }, []);

  const refreshHubSpotStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hubspot/status');
      if (res.ok) setHubspotStatus(await res.json());
    } catch { /* best-effort */ }
  }, []);

  const refreshTone = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/tone');
      if (res.ok) {
        const data = (await res.json()) as {
          guidance?: string;
          examples?: ToneExample[];
          ctaUrl?: string;
        };
        setToneGuidance(data.guidance ?? '');
        setToneExamples(data.examples ?? []);
        setCtaUrl(data.ctaUrl ?? '');
      }
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    if (user) {
      void refreshLemlistStatus();
      void refreshHubSpotStatus();
      void refreshTone();
    }
  }, [user, refreshLemlistStatus, refreshHubSpotStatus, refreshTone]);

  const openToneModal = () => {
    setToneGuidanceDraft(toneGuidance);
    // Pad saved examples to slot count, filling gaps with empty objects.
    const padded: ToneExample[] = toneExamples.map((e) => ({ ...e }));
    while (padded.length < TONE_EXAMPLE_SLOTS) padded.push(EMPTY_EXAMPLE());
    setToneExampleDrafts(padded.slice(0, TONE_EXAMPLE_SLOTS));
    setToneModalOpen(true);
  };

  const handleToneSave = async () => {
    setToneSaving(true);
    try {
      const examples = toneExampleDrafts.filter((e) => e.body.trim().length > 0);
      const res = await fetch('/api/outreach/tone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guidance: toneGuidanceDraft.trim(), examples }),
      });
      if (res.ok) {
        setToneGuidance(toneGuidanceDraft.trim());
        setToneExamples(examples);
        setToneModalOpen(false);
      }
    } finally {
      setToneSaving(false);
    }
  };

  const openCtaModal = () => {
    setCtaUrlDraft(ctaUrl);
    setCtaModalOpen(true);
  };

  const handleCtaSave = async () => {
    setCtaSaving(true);
    try {
      const res = await fetch('/api/outreach/tone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctaUrl: ctaUrlDraft.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ctaUrl?: string };
        setCtaUrl(data.ctaUrl ?? ctaUrlDraft.trim());
        setCtaModalOpen(false);
      }
    } finally {
      setCtaSaving(false);
    }
  };

  const handleLemlistConnect = async () => {
    setLemlistError(null);
    setLemlistSubmitting(true);
    try {
      const res = await fetch('/api/outreach/lemlist/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: lemlistKeyInput.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      if (!res.ok) { setLemlistError(body.error ?? 'Failed to connect'); return; }
      setLemlistModalOpen(false);
      setLemlistKeyInput('');
      await refreshLemlistStatus();
    } finally {
      setLemlistSubmitting(false);
    }
  };

  const handleLemlistDisconnect = async () => {
    setLemlistDisconnecting(true);
    try {
      await fetch('/api/outreach/lemlist/disconnect', { method: 'DELETE' });
      await refreshLemlistStatus();
    } finally {
      setLemlistDisconnecting(false);
    }
  };

  const handleHubSpotConnect = async () => {
    try {
      // Get a short-lived session token from our backend (auth'd server-side).
      const sessionRes = await fetch('/api/nango/session', { method: 'POST' });
      if (!sessionRes.ok) return;
      const { sessionToken } = await sessionRes.json();
      if (!sessionToken) return;

      const nangoClient = new Nango();
      const connectUI = nangoClient.openConnectUI({
        onEvent: async (event) => {
          if (event.type === 'connect') {
            const { connectionId, providerConfigKey } = event.payload;
            await fetch('/api/nango/connection', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ integrationId: providerConfigKey, connectionId }),
            });
            await refreshHubSpotStatus();
          }
        },
      });
      connectUI.setSessionToken(sessionToken);
    } catch { /* user cancelled or error */ }
  };

  const handleHubSpotDisconnect = async () => {
    setHubspotDisconnecting(true);
    try {
      await fetch('/api/hubspot/disconnect', { method: 'DELETE' });
      await refreshHubSpotStatus();
    } finally {
      setHubspotDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold text-slate-950">Settings</h1>

          {/* ── Outreach connections ─────────────────────────────────────── */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Outreach connections</h2>
            <p className="mt-1 text-sm text-[#7d909a]">
              Connect the tools that run your sequences. You bring your own accounts; we never touch your LinkedIn login.
            </p>

            {/* lemlist */}
            <div className="mt-4 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[#0d3547]">lemlist</h3>
                    {lemlistStatus?.connected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10.5px] font-semibold text-emerald-600 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#7d909a]">
                    {lemlistStatus?.connected
                      ? lemlistStatus.accountLabel
                        ? `Connected as ${lemlistStatus.accountLabel}. Sequences dispatched from Arcova will land in this account.`
                        : 'Connected. Sequences dispatched from Arcova will land in this account.'
                      : 'Email + LinkedIn outreach in one tool. Arcova pushes generated sequences in.'}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  {lemlistStatus?.connected ? (
                    <button
                      type="button"
                      onClick={() => void handleLemlistDisconnect()}
                      disabled={lemlistDisconnecting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
                    >
                      {lemlistDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setLemlistError(null); setLemlistKeyInput(''); setLemlistModalOpen(true); }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]"
                    >
                      Connect lemlist
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* HubSpot */}
            <div className="mt-3 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[#0d3547]">HubSpot</h3>
                    {hubspotStatus?.connected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10.5px] font-semibold text-emerald-600 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#7d909a]">
                    {hubspotStatus?.connected
                      ? hubspotStatus.hubDomain
                        ? `Connected to ${hubspotStatus.hubDomain}. Deal and contact data syncs to Arcova.`
                        : 'Connected. Deal and contact data syncs to Arcova.'
                      : 'Connect your CRM so Arcova can read deals, contacts, and lifecycle stage.'}
                  </p>
                </div>
                <div className="shrink-0">
                  {hubspotStatus?.connected ? (
                    <button
                      type="button"
                      onClick={() => void handleHubSpotDisconnect()}
                      disabled={hubspotDisconnecting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
                    >
                      {hubspotDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleHubSpotConnect()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]"
                    >
                      Connect HubSpot
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ── Outreach voice ───────────────────────────────────────────── */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Outreach voice</h2>
            <p className="mt-1 text-sm text-[#7d909a]">
              Tell Arcova how your outreach should sound. Guidance and examples are woven into every generated hook and sequence.
            </p>

            {/* Tone of voice */}
            <div className="mt-4 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[#0d3547]">Tone of voice</h3>
                    {toneConfigured && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10.5px] font-semibold text-emerald-600 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Set
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#7d909a]">
                    {toneConfigured
                      ? toneGuidance.trim()
                        ? `"${toneGuidance.trim().slice(0, 120)}${toneGuidance.trim().length > 120 ? '…' : ''}"`
                        : `${toneExamples.length} example${toneExamples.length === 1 ? '' : 's'} saved.`
                      : 'Add guidance and examples to set your tone of voice for outreach.'}
                  </p>
                  {toneConfigured && toneExamples.length > 0 && (
                    <p className="mt-0.5 text-[12px] text-[#b6c2c8]">
                      {toneExamples.length} example{toneExamples.length === 1 ? '' : 's'} on file.
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={openToneModal}
                    className={toneConfigured
                      ? 'inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9]'
                      : 'inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]'}
                  >
                    {toneConfigured ? 'Edit voice' : 'Set up voice'}
                  </button>
                </div>
              </div>
            </div>

            {/* Call-to-action link */}
            <div className="mt-3 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[#0d3547]">Booking link</h3>
                    {ctaConfigured && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10.5px] font-semibold text-emerald-600 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Set
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#7d909a]">
                    {ctaConfigured
                      ? ctaUrl
                      : 'A booking link added to every generated outreach message, e.g. your Calendly.'}
                  </p>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={openCtaModal}
                    className={ctaConfigured
                      ? 'inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9]'
                      : 'inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]'}
                  >
                    {ctaConfigured ? 'Edit link' : 'Add link'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <MyDetails />

          <TeamSettings />

          {/* ── Other settings ────────────────────────────────────────────── */}
          <div className="mt-8 space-y-4">
            <Link
              href="/settings/archived"
              className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/70 px-5 py-4 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl transition hover:bg-white"
            >
              <div>
                <h2 className="text-base font-semibold text-[#0d3547]">Archived records</h2>
                <p className="mt-1 text-sm text-[#7d909a]">View archived account groups and restore them if needed.</p>
              </div>
              <ChevronRight className="h-5 w-5 text-[#b6c2c8]" />
            </Link>
          </div>

          <div className="mt-8">
            <button
              type="button"
              onClick={async () => { try { await logout(); router.push('/login'); } catch (e) { console.error('Logout failed:', e); } }}
              className="text-sm font-medium text-[#0d3547] underline-offset-4 hover:underline"
            >
              Log out
            </button>
          </div>
        </div>
      </main>

      {/* ── Connect lemlist modal ──────────────────────────────────────── */}
      {lemlistModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d3547]/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[#0d3547]">Connect lemlist</h3>
                <p className="mt-1 text-sm text-[#7d909a]">Paste your lemlist API key. We&apos;ll test it before saving.</p>
              </div>
              <button type="button" onClick={() => setLemlistModalOpen(false)} className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="mt-4 space-y-1.5 text-[12.5px] text-[#4a6470]">
              <li>1. In lemlist, go to <span className="font-medium">Settings → Integrations → API</span>.</li>
              <li>2. Generate a key (or copy the existing one).</li>
              <li>3. Paste it below.</li>
            </ol>
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">API key</label>
            <input type="password" value={lemlistKeyInput} onChange={(e) => setLemlistKeyInput(e.target.value)} placeholder="0b…" className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-sm text-[#0d3547] placeholder:text-[#b6c2c8] focus:border-arcova-teal focus:outline-none" />
            {lemlistError && <p className="mt-3 text-[12.5px] text-red-500">{lemlistError}</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setLemlistModalOpen(false)} disabled={lemlistSubmitting} className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60">Cancel</button>
              <button type="button" onClick={() => void handleLemlistConnect()} disabled={lemlistSubmitting || lemlistKeyInput.trim().length < 16} className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60">
                {lemlistSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {lemlistSubmitting ? 'Testing…' : 'Test & connect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Tone of voice modal ────────────────────────────────────────── */}
      {toneModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d3547]/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/80 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[#0d3547]">Tone of voice</h3>
                <p className="mt-1 text-sm text-[#7d909a]">
                  Guidance and examples shape every generated hook and sequence. Be specific — the more concrete, the better the match.
                </p>
              </div>
              <button type="button" onClick={() => setToneModalOpen(false)} className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Guidance</label>
            <textarea
              value={toneGuidanceDraft}
              onChange={(e) => setToneGuidanceDraft(e.target.value)}
              rows={5}
              placeholder="e.g. Warm but direct. Short sentences, no jargon. Lead with a concrete offer, never a feature list. Sign off with just my first name. Never use exclamation marks."
              className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] leading-relaxed placeholder:text-[#b6c2c8] focus:border-arcova-teal focus:outline-none"
            />

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
              Example messages <span className="normal-case font-normal text-[#b6c2c8]">(optional)</span>
            </label>
            <p className="mt-0.5 text-[12px] text-[#b6c2c8]">
              Paste a few messages you'd be happy to send. The model mirrors their phrasing and cadence — it won't reuse the content.
            </p>
            <div className="mt-3 space-y-3">
              {toneExampleDrafts.map((ex, i) => (
                <div key={i} className="rounded-lg border border-[rgba(13,53,71,0.12)] bg-[#f9fbfc] p-3 space-y-2">
                  <div>
                    <label className="block text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#b6c2c8] mb-1">
                      Subject <span className="normal-case font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={ex.subject}
                      onChange={(e) =>
                        setToneExampleDrafts((prev) =>
                          prev.map((v, j) => j === i ? { ...v, subject: e.target.value } : v)
                        )
                      }
                      placeholder="e.g. Quick question about your CMC scale-up"
                      className="w-full rounded-md border border-[rgba(13,53,71,0.15)] bg-white px-2.5 py-1.5 text-[12.5px] text-[#0d3547] placeholder:text-[#c8d2d7] focus:border-arcova-teal focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#b6c2c8] mb-1">Body</label>
                    <textarea
                      value={ex.body}
                      onChange={(e) =>
                        setToneExampleDrafts((prev) =>
                          prev.map((v, j) => j === i ? { ...v, body: e.target.value } : v)
                        )
                      }
                      rows={3}
                      placeholder={`Example ${i + 1} message body…`}
                      className="w-full rounded-md border border-[rgba(13,53,71,0.15)] bg-white px-2.5 py-1.5 text-[12.5px] text-[#0d3547] leading-relaxed placeholder:text-[#c8d2d7] focus:border-arcova-teal focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setToneModalOpen(false)} disabled={toneSaving} className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60">Cancel</button>
              <button type="button" onClick={() => void handleToneSave()} disabled={toneSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60">
                {toneSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                {toneSaving ? 'Saving…' : 'Save voice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Call-to-action link modal ──────────────────────────────────── */}
      {ctaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d3547]/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[#0d3547]">Booking link</h3>
                <p className="mt-1 text-sm text-[#7d909a]">
                  Added to every generated outreach message, on its own line before the sign-off.
                </p>
              </div>
              <button type="button" onClick={() => setCtaModalOpen(false)} className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Link</label>
            <input type="url" value={ctaUrlDraft} onChange={(e) => setCtaUrlDraft(e.target.value)} placeholder="calendly.com/yourname" className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] placeholder:text-[#b6c2c8] focus:border-arcova-teal focus:outline-none" />
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setCtaModalOpen(false)} disabled={ctaSaving} className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60">Cancel</button>
              <button type="button" onClick={() => void handleCtaSave()} disabled={ctaSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60">
                {ctaSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                {ctaSaving ? 'Saving…' : 'Save link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
