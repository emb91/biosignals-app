import type { SupabaseClient } from '@supabase/supabase-js';
import { assignSignalWeights } from '@/lib/signal-weights';
import { normalizePlatformTaxonomyFields } from '@/lib/platform-category';

type DatabaseClient = SupabaseClient<any, 'public', any>;

type SignalSelectionRow = {
  signal_id: string;
  rank: number;
  weight: number;
};

type EntityWithId = {
  id: string;
  signals?: unknown;
};

function parseLegacySignalIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== 'string') {
      if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
        return [item.id];
      }
      return [];
    }

    const trimmed = item.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
        return [parsed.id];
      }
    } catch {
      // Stored as a raw string signal id.
    }

    return [trimmed];
  });
}

function normalizeSignalIds(signalIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const signalId of signalIds) {
    if (typeof signalId !== 'string') continue;
    const trimmed = signalId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

/** PostgREST: table not exposed or not in schema cache (migration not applied yet). */
function isMissingPersonaSignalSelectionsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error?.code) return false;
  if (error.code !== 'PGRST205') return false;
  const msg = error.message ?? '';
  return msg.includes('persona_signal_selections');
}

function buildSelectionRows(
  signalIds: string[],
  owner: { user_id: string; key: 'icp_id' | 'persona_id'; id: string }
): Array<{ user_id: string; signal_id: string; rank: number; weight: number } & Record<'icp_id' | 'persona_id', string>> {
  const weightedSignals = assignSignalWeights(normalizeSignalIds(signalIds));
  return weightedSignals.map((signal, index) => ({
    user_id: owner.user_id,
    [owner.key]: owner.id,
    signal_id: signal.id,
    rank: index + 1,
    weight: signal.weight,
  })) as Array<{ user_id: string; signal_id: string; rank: number; weight: number } & Record<'icp_id' | 'persona_id', string>>;
}

export async function replaceIcpSignalSelections(
  supabase: DatabaseClient,
  userId: string,
  icpId: string,
  signalIds: string[]
) {
  const { error: deleteError } = await supabase
    .from('icp_signal_selections')
    .delete()
    .eq('user_id', userId)
    .eq('icp_id', icpId);

  if (deleteError) throw deleteError;

  const rows = buildSelectionRows(signalIds, { user_id: userId, key: 'icp_id', id: icpId });
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from('icp_signal_selections')
    .insert(rows)
    .select('signal_id, rank, weight')
    .order('rank', { ascending: true });

  if (error) throw error;
  return (data || []) as SignalSelectionRow[];
}


export async function loadIcpSignalSelections(
  supabase: DatabaseClient,
  userId: string,
  icpIds: string[]
) {
  if (icpIds.length === 0) return new Map<string, string[]>();

  const { data, error } = await supabase
    .from('icp_signal_selections')
    .select('icp_id, signal_id, rank')
    .eq('user_id', userId)
    .in('icp_id', icpIds)
    .order('rank', { ascending: true });

  if (error) throw error;

  const selections = new Map<string, string[]>();
  for (const row of (data || []) as Array<{ icp_id: string; signal_id: string }>) {
    const current = selections.get(row.icp_id) || [];
    current.push(row.signal_id);
    selections.set(row.icp_id, current);
  }

  return selections;
}

export async function replacePersonaSignalSelections(
  supabase: DatabaseClient,
  userId: string,
  personaId: string,
  signalIds: string[]
) {
  const { error: deleteError } = await supabase
    .from('persona_signal_selections')
    .delete()
    .eq('user_id', userId)
    .eq('persona_id', personaId);

  if (deleteError && isMissingPersonaSignalSelectionsTable(deleteError)) {
    return [];
  }
  if (deleteError) throw deleteError;

  const rows = buildSelectionRows(signalIds, { user_id: userId, key: 'persona_id', id: personaId });
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from('persona_signal_selections')
    .insert(rows)
    .select('signal_id, rank, weight')
    .order('rank', { ascending: true });

  if (error && isMissingPersonaSignalSelectionsTable(error)) {
    return [];
  }
  if (error) throw error;
  return (data || []) as SignalSelectionRow[];
}

export async function loadPersonaSignalSelections(
  supabase: DatabaseClient,
  userId: string,
  personaIds: string[]
) {
  if (personaIds.length === 0) return new Map<string, string[]>();

  const { data, error } = await supabase
    .from('persona_signal_selections')
    .select('persona_id, signal_id, rank')
    .eq('user_id', userId)
    .in('persona_id', personaIds)
    .order('rank', { ascending: true });

  if (error && isMissingPersonaSignalSelectionsTable(error)) {
    return new Map();
  }
  if (error) throw error;

  const selections = new Map<string, string[]>();
  for (const row of (data || []) as Array<{ persona_id: string; signal_id: string }>) {
    const current = selections.get(row.persona_id) || [];
    current.push(row.signal_id);
    selections.set(row.persona_id, current);
  }

  return selections;
}


/** Per-ICP ordered rows with weights from icp_signal_selections. */
export async function loadIcpSignalSelectionsDetailed(
  supabase: DatabaseClient,
  userId: string,
  icpIds: string[]
): Promise<Map<string, Array<{ signalId: string; rank: number; weight: number }>>> {
  if (icpIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('icp_signal_selections')
    .select('icp_id, signal_id, rank, weight')
    .eq('user_id', userId)
    .in('icp_id', icpIds)
    .order('rank', { ascending: true });

  if (error) throw error;

  const out = new Map<string, Array<{ signalId: string; rank: number; weight: number }>>();
  for (const row of data || []) {
    const icp_id = row.icp_id as string;
    const arr = out.get(icp_id) || [];
    arr.push({
      signalId: row.signal_id as string,
      rank: Number(row.rank),
      weight: Number(row.weight),
    });
    out.set(icp_id, arr);
  }
  return out;
}


export async function hydrateIcpsWithSignals<T extends EntityWithId>(
  supabase: DatabaseClient,
  userId: string,
  icps: T[]
): Promise<Array<T & { signals: string[] }>> {
  const selections = await loadIcpSignalSelections(supabase, userId, icps.map((icp) => icp.id));

  return icps.map((icp) => ({
    ...normalizePlatformTaxonomyFields(icp as T & Record<string, unknown>),
    signals: selections.get(icp.id) ?? parseLegacySignalIds(icp.signals),
  }));
}

type PersonaEntity = { id: string; signals?: unknown };

export async function hydratePersonasWithSignals<T extends PersonaEntity>(
  supabase: DatabaseClient,
  userId: string,
  personas: T[]
): Promise<Array<T & { signals: string[] }>> {
  const selections = await loadPersonaSignalSelections(supabase, userId, personas.map((p) => p.id));

  return personas.map((persona) => ({
    ...persona,
    signals: selections.get(persona.id) ?? parseLegacySignalIds(persona.signals),
  }));
}

