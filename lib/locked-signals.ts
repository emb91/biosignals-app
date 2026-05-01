import { COMPANY_SIGNALS, CONTACT_SIGNALS } from '@/lib/signals/catalog';

export type LockedSignalCategory =
  | 'Funding & Financial'
  | 'Pipeline & Clinical'
  | 'Hiring & Team'
  | 'Corporate & Strategic'
  | 'Career & Role Changes'
  | 'Activity & Network';

export interface LockedSignal {
  id: string;
  name: string;
  category: LockedSignalCategory;
}

export type LockedSignalAudience = 'company' | 'persona';

const PERSONA_LOCKED_SIGNALS_POOL: LockedSignal[] = CONTACT_SIGNALS.map((signal) => ({
  id: signal.id,
  name: signal.displayName,
  category: signal.category,
}));

const COMPANY_LOCKED_SIGNALS_POOL: LockedSignal[] = COMPANY_SIGNALS.map((signal) => ({
  id: signal.id,
  name: signal.displayName,
  category: signal.category,
}));

export function getRandomLockedSignals(count?: number, audience: LockedSignalAudience = 'persona'): LockedSignal[] {
  const sourcePool = audience === 'company' ? COMPANY_LOCKED_SIGNALS_POOL : PERSONA_LOCKED_SIGNALS_POOL;
  const pool = [...sourcePool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if (typeof count === 'number') {
    return pool.slice(0, Math.max(0, count));
  }
  return pool;
}
