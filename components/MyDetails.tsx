'use client';

/**
 * Settings → My details. The logged-in user's own profile: name, role, LinkedIn, plus
 * any enriched identity (headline, photo, location, current company) pulled from a
 * canonical `people` row. Edits are the source of truth (PUT /api/me/profile).
 *
 * "Find my profile" runs a controlled enrichment (LinkedIn resolve + profile scrape) —
 * button-triggered, never automatic, since it spends Apify/LLM credits.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Check } from 'lucide-react';
import Image from 'next/image';

type Enriched = {
  headline: string | null;
  photoUrl: string | null;
  location: string | null;
  companyName: string | null;
  jobTitle: string | null;
};

type Profile = {
  email: string | null;
  full_name: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  enriched: Enriched | null;
  enrichedAt: string | null;
};

export default function MyDetails() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback((p: Profile) => {
    setProfile(p);
    setFullName(p.full_name ?? '');
    setRoleTitle(p.role_title ?? '');
    setLinkedinUrl(p.linkedin_url ?? '');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/me/profile');
      if (res.ok) hydrate(await res.json());
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName, role_title: roleTitle, linkedin_url: linkedinUrl }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not save.');
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      void refresh();
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const enrich = async () => {
    setEnriching(true);
    setError(null);
    try {
      const res = await fetch('/api/me/profile/enrich', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Could not find your profile.');
        return;
      }
      await refresh();
    } catch {
      setError('Enrichment failed.');
    } finally {
      setEnriching(false);
    }
  };

  const enriched = profile?.enriched;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">My details</h2>
      <p className="mt-1 text-sm text-slate-500">
        Used to personalise your outreach. Your edits are the source of truth.
      </p>

      <div className="mt-4 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-start gap-4">
              {enriched?.photoUrl ? (
                <Image
                  src={enriched.photoUrl}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-400">
                  {(fullName || profile?.email || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{profile?.email ?? '—'}</p>
                {enriched?.headline && <p className="mt-0.5 text-xs text-slate-500">{enriched.headline}</p>}
                {(enriched?.companyName || enriched?.location) && (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {[enriched?.jobTitle, enriched?.companyName, enriched?.location].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Full name</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Role / title</span>
                <input
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. VP Sales"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-500">LinkedIn URL</span>
                <input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/in/…"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal"
                />
              </label>
            </div>

            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
                {saved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                onClick={enrich}
                disabled={enriching}
                title="Resolve your LinkedIn and pull your profile (uses credits)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-arcova-navy/12 bg-white/70 px-4 py-2 text-sm font-medium text-arcova-navy disabled:opacity-50"
              >
                {enriching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {enriching ? 'Finding…' : 'Find my profile'}
              </button>
              {profile?.enrichedAt && (
                <span className="text-xs text-slate-400">Enriched {new Date(profile.enrichedAt).toLocaleDateString('en-GB')}</span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
