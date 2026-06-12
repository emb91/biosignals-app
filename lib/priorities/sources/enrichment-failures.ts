/**
 * Group failed contact enrichment jobs into one /today priority.
 *
 * This replaces the old "one failed job = one to-do" behaviour. The row names the
 * affected people and exposes IDs so /today can retry them directly.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ROUTES, withQuery } from '@/lib/routes';
import type { TodayPriority } from '@/lib/priorities/types';

function contactName(row: Record<string, unknown>): string {
  const fullName = typeof row.full_name === 'string' ? row.full_name.trim() : '';
  if (fullName) return fullName;

  const firstName = typeof row.first_name === 'string' ? row.first_name.trim() : '';
  const lastName = typeof row.last_name === 'string' ? row.last_name.trim() : '';
  return [firstName, lastName].filter(Boolean).join(' ').trim() || 'Imported contact';
}

function namePreview(names: string[], max = 4): string {
  const shown = names.slice(0, max);
  const overflow = names.length - shown.length;
  const base = shown.join(', ');
  return overflow > 0 ? `${base} +${overflow}` : base;
}

export async function computeEnrichmentFailuresPriority(
  supabase: SupabaseClient,
  userId: string,
): Promise<TodayPriority | null> {
  const { data } = await supabase
    .from('contacts')
    .select('id, full_name, first_name, last_name, enrichment_refresh_finished_at, enrichment_refresh_started_at')
    .eq('user_id', userId)
    .eq('enrichment_refresh_status', 'failed')
    .order('enrichment_refresh_finished_at', { ascending: false, nullsFirst: false })
    .order('enrichment_refresh_started_at', { ascending: false, nullsFirst: false });

  const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => typeof row.id === 'string');
  if (rows.length === 0) return null;

  const names = rows.map(contactName);
  const contactIds = rows.map((row) => row.id as string);
  const preview = namePreview(names);

  return {
    source: 'enrichment-failures',
    groupKey: 'contacts',
    severity: 'high',
    title: 'Review enrichment failures',
    detail: preview
      ? `${preview}. Retry the failed people enrichment jobs.`
      : 'Retry the failed people enrichment jobs.',
    href: withQuery(ROUTES.contacts, 'agentTask=enrichment_failures'),
    cta: 'Re-enrich',
    count: rows.length,
    action: {
      type: 'reenrich-contacts',
      contactIds,
    },
  };
}
