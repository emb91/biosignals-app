'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import SetupFlow from '@/components/SetupFlow';
import { useEnrichmentGuard } from '@/context/EnrichmentGuardContext';

export default function ICPNewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { guardedNavigate } = useEnrichmentGuard();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="relative flex h-screen bg-slate-950">
      {/* Stack above SetupFlow's fixed AppAmbientBackground (z-0), same pattern as SetupShell */}
      <div className="relative z-20 h-full shrink-0">
        <AppSidebar />
      </div>
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-white/10 px-6 py-3">
          <button
            type="button"
            onClick={() => guardedNavigate('/company-criteria')}
            className="inline-flex items-center gap-1.5 text-sm text-white transition-colors hover:text-white/70"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        </div>
        <SetupFlow
          entryPoint="target-company"
          onCompletePath="/company-criteria"
        />
      </div>
    </div>
  );
}
