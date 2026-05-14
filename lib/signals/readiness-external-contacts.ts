import {
  generateAccountReason,
  ingestSignalSourceEvent,
  normalizeSignalSourceEvent,
  recomputeAccountReadiness,
} from '@/lib/signals/readiness-service';
import type { BuyerFunction, SignalKey } from '@/lib/signals/readiness-types';
import type { SupabaseClient } from '@supabase/supabase-js';

type DatabaseClient = SupabaseClient<any, 'public', any>;

const EXTERNAL_CONTACT_SIGNAL_SOURCE = 'apify_linkedin_people_monitor';

type ExternalContactBaseline = {
  userId: string;
  contactId: string;
  companyId: string | null;
  fullName: string | null;
  linkedinUrl: string | null;
  email: string | null;
  companyName: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
  businessArea: string | null;
  previouslyEnriched: boolean;
};

type ExternalContactCurrent = {
  companyId: string | null;
  fullName: string | null;
  linkedinUrl: string | null;
  email: string | null;
  companyName: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
  businessArea: string | null;
  sourceProvider: string | null;
  eventAt: string;
};

type ExternalContactSignalDecision = {
  sourceEventType: string;
  signalKeys: SignalKey[];
  title: string;
  summary: string;
  buyerFunctionsOverride?: BuyerFunction[];
  metadata: Record<string, unknown>;
} | null;

function normalizeText(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function normalizeDisplayText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeDomain(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

const SENIORITY_RANKS: Array<{ rank: number; patterns: RegExp[] }> = [
  { rank: 7, patterns: [/\bchief\b/i, /\bc.?suite\b/i, /\bceo\b/i, /\bcfo\b/i, /\bcto\b/i, /\bcoo\b/i, /\bcmo\b/i, /\bpresident\b/i] },
  { rank: 6, patterns: [/\bsvp\b/i, /\bvice president\b/i, /\bvp\b/i] },
  { rank: 5, patterns: [/\bhead\b/i, /\bdirector\b/i, /\bmanaging director\b/i] },
  { rank: 4, patterns: [/\bsenior manager\b/i, /\bmanager\b/i, /\blead\b/i] },
  { rank: 3, patterns: [/\bprincipal\b/i, /\bsenior\b/i] },
  { rank: 2, patterns: [/\bassociate\b/i, /\bspecialist\b/i] },
  { rank: 1, patterns: [/\banalyst\b/i, /\bcoordinator\b/i, /\bassistant\b/i] },
];

function seniorityRank(title?: string | null, seniorityLevel?: string | null): number {
  const normalizedLevel = normalizeText(seniorityLevel);
  if (normalizedLevel === 'c_suite' || normalizedLevel === 'c-suite' || normalizedLevel === 'executive') return 7;
  if (normalizedLevel === 'vp' || normalizedLevel === 'vice_president' || normalizedLevel === 'vice president') return 6;
  if (normalizedLevel === 'director') return 5;
  if (normalizedLevel === 'manager') return 4;
  if (normalizedLevel === 'senior_individual_contributor' || normalizedLevel === 'senior individual contributor') return 3;
  if (normalizedLevel === 'individual_contributor' || normalizedLevel === 'individual contributor') return 2;

  if (!title) return 0;
  for (const item of SENIORITY_RANKS) {
    if (item.patterns.some((pattern) => pattern.test(title))) return item.rank;
  }
  return 0;
}

function roleFamily(title?: string | null, businessArea?: string | null): string | null {
  const normalizedArea = normalizeText(businessArea);
  if (normalizedArea === 'commercial') return 'commercial';
  if (normalizedArea === 'operations') return 'manufacturing_and_cmc';
  if (normalizedArea === 'finance') return 'finance';
  if (normalizedArea === 'scientific/technical' || normalizedArea === 'scientific_technical') return 'research_and_development';

  if (!title) return null;
  const normalized = title.toLowerCase();
  if (/(scientific|science|research|r&d|discovery|translational|preclinical)/i.test(normalized)) return 'research_and_development';
  if (/(business development|bd|partnership|alliances|licensing)/i.test(normalized)) return 'business_development';
  if (/(commercial|sales|revenue|account manager|market access)/i.test(normalized)) return 'commercial';
  if (/(clinical|trial|site)/i.test(normalized)) return 'clinical_operations';
  if (/(regulatory|quality|compliance)/i.test(normalized)) return 'regulatory_affairs';
  if (/(manufacturing|cmc|process development|msat|operations)/i.test(normalized)) return 'manufacturing_and_cmc';
  if (/(procurement|purchasing|sourcing)/i.test(normalized)) return 'procurement';
  if (/(technology|systems|it|data|informatics|engineering)/i.test(normalized)) return 'technology_and_systems';
  if (/(finance|accounting)/i.test(normalized)) return 'finance';
  return null;
}

function inferBuyerFunctions(title?: string | null, businessArea?: string | null): BuyerFunction[] {
  const family = roleFamily(title, businessArea);
  switch (family) {
    case 'business_development':
      return ['business_development', 'partnerships'];
    case 'commercial':
      return ['commercial'];
    case 'clinical_operations':
      return ['clinical_operations'];
    case 'research_and_development':
      return ['research_and_development'];
    case 'regulatory_affairs':
      return ['regulatory_affairs', 'quality_and_compliance'];
    case 'manufacturing_and_cmc':
      return ['manufacturing_and_cmc'];
    case 'procurement':
      return ['procurement'];
    case 'technology_and_systems':
      return ['technology_and_systems', 'data_and_informatics'];
    case 'finance':
      return ['procurement'];
    default:
      return [];
  }
}

function isMateriallyRelevant(title?: string | null, businessArea?: string | null): boolean {
  return Boolean(normalizeDisplayText(title) || normalizeText(businessArea));
}

function buildDecision(
  previous: ExternalContactBaseline,
  current: ExternalContactCurrent
): ExternalContactSignalDecision {
  const prevCompanyId = previous.companyId;
  const nextCompanyId = current.companyId;
  const prevCompanyName = normalizeText(previous.companyName);
  const nextCompanyName = normalizeText(current.companyName);
  const prevCompanyDomain = normalizeDomain(previous.companyDomain);
  const nextCompanyDomain = normalizeDomain(current.companyDomain);
  const prevTitle = normalizeDisplayText(previous.jobTitle);
  const nextTitle = normalizeDisplayText(current.jobTitle);
  const prevTitleNorm = normalizeText(previous.jobTitle);
  const nextTitleNorm = normalizeText(current.jobTitle);
  const prevRole = roleFamily(previous.jobTitle, previous.businessArea);
  const nextRole = roleFamily(current.jobTitle, current.businessArea);
  const prevRank = seniorityRank(previous.jobTitle, previous.seniorityLevel);
  const nextRank = seniorityRank(current.jobTitle, current.seniorityLevel);
  const buyerFunctionsOverride = inferBuyerFunctions(current.jobTitle, current.businessArea);

  if (
    previous.previouslyEnriched &&
    ((prevCompanyId && nextCompanyId && prevCompanyId !== nextCompanyId) ||
      (!prevCompanyId && !nextCompanyId && prevCompanyDomain && nextCompanyDomain && prevCompanyDomain !== nextCompanyDomain) ||
      (!prevCompanyDomain && !nextCompanyDomain && prevCompanyName && nextCompanyName && prevCompanyName !== nextCompanyName))
  ) {
    return {
      sourceEventType: 'recently_changed_company',
      signalKeys: ['recently_changed_company'],
      title: 'Apify / LinkedIn company change detected',
      summary:
        'Arcova detected through Apify / LinkedIn monitoring that this contact appears to have moved to a different company.',
      buyerFunctionsOverride,
      metadata: {
        previous_company_name: previous.companyName,
        previous_company_domain: previous.companyDomain,
        current_company_name: current.companyName,
        current_company_domain: current.companyDomain,
      },
    };
  }

  if (
    previous.previouslyEnriched &&
    prevTitleNorm &&
    nextTitleNorm &&
    prevTitleNorm !== nextTitleNorm
  ) {
    if (nextRank > prevRank && nextRank > 0) {
      return {
        sourceEventType: 'recently_promoted',
        signalKeys: ['recently_promoted'],
        title: 'Apify / LinkedIn promotion detected',
        summary:
          'Arcova detected through Apify / LinkedIn monitoring that this contact appears to have been promoted.',
        buyerFunctionsOverride,
        metadata: {
          previous_job_title: previous.jobTitle,
          current_job_title: current.jobTitle,
        },
      };
    }

    if (prevRole && nextRole && prevRole !== nextRole) {
      return {
        sourceEventType: 'new_internal_role',
        signalKeys: ['new_internal_role'],
        title: 'Apify / LinkedIn internal role change detected',
        summary:
          'Arcova detected through Apify / LinkedIn monitoring that this contact appears to have moved into a different internal function.',
        buyerFunctionsOverride,
        metadata: {
          previous_job_title: previous.jobTitle,
          current_job_title: current.jobTitle,
          previous_role_family: prevRole,
          current_role_family: nextRole,
        },
      };
    }

    return {
      sourceEventType: 'title_change',
      signalKeys: ['title_change'],
      title: 'Apify / LinkedIn title change detected',
      summary:
        'Arcova detected a materially different title for this contact through Apify / LinkedIn monitoring.',
      buyerFunctionsOverride,
      metadata: {
        previous_job_title: previous.jobTitle,
        current_job_title: current.jobTitle,
      },
    };
  }

  if (
    !previous.previouslyEnriched &&
    current.companyId &&
    isMateriallyRelevant(current.jobTitle, current.businessArea)
  ) {
    return {
      sourceEventType: 'new_to_role',
      signalKeys: ['new_to_role'],
      title: 'New Apify / LinkedIn stakeholder detected',
      summary: 'Arcova surfaced a newly relevant contact from Apify / LinkedIn monitoring.',
      buyerFunctionsOverride,
      metadata: {
        current_company_name: current.companyName,
        current_company_domain: current.companyDomain,
        current_job_title: current.jobTitle,
      },
    };
  }

  return null;
}

export async function emitExternalContactSignalsFromEnrichment(
  supabase: DatabaseClient,
  input: {
    previous: ExternalContactBaseline;
    current: ExternalContactCurrent;
  }
): Promise<{ emittedSignalTypes: string[]; recomputedCompanies: string[] }> {
  const decision = buildDecision(input.previous, input.current);
  if (!decision || !input.current.companyId) {
    return { emittedSignalTypes: [], recomputedCompanies: [] };
  }

  const sourceEventId = `${EXTERNAL_CONTACT_SIGNAL_SOURCE}:${input.previous.contactId}:${decision.sourceEventType}:${input.current.eventAt}`;
  const ingestResult = await ingestSignalSourceEvent(supabase, {
    userId: input.previous.userId,
    entityScope: 'contact',
    companyId: input.current.companyId,
    contactId: input.previous.contactId,
    source: EXTERNAL_CONTACT_SIGNAL_SOURCE,
    sourceEventType: decision.sourceEventType,
    sourceEventId,
    sourceUrl: input.current.linkedinUrl,
    title: decision.title,
    summary: decision.summary,
    excerpt: decision.summary,
    eventAt: input.current.eventAt,
    metadata: {
      source_provider: input.current.sourceProvider,
      email: input.current.email,
      previous_company_name: input.previous.companyName,
      previous_company_domain: input.previous.companyDomain,
      current_company_name: input.current.companyName,
      current_company_domain: input.current.companyDomain,
      previous_job_title: input.previous.jobTitle,
      current_job_title: input.current.jobTitle,
      ...decision.metadata,
    },
  });

  const rawEvent = {
    id: ingestResult.sourceEventId,
    userId: input.previous.userId,
    entityId: input.previous.contactId,
    entityScope: 'contact' as const,
    source: EXTERNAL_CONTACT_SIGNAL_SOURCE,
    sourceUrl: input.current.linkedinUrl,
    sourceEventType: decision.sourceEventType,
    sourceEventId,
    title: decision.title,
    summary: decision.summary,
    excerpt: decision.summary,
    eventAt: input.current.eventAt,
    observedAt: new Date().toISOString(),
    metadata: {
      source_provider: input.current.sourceProvider,
      email: input.current.email,
      previous_company_name: input.previous.companyName,
      previous_company_domain: input.previous.companyDomain,
      current_company_name: input.current.companyName,
      current_company_domain: input.current.companyDomain,
      previous_job_title: input.previous.jobTitle,
      current_job_title: input.current.jobTitle,
      ...decision.metadata,
    },
  };

  await normalizeSignalSourceEvent(supabase, {
    userId: input.previous.userId,
    rawEvent,
    signalKeys: decision.signalKeys,
    buyerFunctionsOverride: decision.buyerFunctionsOverride,
    companyId: input.current.companyId,
    contactId: input.previous.contactId,
  });

  await recomputeAccountReadiness(supabase, {
    userId: input.previous.userId,
    companyId: input.current.companyId,
  });

  await generateAccountReason(supabase, {
    userId: input.previous.userId,
    companyId: input.current.companyId,
  });

  return {
    emittedSignalTypes: decision.signalKeys,
    recomputedCompanies: [input.current.companyId],
  };
}
