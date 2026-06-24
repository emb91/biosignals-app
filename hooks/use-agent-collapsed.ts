'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks whether the side-rail agent is collapsed (the compact floating bar).
 * `AgentPanel` owns the collapse state and broadcasts it by toggling the
 * `arcova-agent-collapsed` class on <body> and firing the window event below.
 *
 * Pages use this so their tables can claim the freed ~360px and show more
 * columns while the agent is collapsed.
 */
export const AGENT_COLLAPSED_EVENT = 'arcova-agent-collapsed-change';

function readBodyState(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('arcova-agent-collapsed');
}

export function useAgentCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState<boolean>(readBodyState);

  useEffect(() => {
    const update = () => setCollapsed(readBodyState());
    update();
    window.addEventListener(AGENT_COLLAPSED_EVENT, update);
    return () => window.removeEventListener(AGENT_COLLAPSED_EVENT, update);
  }, []);

  return collapsed;
}
