import { scoreContacts, type ContactLike, type FitScoreResult, type PersonaRow } from '@/lib/scoring';
import { createAdminClient } from '@/lib/supabase-admin';
import { listActiveCompanyStateForUser } from '@/lib/org-company-state';

const SCORE_VERSION = 'contact_fit_llm_v2';

type MinimalSupabase = {
  from: (table: string) => any;
};

type ContactScoreRow = ContactLike & {
  id: string;
  user_id: string;
  company_id: string | null;
  matched_icp_id: string | null;
};

type PersonaScoreRow = PersonaRow & {
  id: string;
  user_id: string;
  icp_id: string | null;
};

type ExistingScoreRow = {
  contact_id: string;
  persona_id: string;
};

type BreakdownComponent = {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  score01: number;
  detail: string;
  matchedValue?: string | null;
  matchStatus?: string;
};

type ContactFitBreakdown = {
  score_version: string;
  scorer: 'llm';
  matched_on: string[];
  gaps: string[];
  summary: {
    raw_score01: number;
    final_score01: number;
    raw_score_pct: number;
    final_score_pct: number;
    coverage01: number;
    reasoning: string;
  };
  components: {
    business_area: BreakdownComponent;
    seniority: BreakdownComponent;
  };
};

type ContactPersonaScoreResult = {
  contactId: string;
  personaId: string;
  personaName: string | null;
  icpId: string | null;
  rawScore01: number;
  finalScore01: number;
  coverage01: number;
  reasoning: string;
  matchedOn: string[];
  gapsText: string;
  breakdown: ContactFitBreakdown;
};

export type ContactFitSyncResult = {
  contactsScored: number;
  failed: number;
  skipped: number;
};

function roundScore01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function scoreToPercent(value01: number): number {
  return Math.round(value01 * 100);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function splitGaps(value: string): string[] {
  return value
    .split(/[.;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchedTokenSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeToken).filter(Boolean));
}

function makeLlmComponent(params: {
  label: string;
  active: boolean;
  available: boolean;
  matched: boolean;
  score01: number;
  detail: string;
  matchedValue?: string | null;
}): BreakdownComponent {
  const weight = 50;
  const componentScore = params.matched ? 1 : params.active ? params.score01 : 0;
  return {
    label: params.label,
    active: params.active,
    available: params.available,
    weight,
    earned: Math.round(componentScore * weight * 1000) / 1000,
    score01: roundScore01(componentScore),
    detail: params.detail,
    matchedValue: params.matchedValue ?? null,
    matchStatus: params.matched ? 'llm_match' : params.available ? 'llm_reviewed' : 'unknown',
  };
}

function buildBreakdown(
  contact: ContactScoreRow,
  persona: PersonaScoreRow,
  score: FitScoreResult,
): ContactFitBreakdown {
  const finalScore01 = roundScore01(score.score_normalised);
  const matched = matchedTokenSet(score.matched_on);
  const gaps = splitGaps(score.gaps);
  const hasFunctionMatch = matched.has('function') || matched.has('business area') || matched.has('title');
  const hasSeniorityMatch = matched.has('seniority');

  const businessDetail = score.reasoning || (
    score.gaps
      ? `LLM found business-function uncertainty: ${score.gaps}`
      : 'LLM reviewed title, headline, normalized function, and persona function criteria.'
  );
  const seniorityDetail = hasSeniorityMatch
    ? `LLM found seniority alignment for ${contact.seniority_level || 'the visible seniority signal'}.`
    : score.gaps || 'LLM reviewed seniority against persona criteria.';

  return {
    score_version: SCORE_VERSION,
    scorer: 'llm',
    matched_on: score.matched_on,
    gaps,
    summary: {
      raw_score01: finalScore01,
      final_score01: finalScore01,
      raw_score_pct: score.score,
      final_score_pct: score.score,
      coverage01: 1,
      reasoning: score.reasoning,
    },
    components: {
      business_area: makeLlmComponent({
        label: 'Business function',
        active: Boolean(persona.functions?.length || persona.job_titles?.length),
        available: Boolean(contact.job_title || contact.job_title_standardised || contact.business_area || contact.headline),
        matched: hasFunctionMatch,
        score01: finalScore01,
        detail: businessDetail,
        matchedValue: hasFunctionMatch
          ? contact.job_title_standardised || contact.job_title || contact.business_area || null
          : null,
      }),
      seniority: makeLlmComponent({
        label: 'Seniority',
        active: Boolean(persona.seniority_levels?.length),
        available: Boolean(contact.seniority_level || contact.job_title || contact.job_title_standardised),
        matched: hasSeniorityMatch,
        score01: finalScore01,
        detail: seniorityDetail,
        matchedValue: hasSeniorityMatch ? contact.seniority_level || null : null,
      }),
    },
  };
}

function buildContactPanelSummary(contact: ContactScoreRow): string {
  const name = contact.full_name?.trim() || 'This contact';
  const role = contact.job_title?.trim() || 'unknown role';
  const companyHint = contact.company_id ? 'their linked account' : 'a company not yet linked';
  return `${name} is tracked as ${role} at ${companyHint}. This summary updates when profile or scoring context changes.`;
}

function buildContactFitSummary(
  contact: ContactScoreRow,
  winner: ContactPersonaScoreResult | null,
): string {
  const name = contact.full_name?.trim() || 'This contact';
  if (!winner) {
    return `${name} has no eligible persona match yet, so contact fit is low.`;
  }
  const personaLabel = winner.personaName?.trim() || 'the best-matching persona';
  return `${name} is currently ${scoreToPercent(winner.finalScore01)}% aligned to ${personaLabel}.`;
}

async function loadPersonasForUser(supabase: MinimalSupabase, userId: string): Promise<PersonaScoreRow[]> {
  const { data, error } = await supabase
    .from('personas')
    .select('id, user_id, icp_id, name, functions, seniority_levels, job_titles')
    .eq('user_id', userId);

  if (error) throw error;
  return (data || []) as PersonaScoreRow[];
}

async function loadContactsById(
  supabase: MinimalSupabase,
  userId: string,
  contactIds: string[],
): Promise<ContactScoreRow[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, user_id, company_id, full_name, job_title, job_title_standardised, headline, seniority_level, business_area, company_name')
    .eq('user_id', userId)
    .in('id', contactIds);

  if (error) throw error;

  const contacts = (data || []) as ContactScoreRow[];
  const companyIds = [...new Set(contacts.map((contact) => contact.company_id).filter(Boolean))] as string[];

  if (companyIds.length === 0) {
    return contacts.map((contact) => ({ ...contact, matched_icp_id: null }));
  }

  const companyRows = (await listActiveCompanyStateForUser(
    supabase as any,
    userId,
    'company_id, matched_icp_id',
  )) as Array<{ company_id: string; matched_icp_id?: string | null }>;
  const companyIdSet = new Set(companyIds);
  const matchedIcpByCompanyId = new Map(
    companyRows
      .filter((row) => companyIdSet.has(row.company_id))
      .map((row) => [row.company_id, row.matched_icp_id ?? null]),
  );

  return contacts.map((contact) => ({
    ...contact,
    matched_icp_id:
      contact.company_id && matchedIcpByCompanyId.has(contact.company_id)
        ? matchedIcpByCompanyId.get(contact.company_id) ?? null
        : null,
  }));
}

async function loadExistingScores(
  supabase: MinimalSupabase,
  userId: string,
  contactIds: string[],
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('contact_persona_scores')
    .select('contact_id, persona_id')
    .eq('user_id', userId)
    .in('contact_id', contactIds);

  if (error) throw error;

  const map = new Map<string, string[]>();
  for (const row of (data || []) as ExistingScoreRow[]) {
    const current = map.get(row.contact_id) || [];
    current.push(row.persona_id);
    map.set(row.contact_id, current);
  }
  return map;
}

async function clearContactFit(
  supabase: MinimalSupabase,
  userId: string,
  contact: ContactScoreRow,
): Promise<void> {
  const now = new Date().toISOString();

  const deleteResult = await supabase
    .from('contact_persona_scores')
    .delete()
    .eq('user_id', userId)
    .eq('contact_id', contact.id);

  if (deleteResult.error) throw deleteResult.error;

  const updateResult = await supabase
    .from('contacts')
    .update({
      scored_against_persona_id: null,
      contact_fit_score: 0,
      contact_fit_breakdown: null,
      contact_fit_coverage: null,
      contact_fit_scored_at: now,
      contact_fit_version: SCORE_VERSION,
      contact_panel_summary: buildContactPanelSummary(contact),
      contact_fit_summary: buildContactFitSummary(contact, null),
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('id', contact.id);

  if (updateResult.error) throw updateResult.error;
}

function scoreResultForContact(
  contact: ContactScoreRow,
  personas: PersonaScoreRow[],
  score: FitScoreResult,
): ContactPersonaScoreResult {
  const persona =
    personas.find((candidate) => candidate.id === score.persona_id) ??
    personas.find((candidate) => candidate.name === score.persona_name) ??
    personas[0];
  const finalScore01 = roundScore01(score.score_normalised);

  return {
    contactId: contact.id,
    personaId: persona.id,
    personaName: persona.name ?? null,
    icpId: persona.icp_id ?? null,
    rawScore01: finalScore01,
    finalScore01,
    coverage01: 1,
    reasoning: score.reasoning,
    matchedOn: score.matched_on,
    gapsText: score.gaps,
    breakdown: buildBreakdown(contact, persona, score),
  };
}

async function persistScoreForContact(
  supabase: MinimalSupabase,
  userId: string,
  contact: ContactScoreRow,
  score: ContactPersonaScoreResult,
  stalePersonaIds: string[],
): Promise<void> {
  const now = new Date().toISOString();

  const upsertResult = await supabase
    .from('contact_persona_scores')
    .upsert(
      {
        user_id: userId,
        contact_id: contact.id,
        company_id: contact.company_id,
        persona_id: score.personaId,
        icp_id: score.icpId,
        final_score: score.finalScore01,
        raw_score: score.rawScore01,
        coverage: score.coverage01,
        breakdown: score.breakdown,
        scored_at: now,
        score_version: SCORE_VERSION,
      },
      { onConflict: 'contact_id,persona_id' },
    );

  if (upsertResult.error) throw upsertResult.error;

  if (stalePersonaIds.length > 0) {
    const deleteResult = await supabase
      .from('contact_persona_scores')
      .delete()
      .eq('user_id', userId)
      .eq('contact_id', contact.id)
      .in('persona_id', stalePersonaIds);

    if (deleteResult.error) throw deleteResult.error;
  }

  const updateResult = await supabase
    .from('contacts')
    .update({
      scored_against_persona_id: score.personaId,
      contact_fit_score: score.finalScore01,
      contact_fit_breakdown: score.breakdown,
      contact_fit_coverage: score.coverage01,
      contact_fit_scored_at: now,
      contact_fit_version: SCORE_VERSION,
      contact_panel_summary: buildContactPanelSummary(contact),
      contact_fit_summary: buildContactFitSummary(contact, score),
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('id', contact.id);

  if (updateResult.error) throw updateResult.error;
}

export async function syncContactFitForContacts(
  supabase: MinimalSupabase,
  userId: string,
  contactIds: string[],
): Promise<ContactFitSyncResult> {
  const uniqueContactIds = [...new Set(contactIds.filter(Boolean))];
  if (uniqueContactIds.length === 0) {
    return { contactsScored: 0, failed: 0, skipped: 0 };
  }

  const [personas, contacts, existingScores] = await Promise.all([
    loadPersonasForUser(supabase, userId),
    loadContactsById(supabase, userId, uniqueContactIds),
    loadExistingScores(supabase, userId, uniqueContactIds),
  ]);

  const result: ContactFitSyncResult = {
    contactsScored: 0,
    failed: 0,
    skipped: 0,
  };

  for (const contactId of uniqueContactIds) {
    const contact = contacts.find((candidate) => candidate.id === contactId);
    if (!contact) {
      result.skipped += 1;
      continue;
    }

    try {
      if (personas.length === 0) {
        await clearContactFit(supabase, userId, contact);
        result.contactsScored += 1;
        continue;
      }

      const eligiblePersonas = contact.matched_icp_id
        ? personas.filter((persona) => persona.icp_id === contact.matched_icp_id)
        : personas;

      if (eligiblePersonas.length === 0) {
        await clearContactFit(supabase, userId, contact);
        result.contactsScored += 1;
        continue;
      }

      const [llmScore] = await scoreContacts([contact], eligiblePersonas);
      const persistedScore = scoreResultForContact(contact, eligiblePersonas, llmScore);
      const stalePersonaIds = (existingScores.get(contact.id) || []).filter(
        (personaId) => personaId !== persistedScore.personaId,
      );

      await persistScoreForContact(supabase, userId, contact, persistedScore, stalePersonaIds);
      result.contactsScored += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[contact-fit] Failed LLM scoring contact', contactId, error);
    }
  }

  return result;
}

export async function syncContactFitForContact(
  supabase: MinimalSupabase,
  userId: string,
  contactId: string,
): Promise<ContactFitSyncResult> {
  return syncContactFitForContacts(supabase, userId, [contactId]);
}

export async function rescoreAllContactFitForUser(userId: string): Promise<ContactFitSyncResult> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', userId);

  if (error) throw error;

  return syncContactFitForContacts(
    supabase,
    userId,
    ((data || []) as Array<{ id: string }>).map((row) => row.id),
  );
}
