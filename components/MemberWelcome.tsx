'use client';

/**
 * Today → first-run arrival card for invited teammates. Members land on /today
 * with no onboarding of their own (the workspace is already set up), so this
 * gives them an orientation moment: whose workspace they joined, what's
 * already in place, and a sensible first step. Dismissible; never shown to the
 * owner, and stays dismissed per browser via localStorage.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Upload, Building2 } from 'lucide-react';

const DISMISS_KEY = 'arcova-member-welcome-dismissed';

export default function MemberWelcome() {
  const [info, setInfo] = useState<{ orgName: string | null; ownerEmail: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(DISMISS_KEY)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/org/members');
        if (!res.ok) return;
        const data = (await res.json()) as {
          role: string;
          orgName: string | null;
          members: Array<{ role: string; email: string | null }>;
        };
        if (cancelled || data.role === 'owner') return;
        const owner = data.members.find((m) => m.role === 'owner');
        setInfo({ orgName: data.orgName, ownerEmail: owner?.email ?? null });
        setDismissed(false);
      } catch {
        /* never block the page over a welcome card */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !info) return null;

  const workspace = info.orgName || 'your team';

  return (
    <div className="relative mb-6 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-[0_8px_24px_-12px_rgba(13,53,71,0.15)] backdrop-blur-xl">
      <button
        onClick={() => {
          window.localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm font-semibold text-slate-950">Welcome — you&rsquo;ve joined {workspace}</p>
      <p className="mt-1 max-w-2xl text-sm text-[#7d909a]">
        {info.ownerEmail ? `${info.ownerEmail} set this workspace up, so the` : 'The'} company profile
        and target market are already in place — you work from the same shared base as your team. A
        good first step: bring in your contacts, or look at the accounts the team is tracking.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/import"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0d3547] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0d3547]/90"
        >
          <Upload className="h-3.5 w-3.5" /> Import your contacts
        </Link>
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <Building2 className="h-3.5 w-3.5" /> See team accounts
        </Link>
      </div>
    </div>
  );
}
