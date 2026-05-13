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

  const firstName = (() => {
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const fullName = String(meta?.full_name || meta?.name || '').trim();
    if (fullName) return fullName.split(' ')[0];
    const emailPrefix = (user.email || '').split('@')[0];
    return emailPrefix ? emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1) : '';
  })();

  return (
    <div className="relative flex h-screen bg-transparent">
      {/* Stack above SetupFlow's fixed AppAmbientBackground (z-0), same pattern as SetupShell */}
      <div className="relative z-20 h-full shrink-0">
        <AppSidebar />
      </div>
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          <button
            type="button"
            onClick={() => guardedNavigate('/icps')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-arcova-navy/10 bg-white/65 px-3 py-1.5 text-[12px] font-medium text-arcova-navy/65 backdrop-blur transition-all hover:-translate-x-0.5 hover:bg-white hover:text-arcova-navy"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
        </div>
        <SetupFlow
          firstName={firstName || undefined}
          email={user.email || undefined}
          emailDomain={user.email?.split('@')[1] || undefined}
          entryPoint="target-company"
          onCompletePath="/icps"
        />
      </div>
    </div>
  );
}
