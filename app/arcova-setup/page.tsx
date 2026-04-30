'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SetupShell from '@/components/SetupShell';
import SetupFlow from '@/components/SetupFlow';
import { useAuth } from '@/context/AuthContext';
import { useSetupState } from '@/lib/use-setup-state';

export default function ArcovaSetupPage() {
  const { user, loading } = useAuth();
  const { step1Complete, loading: setupLoading } = useSetupState();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!setupLoading && step1Complete) {
      router.replace('/dashboard');
    }
  }, [setupLoading, step1Complete, router]);

  if (loading || setupLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (step1Complete) {
    return null;
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
        <SetupFlow firstName={firstName || undefined} />
      </div>
    </SetupShell>
  );
}
