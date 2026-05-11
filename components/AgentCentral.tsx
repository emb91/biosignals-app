'use client';

/**
 * AgentCentral
 * ─────────────────────────────────────────────────────────────────────────────
 * Full-page / full-width agent panel in the "briefing chat" visual style —
 * white surface, large type, avatar avatar alongside bubbles.
 *
 * Use this on pages where the agent IS the primary UI rather than a side rail:
 *   • /data        (sourcing jobs + queue)
 *   • /my-company  (setup / company profile)
 *
 * The briefing page (/briefing or /today) uses AgentPanel directly with
 * `embedInBriefingBento` — that flow is intentionally kept separate.
 *
 * Props mirror AgentPanel (same underlying component) minus any side-rail
 * geometry concerns. Caller can still pass `page`, `pageContext`,
 * `pendingMessage`, `onJobStarted`, `headerSubtitle`, etc.
 */

import { AgentPanel, type AgentPanelProps } from '@/components/AgentPanel';

type AgentCentralProps = Omit<AgentPanelProps, 'variant' | 'wide' | 'surfaceClassName'>;

export function AgentCentral(props: AgentCentralProps) {
  return (
    <AgentPanel
      {...props}
      variant="central"
      wide
    />
  );
}
