'use client';

import { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import SetupShell from '@/components/SetupShell';
import SetupFlow from '@/components/SetupFlow';
import { useAuth } from '@/context/AuthContext';
import { useSetupState, getNextSetupPath } from '@/lib/use-setup-state';
import { ROUTES } from '@/lib/routes';
export default function ArcovaSetupPage() {
  const { user, loading } = useAuth();
  const {
    step1Complete,
    step2Complete,
    loading: setupLoading,
  } = useSetupState();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [loading, user, router]);

  /** Company or ICP still missing: stay on this page (SetupFlow). Otherwise send them to Today (already fully onboarded). */
  useEffect(() => {
    if (setupLoading) return;
    const next = getNextSetupPath({ step1Complete, step2Complete });
    if (next !== ROUTES.setup.arcova) {
      router.replace(next);
    }
  }, [setupLoading, step1Complete, step2Complete, router]);

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

  const needsArcovaSetupFlow = !step1Complete || !step2Complete;
  if (!needsArcovaSetupFlow) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-arcova-teal" />
      </div>
    );
  }

  // Only a real, user-provided name counts here. We deliberately do NOT fall back
  // to the email prefix: when no name is set, the onboarding agent opens by asking
  // what to call you and persists it via capture_name. Seeding an email-prefix
  // "name" would make the agent think it already knows you and skip that step.
  const firstName = (() => {
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const fullName = String(meta?.full_name || meta?.name || '').trim();
    return fullName ? fullName.split(' ')[0] : '';
  })();

  return (
    <SetupShell
      inSetup={true}
      step={1}
      setupUserGreeting={firstName || undefined}
      hideSetupProgress={true}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="h-12 w-12 animate-spin rounded-full border-2 border-arcova-teal border-t-transparent" />
            </div>
          }
        >
          <SetupFlow
            firstName={firstName || undefined}
            email={user.email || undefined}
            emailDomain={user.email?.split('@')[1] || undefined}
          />
        </Suspense>
      </div>
    </SetupShell>
  );
}
