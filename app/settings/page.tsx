'use client';

import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';

export default function SettingsPage() {
  const { user, loading, logout } = useAuth();
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
          <h1 className="text-2xl font-semibold text-slate-950">Settings</h1>
          <p className="mt-2 text-sm text-slate-500">Workspace controls and low-frequency recovery tools.</p>

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
    </div>
  );
}
