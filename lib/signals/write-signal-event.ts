/**
 * Opinionated entry-point for inserting signal events — validates catalog + scope,
 * ensures required entity IDs, inserts into public.signals.
 * Company signals are keyed by companies.id (shared across that account’s contacts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { writeCompanySignalEvent, writeContactSignalEvent } from '@/lib/signals/events';

type DatabaseClient = SupabaseClient<any, 'public', any>;

export type InsertCompanySignalEventInput = Parameters<typeof writeCompanySignalEvent>[1];

export type InsertContactSignalEventInput = Parameters<typeof writeContactSignalEvent>[1];

export async function insertCompanySignalEvent(
  supabase: DatabaseClient,
  input: InsertCompanySignalEventInput
) {
  if (!input.companyId?.trim()) {
    throw new Error('companyId is required for company signal events');
  }
  return writeCompanySignalEvent(supabase, input);
}

export async function insertContactSignalEvent(
  supabase: DatabaseClient,
  input: InsertContactSignalEventInput
) {
  if (!input.contactId?.trim()) {
    throw new Error('contactId is required for contact signal events');
  }
  return writeContactSignalEvent(supabase, input);
}
