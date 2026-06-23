'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AppSidebar from '@/components/AppSidebar';
import UsageSettings from '@/components/UsageSettings';

export default function UsagePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, router, user]);

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
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link href="/settings" className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#7d909a] hover:text-[#0d3547]">
                <ArrowLeft className="h-3.5 w-3.5" />
                Settings
              </Link>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950">Usage</h1>
            </div>
            <Link
              href="/settings/billing"
              className="inline-flex items-center gap-2 rounded-xl bg-white/80 px-3.5 py-2 text-sm font-semibold text-[#0d3547] shadow-[0_8px_24px_-14px_rgba(13,53,71,0.35)] ring-1 ring-[rgba(13,53,71,0.08)] transition hover:bg-white"
            >
              Upgrade for more usage
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>

          <UsageSettings className="mt-0" showHeading={false} />
        </div>
      </main>
    </div>
  );
}
