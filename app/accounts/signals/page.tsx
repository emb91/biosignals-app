'use client';

import { SignalsWorkspace } from '@/app/signals/SignalsWorkspace';

export default function AccountSignalsPage() {
  return (
    <SignalsWorkspace
      scope="company"
      eyebrow="Accounts"
      title="Account signals"
      showRunSignals={false}
      emptyTitle="No account signals yet"
      emptyDescription="Account-level external readiness signals will appear here as Arcova detects meaningful company change."
    />
  );
}
