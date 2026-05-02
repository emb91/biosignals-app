'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppSidebar from '@/components/AppSidebar';
import { Building2 } from 'lucide-react';

export default function AccountsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 to-arcova-darkblue">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen bg-gradient-to-b from-slate-950 to-arcova-darkblue">
      <AppSidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-8 lg:px-10">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">Accounts</h1>
              <p className="mt-1 text-sm text-white/40">
                Your best-fit companies — whether or not you have contacts there yet.
              </p>
            </div>

            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center mb-4">
                <Building2 className="w-8 h-8 text-white/30" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Coming soon</h3>
              <p className="text-white/40 text-sm max-w-sm">
                Accounts will show your top ICP-matched companies ranked by fit, with contact coverage gaps highlighted — so you know exactly where to prospect next.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
