'use client';

import Link from 'next/link';
import Nango from '@nangohq/frontend';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Loader2, CheckCircle2, X } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';

interface LemlistStatus {
  connected: boolean;
  accountLabel: string | null;
  updatedAt: string | null;
}

interface HubSpotStatus {
  connected: boolean;
  hubDomain: string | null;
}

export default function SettingsPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const [lemlistStatus, setLemlistStatus] = useState<LemlistStatus | null>(null);
  const [lemlistModalOpen, setLemlistModalOpen] = useState(false);
  const [lemlistKeyInput, setLemlistKeyInput] = useState('');
  const [lemlistSubmitting, setLemlistSubmitting] = useState(false);
  const [lemlistError, setLemlistError] = useState<string | null>(null);
  const [lemlistDisconnecting, setLemlistDisconnecting] = useState(false);

  // HubSpot connection state (mirrors the flow on /import — Nango Connect UI).
  const [hubspotStatus, setHubspotStatus] = useState<HubSpotStatus | null>(null);
  const [hubspotDisconnecting, setHubspotDisconnecting] = useState(false);
  // Arcova template provisioning state.
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Call-to-action link — an opt-in per-message insert in the /outreach editor.
  const [ctaUrl, setCtaUrl] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaModalOpen, setCtaModalOpen] = useState(false);
  const [ctaSaving, setCtaSaving] = useState(false);
  const [ctaUrlDraft, setCtaUrlDraft] = useState('');
  const [ctaLabelDraft, setCtaLabelDraft] = useState('');
  const ctaConfigured = ctaUrl.trim().length > 0;

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

  const refreshLemlistStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/lemlist/status');
      if (res.ok) setLemlistStatus(await res.json());
    } catch {
      // best-effort
    }
  }, []);

  const refreshHubSpotStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hubspot/status');
      if (res.ok) setHubspotStatus(await res.json());
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    if (user) {
      void refreshLemlistStatus();
      void refreshHubSpotStatus();
    }
  }, [user, refreshLemlistStatus, refreshHubSpotStatus]);

  const handleConnectHubSpot = async () => {
    if (!user) return;
    const sessionRes = await fetch('/api/nango/session', { method: 'POST' });
    if (!sessionRes.ok) return;
    const { sessionToken } = await sessionRes.json();
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
          void refreshHubSpotStatus();
        }
      },
    });
    connectUI.setSessionToken(sessionToken);
  };

  const handleDisconnectHubSpot = async () => {
    setHubspotDisconnecting(true);
    try {
      await fetch('/api/hubspot/disconnect', { method: 'DELETE' });
      await refreshHubSpotStatus();
    } finally {
      setHubspotDisconnecting(false);
    }
  };

  // CTA link state is persisted on /api/outreach/tone (legacy endpoint name —
  // tone fields are ignored in the response now that the Outreach voice
  // surface is gone).
  const refreshCta = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/tone');
      if (res.ok) {
        const data = (await res.json()) as { ctaUrl?: string; ctaLabel?: string };
        setCtaUrl(data.ctaUrl ?? '');
        setCtaLabel(data.ctaLabel ?? '');
      }
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    if (user) void refreshCta();
  }, [user, refreshCta]);

  const openCtaModal = () => {
    setCtaUrlDraft(ctaUrl);
    setCtaLabelDraft(ctaLabel);
    setCtaModalOpen(true);
  };

  const handleCtaSave = async () => {
    setCtaSaving(true);
    try {
      const res = await fetch('/api/outreach/tone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctaUrl: ctaUrlDraft.trim(), ctaLabel: ctaLabelDraft.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ctaUrl?: string; ctaLabel?: string };
        // Use the server-normalised values (it prepends https:// etc.).
        setCtaUrl(data.ctaUrl ?? ctaUrlDraft.trim());
        setCtaLabel(data.ctaLabel ?? ctaLabelDraft.trim());
        setCtaModalOpen(false);
      }
    } finally {
      setCtaSaving(false);
    }
  };

  const handleEnsureTemplate = async () => {
    setProvisioning(true);
    setProvisionResult(null);
    try {
      const res = await fetch('/api/outreach/lemlist/ensure-template', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        campaignId?: string;
        created?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.campaignId) {
        setProvisionResult({
          ok: false,
          message: body.error ?? body.detail ?? 'Could not set up the Arcova template.',
        });
        return;
      }
      setProvisionResult({
        ok: true,
        message: body.created
          ? 'Arcova Multichannel template created in lemlist (with Mon–Fri 09:00–17:00 schedule). You\'re ready to dispatch.'
          : 'Arcova Multichannel template already exists in lemlist. You\'re ready to dispatch.',
      });
    } finally {
      setProvisioning(false);
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
      if (!res.ok) {
        setLemlistError(body.error ?? 'Failed to connect');
        return;
      }
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
          <p className="mt-2 text-sm text-slate-500">Workspace controls and low-frequency recovery tools.</p>

          {/* ── Connections ─────────────────────────────────────────────── */}
          <section className="mt-8 space-y-4">
            {/* HubSpot — sits above lemlist because the CRM is the primary
                source of truth; outreach plugs into it. */}
            <div className="rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
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
                        ? `Connected to ${hubspotStatus.hubDomain}. Contacts and deals stay in sync; outreach status mirrors to HubSpot.`
                        : 'Connected. Contacts and deals stay in sync; outreach status mirrors to HubSpot.'
                      : 'Pull contacts in, push enriched data + outreach status back. We use HubSpot OAuth via Nango — your credentials never touch our servers.'}
                  </p>
                </div>
                <div className="shrink-0">
                  {hubspotStatus?.connected ? (
                    <button
                      type="button"
                      onClick={() => void handleDisconnectHubSpot()}
                      disabled={hubspotDisconnecting}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
                    >
                      {hubspotDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleConnectHubSpot()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]"
                    >
                      Connect HubSpot
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* lemlist */}
            <div className="rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
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
                      : 'Email + LinkedIn outreach in one tool. Your customers (or you) bring a lemlist account; Arcova pushes generated sequences in.'}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  {lemlistStatus?.connected ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleEnsureTemplate()}
                        disabled={provisioning}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-teal/40 bg-arcova-teal/5 px-3 py-1.5 text-[12.5px] font-semibold text-arcova-teal hover:bg-arcova-teal/10 disabled:opacity-60"
                      >
                        {provisioning ? 'Setting up…' : 'Set up Arcova template'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLemlistDisconnect()}
                        disabled={lemlistDisconnecting}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
                      >
                        {lemlistDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setLemlistError(null);
                        setLemlistKeyInput('');
                        setLemlistModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]"
                    >
                      Connect lemlist
                    </button>
                  )}
                </div>
              </div>

              {provisionResult && (
                <p
                  className={`mt-3 text-[12px] leading-snug ${
                    provisionResult.ok ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {provisionResult.message}
                </p>
              )}
            </div>
          </section>

          {/* ── Call-to-action link ──────────────────────────────────────── */}
          <section className="mt-8">
            <div className="rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-[#0d3547]">Call-to-action link</h3>
                    {ctaConfigured && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-px text-[10.5px] font-semibold text-emerald-600 border border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" /> Set
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[#7d909a]">
                    {ctaConfigured
                      ? `${ctaLabel ? `${ctaLabel} ` : ''}${ctaUrl}`
                      : 'Add a booking or personal link (Calendly, your site, etc.). Once set, you can drop it into any message from the /outreach editor.'}
                  </p>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={openCtaModal}
                    className={
                      ctaConfigured
                        ? 'inline-flex items-center gap-1.5 rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9]'
                        : 'inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547]'
                    }
                  >
                    {ctaConfigured ? 'Edit link' : 'Add link'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Existing settings ─────────────────────────────────────────── */}
          <div className="mt-8 space-y-4">
            <Link
              href="/settings/archived"
              className="flex items-center justify-between rounded-2xl border border-white/80 bg-white/70 px-5 py-4 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl transition hover:bg-white"
            >
              <div>
                <h2 className="text-base font-semibold text-[#0d3547]">Archived records</h2>
                <p className="mt-1 text-sm text-[#7d909a]">
                  View archived account groups and restore them if needed.
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-[#b6c2c8]" />
            </Link>
          </div>

          <div className="mt-8">
            <button
              type="button"
              onClick={async () => {
                try {
                  await logout();
                  router.push('/login');
                } catch (e) {
                  console.error('Logout failed:', e);
                }
              }}
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
                <p className="mt-1 text-sm text-[#7d909a]">
                  Paste your lemlist API key. We&apos;ll test it against your account before saving.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLemlistModalOpen(false)}
                className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="mt-4 space-y-1.5 text-[12.5px] text-[#4a6470]">
              <li>1. In lemlist, go to <span className="font-medium">Settings → Integrations → API</span>.</li>
              <li>2. Generate a key (or copy the existing one).</li>
              <li>3. Paste it below.</li>
            </ol>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
              API key
            </label>
            <input
              type="password"
              value={lemlistKeyInput}
              onChange={(e) => setLemlistKeyInput(e.target.value)}
              placeholder="0b…"
              className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-sm text-[#0d3547] placeholder:text-[#b6c2c8] focus:border-arcova-teal focus:outline-none"
            />

            {lemlistError && (
              <p className="mt-3 text-[12.5px] text-red-500">{lemlistError}</p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setLemlistModalOpen(false)}
                disabled={lemlistSubmitting}
                className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleLemlistConnect()}
                disabled={lemlistSubmitting || lemlistKeyInput.trim().length < 16}
                className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60"
              >
                {lemlistSubmitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {lemlistSubmitting ? 'Testing…' : 'Test & connect'}
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
                <h3 className="text-lg font-semibold text-[#0d3547]">Call-to-action link</h3>
                <p className="mt-1 text-sm text-[#7d909a]">
                  A link you can drop into any outreach message. The phrase + link appear together,
                  e.g. <span className="font-medium text-[#4a6470]">Book a call with me: calendly.com/you</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCtaModalOpen(false)}
                className="rounded-md p-1 text-[#b6c2c8] hover:bg-[#f4f7f9] hover:text-[#4a6470]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
              Lead-in phrase
            </label>
            <input
              type="text"
              value={ctaLabelDraft}
              onChange={(e) => setCtaLabelDraft(e.target.value)}
              placeholder="Book a call with me"
              className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] placeholder:text-[#b6c2c8] focus:border-arcova-teal focus:outline-none"
            />

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7d909a]">
              Link
            </label>
            <input
              type="text"
              value={ctaUrlDraft}
              onChange={(e) => setCtaUrlDraft(e.target.value)}
              placeholder="calendly.com/you  ·  yoursite.com  ·  linkedin.com/in/you"
              className="mt-1 w-full rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-2 text-[13px] text-[#0d3547] placeholder:text-[#b6c2c8] focus:border-arcova-teal focus:outline-none"
            />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCtaModalOpen(false)}
                disabled={ctaSaving}
                className="rounded-lg border border-[rgba(13,53,71,0.15)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#4a6470] hover:bg-[#f4f7f9] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCtaSave()}
                disabled={ctaSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-navy px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0d3547] disabled:opacity-60"
              >
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
