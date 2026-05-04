import {
  BUSINESS_AREA_OPTIONS,
  SENIORITY_LEVEL_OPTIONS,
  type BusinessArea,
  type SeniorityLevel,
} from '@/lib/arcova-taxonomy';
import { createAdminClient } from '@/lib/supabase-admin';

const SCORE_VERSION = 'contact_fit_v1';

const COMPONENT_WEIGHTS = {
  businessArea: 70,
  seniority: 30,
} as const;

type MinimalSupabase = {
  from: (table: string) => any;
};

type ContactScoreRow = {
  id: string;
  user_id: string;
  company_id: string | null;
  matched_icp_id: string | null;
  full_name: string | null;
  job_title: string | null;
  job_title_standardised: string | null;
  headline: string | null;
  seniority_level: string | null;
  business_area: string | null;
  fit_score: number | null;
  intent_score: number | null;
};

type PersonaScoreRow = {
  id: string;
  user_id: string;
  icp_id: string | null;
  name: string | null;
  functions: string[] | null;
  seniority_levels: string[] | null;
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
  breakdown: ContactFitBreakdown;
};

export type ContactFitSyncResult = {
  contactsScored: number;
  failed: number;
  skipped: number;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function roundScore01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function scoreToPercent(value01: number): number {
  return Math.round(value01 * 100);
}

function canonicalizeBusinessArea(value: unknown): BusinessArea | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeText(value);
  return BUSINESS_AREA_OPTIONS.find((option) => normalizeText(option) === normalized) ?? null;
}

function canonicalizeSeniority(value: unknown): SeniorityLevel | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeText(value);
  return SENIORITY_LEVEL_OPTIONS.find((option) => normalizeText(option) === normalized) ?? null;
}

function parsePersonaFunctions(values: string[] | null | undefined): BusinessArea[] {
  if (!values) return [];

  return dedupe(
    values
      .map((value) => {
        if (typeof value !== 'string') return null;
        try {
          const parsed = JSON.parse(value) as { name?: unknown };
          return canonicalizeBusinessArea(parsed?.name);
        } catch {
          return canonicalizeBusinessArea(value);
        }
      })
      .filter((value): value is BusinessArea => Boolean(value)),
  );
}

function canonicalizeSeniorityList(values: string[] | null | undefined): SeniorityLevel[] {
  return dedupe(
    (Array.isArray(values) ? values : [])
      .map((value) => canonicalizeSeniority(value))
      .filter((value): value is SeniorityLevel => Boolean(value)),
  );
}

const BUSINESS_AREA_SIMILARITY: Partial<Record<BusinessArea, Partial<Record<BusinessArea, number>>>> = {
  'Business Development': {
    Partnerships: 0.85,
    'Strategy & Corporate Development': 0.65,
    Commercial: 0.45,
  },
  Partnerships: {
    'Business Development': 0.85,
    'Strategy & Corporate Development': 0.55,
  },
  'Strategy & Corporate Development': {
    'Business Development': 0.65,
    Partnerships: 0.55,
    'Executive Leadership': 0.5,
  },
  Commercial: {
    Marketing: 0.7,
    'Sales Operations': 0.65,
    'Business Development': 0.45,
  },
  'Sales Operations': {
    Commercial: 0.65,
    Marketing: 0.35,
  },
  'Research & Development': {
    'Clinical Operations': 0.4,
    'Medical Affairs': 0.35,
    'Lab Operations': 0.55,
  },
  'Clinical Operations': {
    'Research & Development': 0.4,
    'Medical Affairs': 0.35,
  },
  'Technology & Systems': {
    'Data & Informatics': 0.75,
    'AI & Machine Learning': 0.7,
  },
  'Data & Informatics': {
    'Technology & Systems': 0.75,
    'AI & Machine Learning': 0.65,
  },
  'AI & Machine Learning': {
    'Technology & Systems': 0.7,
    'Data & Informatics': 0.65,
  },
  'Manufacturing & CMC': {
    'Quality & Compliance': 0.5,
    'Lab Operations': 0.35,
    Procurement: 0.3,
  },
  'Quality & Compliance': {
    'Manufacturing & CMC': 0.5,
    'Regulatory Affairs': 0.35,
  },
};

function businessAreaSimilarityPair(contactArea: BusinessArea, personaArea: BusinessArea): number {
  if (contactArea === personaArea) return 1;
  return (
    BUSINESS_AREA_SIMILARITY[contactArea]?.[personaArea] ??
    BUSINESS_AREA_SIMILARITY[personaArea]?.[contactArea] ??
    0
  );
}

function businessAreaSimilarity(
  contactArea: BusinessArea | null,
  personaAreas: BusinessArea[],
): { score: number | null; matchedValue: BusinessArea | null } {
  if (!contactArea || personaAreas.length === 0) {
    return { score: null, matchedValue: null };
  }

  let bestScore = -1;
  let bestValue: BusinessArea | null = null;

  for (const personaArea of personaAreas) {
    const score = businessAreaSimilarityPair(contactArea, personaArea);
    if (score > bestScore) {
      bestScore = score;
      bestValue = personaArea;
    }
  }

  return {
    score: bestScore >= 0 ? bestScore : null,
    matchedValue: bestValue,
  };
}

function senioritySimilarity(
  contactSeniority: SeniorityLevel | null,
  personaSeniorities: SeniorityLevel[],
): { score: number | null; matchedValue: SeniorityLevel | null } {
  if (!contactSeniority || personaSeniorities.length === 0) {
    return { score: null, matchedValue: null };
  }

  const contactIndex = SENIORITY_LEVEL_OPTIONS.findIndex((value) => value === contactSeniority);
  if (contactIndex < 0) {
    return { score: null, matchedValue: null };
  }

  let bestScore = -1;
  let bestValue: SeniorityLevel | null = null;

  for (const personaSeniority of personaSeniorities) {
    const personaIndex = SENIORITY_LEVEL_OPTIONS.findIndex((value) => value === personaSeniority);
    if (personaIndex < 0) continue;

    const distance = Math.abs(personaIndex - contactIndex);
    const score = distance === 0 ? 1 : distance === 1 ? 0.65 : distance === 2 ? 0.3 : 0;

    if (score > bestScore) {
      bestScore = score;
      bestValue = personaSeniority;
    }
  }

  return {
    score: bestScore >= 0 ? bestScore : null,
    matchedValue: bestValue,
  };
}

function makeComponent(params: {
  label: string;
  active: boolean;
  available: boolean;
  weight: number;
  earned: number;
  detail: string;
  matchedValue?: string | null;
  matchStatus?: string;
}): BreakdownComponent {
  const earned = Math.max(0, Math.min(params.weight, params.earned));
  return {
    label: params.label,
    active: params.active,
    available: params.available,
    weight: params.weight,
    earned,
    score01: params.weight > 0 ? roundScore01(earned / params.weight) : 0,
    detail: params.detail,
    matchedValue: params.matchedValue ?? null,
    matchStatus: params.matchStatus,
  };
}

function computeContactPersonaScore(
  contact: ContactScoreRow,
  persona: PersonaScoreRow,
): ContactPersonaScoreResult {
  const personaFunctions = parsePersonaFunctions(persona.functions);
  const contactBusinessArea = canonicalizeBusinessArea(contact.business_area);
  const businessAreaMatch = businessAreaSimilarity(contactBusinessArea, personaFunctions);
  const businessAreaComponent = makeComponent({
    label: 'Business function',
    active: personaFunctions.length > 0,
    available: Boolean(contactBusinessArea),
    weight: COMPONENT_WEIGHTS.businessArea,
    earned:
      personaFunctions.length > 0 && businessAreaMatch.score != null
        ? COMPONENT_WEIGHTS.businessArea * businessAreaMatch.score
        : 0,
    detail:
      personaFunctions.length === 0
        ? 'No business-function criteria.'
        : !contactBusinessArea
          ? `Business area is not classified yet; persona expects ${personaFunctions.join(', ')}.`
          : businessAreaMatch.score === 1
            ? `Exact match on ${contactBusinessArea}.`
            : businessAreaMatch.score && businessAreaMatch.score > 0
              ? `${contactBusinessArea} is adjacent to persona target ${businessAreaMatch.matchedValue}.`
              : `Persona expects ${personaFunctions.join(', ')}; contact is ${contactBusinessArea}.`,
    matchedValue: businessAreaMatch.matchedValue,
    matchStatus:
      businessAreaMatch.score === 1
        ? 'exact'
        : businessAreaMatch.score && businessAreaMatch.score > 0
          ? 'adjacent'
          : contactBusinessArea
            ? 'mismatch'
            : 'unknown',
  });

  const personaSeniorities = canonicalizeSeniorityList(persona.seniority_levels);
  const contactSeniority = canonicalizeSeniority(contact.seniority_level);
  const seniorityMatch = senioritySimilarity(contactSeniority, personaSeniorities);
  const seniorityComponent = makeComponent({
    label: 'Seniority',
    active: personaSeniorities.length > 0,
    available: Boolean(contactSeniority),
    weight: COMPONENT_WEIGHTS.seniority,
    earned:
      personaSeniorities.length > 0 && seniorityMatch.score != null
        ? COMPONENT_WEIGHTS.seniority * seniorityMatch.score
        : 0,
    detail:
      personaSeniorities.length === 0
        ? 'No seniority criteria.'
        : !contactSeniority
          ? `Seniority is not classified yet; persona expects ${personaSeniorities.join(', ')}.`
          : seniorityMatch.score === 1
            ? `Exact seniority match on ${contactSeniority}.`
            : seniorityMatch.score && seniorityMatch.score > 0
              ? `${contactSeniority} is near persona target ${seniorityMatch.matchedValue}.`
              : `Persona expects ${personaSeniorities.join(', ')}; contact is ${contactSeniority}.`,
    matchedValue: seniorityMatch.matchedValue,
    matchStatus:
      seniorityMatch.score === 1
        ? 'exact'
        : seniorityMatch.score && seniorityMatch.score > 0
          ? 'adjacent'
          : contactSeniority
            ? 'mismatch'
            : 'unknown',
  });

  const components = {
    business_area: businessAreaComponent,
    seniority: seniorityComponent,
  };

  const componentList = Object.values(components);
  const activeWeight = componentList.filter((component) => component.active).reduce((sum, component) => sum + component.weight, 0);
  const availableWeight = componentList
    .filter((component) => component.active && component.available)
    .reduce((sum, component) => sum + component.weight, 0);
  const earnedWeight = componentList.reduce((sum, component) => sum + component.earned, 0);

  const rawScore01 = activeWeight > 0 ? roundScore01(earnedWeight / activeWeight) : 0;
  const coverage01 = activeWeight > 0 ? roundScore01(availableWeight / activeWeight) : 0;
  const finalScore01 = rawScore01;

  const matchedOn = componentList
    .filter((component) => component.active && component.earned > 0)
    .map((component) => component.label);
  const gaps = componentList
    .filter((component) => component.active && component.earned < component.weight)
    .map((component) => component.label);

  const reasoning = [
    persona.name
      ? `Best persona match against ${persona.name} scores ${scoreToPercent(finalScore01)}%.`
      : `Best persona match scores ${scoreToPercent(finalScore01)}%.`,
    matchedOn.length > 0
      ? `Matched on ${matchedOn.join(', ')}.`
      : 'No strong contact-level matches yet.',
    gaps.length > 0
      ? `Still weaker or unresolved on ${gaps.join(', ')}.`
      : 'All active persona criteria align cleanly.',
  ].join(' ');

  return {
    contactId: contact.id,
    personaId: persona.id,
    personaName: persona.name,
    icpId: persona.icp_id,
    rawScore01,
    finalScore01,
    coverage01,
    breakdown: {
      score_version: SCORE_VERSION,
      matched_on: matchedOn,
      gaps,
      summary: {
        raw_score01: rawScore01,
        final_score01: finalScore01,
        raw_score_pct: scoreToPercent(rawScore01),
        final_score_pct: scoreToPercent(finalScore01),
        coverage01,
        reasoning,
      },
      components,
    },
  };
}

function pickWinner(scores: ContactPersonaScoreResult[]): ContactPersonaScoreResult | null {
  if (scores.length === 0) return null;

  return [...scores].sort((left, right) => {
    if (right.finalScore01 !== left.finalScore01) return right.finalScore01 - left.finalScore01;
    if (right.coverage01 !== left.coverage01) return right.coverage01 - left.coverage01;
    if (right.rawScore01 !== left.rawScore01) return right.rawScore01 - left.rawScore01;
    return (left.personaName || left.personaId).localeCompare(right.personaName || right.personaId);
  })[0];
}

async function loadPersonasForUser(supabase: MinimalSupabase, userId: string): Promise<PersonaScoreRow[]> {
  const { data, error } = await supabase
    .from('personas')
    .select('id, user_id, icp_id, name, functions, seniority_levels')
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
    .select('id, user_id, company_id, full_name, job_title, job_title_standardised, headline, seniority_level, business_area, fit_score, intent_score')
    .eq('user_id', userId)
    .in('id', contactIds);

  if (error) throw error;

  const contacts = (data || []) as ContactScoreRow[];
  const companyIds = [...new Set(contacts.map((contact) => contact.company_id).filter(Boolean))] as string[];

  if (companyIds.length === 0) {
    return contacts.map((contact) => ({ ...contact, matched_icp_id: null }));
  }

  const companyResult = await supabase
    .from('companies')
    .select('id, matched_icp_id')
    .eq('user_id', userId)
    .in('id', companyIds);

  if (companyResult.error) throw companyResult.error;

  const matchedIcpByCompanyId = new Map(
    ((companyResult.data || []) as Array<{ id: string; matched_icp_id: string | null }>)
      .filter((row) => typeof row.id === 'string')
      .map((row) => [row.id, row.matched_icp_id ?? null]),
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
  const companyFit = contact.fit_score ?? 0;
  const intent = contact.intent_score ?? 1;
  const priorityScore = Math.round(companyFit * 0.5 * intent * 1000) / 1000;

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
      priority_score: priorityScore,
      updated_at: now,
    })
    .eq('user_id', userId)
    .eq('id', contact.id);

  if (updateResult.error) throw updateResult.error;
}

async function persistScoresForContact(
  supabase: MinimalSupabase,
  userId: string,
  contact: ContactScoreRow,
  scores: ContactPersonaScoreResult[],
  stalePersonaIds: string[],
): Promise<void> {
  const now = new Date().toISOString();
  const winner = pickWinner(scores);

  if (scores.length > 0) {
    const rows = scores.map((score) => ({
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
    }));

    const upsertResult = await supabase
      .from('contact_persona_scores')
      .upsert(rows, { onConflict: 'contact_id,persona_id' });

    if (upsertResult.error) throw upsertResult.error;
  }

  if (stalePersonaIds.length > 0) {
    const deleteResult = await supabase
      .from('contact_persona_scores')
      .delete()
      .eq('user_id', userId)
      .eq('contact_id', contact.id)
      .in('persona_id', stalePersonaIds);

    if (deleteResult.error) throw deleteResult.error;
  }

  const newContactFit = winner?.finalScore01 ?? 0;
  const companyFit = contact.fit_score ?? 0;
  const intent = contact.intent_score ?? 1;
  const priorityScore = Math.round(companyFit * (0.5 + 0.5 * newContactFit) * intent * 1000) / 1000;

  const updateResult = await supabase
    .from('contacts')
    .update({
      scored_against_persona_id: winner?.personaId ?? null,
      contact_fit_score: newContactFit,
      contact_fit_breakdown: winner?.breakdown ?? null,
      contact_fit_coverage: winner?.coverage01 ?? null,
      contact_fit_scored_at: now,
      contact_fit_version: SCORE_VERSION,
      priority_score: priorityScore,
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

      const scores = eligiblePersonas.map((persona) => computeContactPersonaScore(contact, persona));
      const expectedPersonaIds = new Set(scores.map((score) => score.personaId));
      const stalePersonaIds = (existingScores.get(contact.id) || []).filter(
        (personaId) => !expectedPersonaIds.has(personaId),
      );

      await persistScoresForContact(supabase, userId, contact, scores, stalePersonaIds);
      result.contactsScored += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[contact-fit] Failed scoring contact', contactId, error);
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
