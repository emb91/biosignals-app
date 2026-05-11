'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SetupShell from '@/components/SetupShell';
import SetupFlow from '@/components/SetupFlow';
import { useAuth } from '@/context/AuthContext';
import { useSetupState, getNextSetupPath } from '@/lib/use-setup-state';

export default function ArcovaSetupPage() {
  const { user, loading } = useAuth();
  const {
    step1Complete,
    step2Complete,
    step3Complete,
    setupComplete,
    loading: setupLoading,
  } = useSetupState();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  /** After refresh (or when company row already exists), continue the funnel instead of skipping to import. */
  useEffect(() => {
    if (setupLoading || !step1Complete) return;
    const next = getNextSetupPath({ step1Complete, step2Complete, step3Complete, setupComplete });
    if (next !== '/arcova-setup') {
      router.replace(next);
    }
  }, [setupLoading, step1Complete, step2Complete, step3Complete, setupComplete, router]);

  if (loading || setupLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (step1Complete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  const firstName = (() => {
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const fullName = String(meta?.full_name || meta?.name || '').trim();
    if (fullName) return fullName.split(' ')[0];
    const emailPrefix = (user.email || '').split('@')[0];
    return emailPrefix ? emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1) : '';
  })();

  return (
    <SetupShell
      inSetup={true}
      step={1}
      setupUserGreeting={firstName || undefined}
      hideSetupProgress={true}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <SetupFlow
          firstName={firstName || undefined}
          email={user.email || undefined}
          emailDomain={user.email?.split('@')[1] || undefined}
        />
      </div>
    </SetupShell>
  );
}
