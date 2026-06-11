'use client';

/**
 * /my-profile — "About you · My profile". The user's own profile, styled like My Company
 * but about the person. Pre-filled from enrichment (we already have email + first name
 * from the org invite); the user edits their own details here, and those edits are the
 * source of truth. Backed by /api/me/profile (user_profiles + canonical people row).
 */
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Loader2, Sparkles, Check, Pencil, X, Save } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import { PageHeader } from '@/components/PageHeader';

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
  enrichmentAttempted: boolean;
};

export default function MyProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [fullName, setFullName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRanRef = useRef(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const hydrate = useCallback((p: Profile) => {
    setProfile(p);
    setFullName(p.full_name ?? '');
    setRoleTitle(p.role_title ?? '');
    setLinkedinUrl(p.linkedin_url ?? '');
  }, []);

  const refresh = useCallback(async (): Promise<Profile | null> => {
    try {
      const res = await fetch('/api/me/profile');
      if (res.ok) {
        const p = (await res.json()) as Profile;
        hydrate(p);
        return p;
      }
    } catch {
      /* best-effort */
    } finally {
      setLoadingData(false);
    }
    return null;
  }, [hydrate]);

  const enrich = useCallback(async (force = false) => {
    setEnriching(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/profile/enrich${force ? '?force=1' : ''}`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'We couldn’t find your details automatically.');
        return;
      }
      await refresh();
    } catch {
      setError('We couldn’t find your details automatically.');
    } finally {
      setEnriching(false);
    }
  }, [refresh]);

  // First visit: automatically find and fill the user's details from their email +
  // company (same as how imported contacts are resolved). Runs once.
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const p = await refresh();
      if (p && !p.enrichmentAttempted && !autoRanRef.current) {
        autoRanRef.current = true;
        void enrich();
      }
    })();
  }, [user, refresh, enrich]);

  const save = async () => {
    setSaving(true);
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
      setEditMode(false);
      await refresh();
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }
  if (!user) return null;

  const enriched = profile?.enriched;

  return (
    <div className="flex h-screen min-h-0 bg-transparent font-jakarta">
      <AppSidebar />
      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <div className="mx-auto max-w-[1180px]">
          <PageHeader
            eyebrow="About you · My profile"
            title="Your profile"
            subtitle="Your name, role and LinkedIn."
            action={
              !editMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => enrich(true)}
                    disabled={enriching}
                    title="Refresh your details from LinkedIn"
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-teal/25 bg-arcova-teal/10 px-3.5 py-2 text-[12.5px] font-medium text-[#00707b] transition-all hover:-translate-y-px hover:bg-arcova-teal/16 disabled:opacity-50"
                  >
                    {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {enriching ? 'Updating…' : 'Update from LinkedIn'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMode(true)}
                    className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-navy/10 bg-white/70 px-3.5 py-2 text-[12.5px] font-medium text-arcova-navy backdrop-blur transition-all hover:-translate-y-px hover:bg-white"
                  >
                    <Pencil className="h-3.5 w-3.5 opacity-70" /> Edit
                  </button>
                </div>
              ) : undefined
            }
          />

          <article className="mt-6 rounded-2xl border border-white/80 bg-white/70 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
            <div className="flex items-start gap-5 p-6">
              {enriched?.photoUrl ? (
                <Image src={enriched.photoUrl} alt="" width={72} height={72} className="h-18 w-18 shrink-0 rounded-full object-cover" unoptimized />
              ) : (
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl font-semibold text-slate-400">
                  {(fullName || profile?.email || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {enriching && !enriched && !fullName ? (
                  <p className="flex items-center gap-2 text-sm text-arcova-navy/60">
                    <Loader2 className="h-4 w-4 animate-spin" /> Setting up your profile…
                  </p>
                ) : (
                  <h2 className="text-lg font-semibold text-arcova-navy">{fullName || '—'}</h2>
                )}
                {roleTitle && <p className="text-sm text-arcova-navy/70">{roleTitle}</p>}
                {enriched?.headline && <p className="mt-1 text-sm text-arcova-navy/55">{enriched.headline}</p>}
                {(enriched?.companyName || enriched?.location) && (
                  <p className="mt-1 text-xs text-arcova-navy/45">
                    {[enriched?.companyName, enriched?.location].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="mt-2 text-xs text-arcova-navy/45">{profile?.email}</p>
              </div>
            </div>

            {editMode && (
              <div className="border-t border-arcova-navy/[0.06] p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-arcova-navy/60">Full name</span>
                    <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-arcova-navy/60">Role / title</span>
                    <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="e.g. VP Sales" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal" />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium text-arcova-navy/60">LinkedIn URL</span>
                    <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal" />
                  </label>
                </div>
                {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-[10px] bg-arcova-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                  </button>
                  <button type="button" onClick={() => { setEditMode(false); if (profile) hydrate(profile); }} className="inline-flex items-center gap-1.5 rounded-[10px] border border-arcova-navy/10 bg-white/70 px-4 py-2 text-sm font-medium text-arcova-navy">
                    <X className="h-4 w-4" /> Cancel
                  </button>
                </div>
              </div>
            )}

            {!editMode && (
              <div className="flex items-center justify-between border-t border-arcova-navy/[0.06] px-6 py-3 text-xs text-arcova-navy/45">
                <span>
                  {profile?.linkedin_url
                    ? profile.linkedin_url
                    : enriching
                      ? 'Looking you up…'
                      : "We couldn't find you automatically — add your LinkedIn above to fill in your details."}
                </span>
                {profile?.enrichedAt && <span>Updated {new Date(profile.enrichedAt).toLocaleDateString('en-GB')}</span>}
              </div>
            )}
          </article>
          {error && !editMode && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        </div>
      </main>
    </div>
  );
}
