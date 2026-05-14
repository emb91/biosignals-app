'use client';

import { SignalsWorkspace } from '@/app/signals/SignalsWorkspace';

export default function ContactSignalsPage() {
  return (
    <SignalsWorkspace
      scope="contact"
      eyebrow="Contacts"
      title="Contact signals"
      showRunSignals
      emptyTitle="No contact signals yet"
      emptyDescription="Externally monitored people changes will appear here as Arcova detects promotions, role changes, company moves, and new hires."
    />
  );
}
