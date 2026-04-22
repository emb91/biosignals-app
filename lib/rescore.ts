/**
 * Rescoring — re-evaluate fit scores for all contacts when personas change.
 *
 * Uses the Supabase service-role client so it can run without a user session
 * (safe to call fire-and-forget from server-side handlers).
 *
 * Flow:
 *  1. Load all personas for the user
 *  2. Page through contacts in batches of CONTACT_PAGE_SIZE
 *  3. Score each page via scoreContacts() (which itself batches 10 per LLM call)
 *  4. Bulk-update each contact's fit fields
 */

import { createClient } from '@supabase/supabase-js';
import { scoreContacts, type PersonaRow, type ContactLike } from '@/lib/scoring';

const CONTACT_PAGE_SIZE = 100; // contacts fetched per DB page

// ─── Service-role client ───────────────────────────────────────────────────────
// Bypasses RLS — only used server-side, never exposed to the browser.

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service role credentials');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RescoreResult = {
  rescored: number;
  failed: number;
  skipped: number; // contacts with no personas to score against
};

type ContactRow = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  job_title_standardised: string | null;
  headline: string | null;
  seniority_level: string | null;
  business_area: string | null;
  company_name: string | null;
  companies: {
    company_name: string | null;
  }[] | null;
};

const getCanonicalCompanyName = (contact: ContactRow): string | null =>
  contact.companies?.[0]?.company_name || contact.company_name;

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Rescore ALL contacts for a given user against their current personas.
 * Safe to call fire-and-forget — errors are caught and returned in the result.
 */
export async function rescoreAllContactsForUser(userId: string): Promise<RescoreResult> {
  const supabase = getServiceClient();

  // 1. Load personas
  const { data: personas, error: personaError } = await supabase
    .from('personas')
    .select('id, name, job_titles, seniority_levels, functions')
    .eq('user_id', userId);

  if (personaError) {
    console.error('[rescore] Failed to load personas:', personaError);
    throw personaError;
  }

  if (!personas || personas.length === 0) {
    return { rescored: 0, failed: 0, skipped: 0 };
  }

  const result: RescoreResult = { rescored: 0, failed: 0, skipped: 0 };
  let page = 0;

  // 2. Page through contacts
  while (true) {
    const { data: contacts, error: fetchError } = await supabase
      .from('contacts')
      .select(
        'id, full_name, job_title, job_title_standardised, headline, seniority_level, business_area, company_name, companies(company_name)'
      )
      .eq('user_id', userId)
      .range(page * CONTACT_PAGE_SIZE, (page + 1) * CONTACT_PAGE_SIZE - 1)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('[rescore] Failed to fetch contacts page', page, fetchError);
      break;
    }

    if (!contacts || contacts.length === 0) break;

    const contactsToScore: ContactLike[] = (contacts as ContactRow[]).map((c) => ({
      full_name: c.full_name,
      job_title: c.job_title,
      job_title_standardised: c.job_title_standardised,
      headline: c.headline,
      seniority_level: c.seniority_level,
      business_area: c.business_area,
      company_name: getCanonicalCompanyName(c),
    }));

    // 3. Score via LLM
    let scoreResults;
    try {
      scoreResults = await scoreContacts(contactsToScore, personas as PersonaRow[]);
    } catch (err) {
      console.error('[rescore] LLM scoring failed for page', page, err);
      result.failed += contacts.length;
      page++;
      continue;
    }

    // 4. Bulk update contacts
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i] as ContactRow;
      const sr = scoreResults[i];

      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          fit_score: sr.score_normalised,
          fit_score_reasoning: sr.reasoning,
          fit_score_matched_on: sr.matched_on,
          fit_score_gaps: sr.gaps,
          scored_against_persona_id: sr.persona_id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id)
        .eq('user_id', userId); // belt-and-suspenders RLS bypass safety

      if (updateError) {
        console.error('[rescore] Failed to update contact', contact.id, updateError);
        result.failed++;
      } else {
        result.rescored++;
      }
    }

    if (contacts.length < CONTACT_PAGE_SIZE) break; // last page
    page++;
  }

  console.log(`[rescore] user=${userId} rescored=${result.rescored} failed=${result.failed}`);
  return result;
}
