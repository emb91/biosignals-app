import { createAdminClient } from '@/lib/supabase-admin';
import { processQueuedRowsInBackground, type QueuedRow } from '@/lib/import-queue';
import {
  DEFAULT_CONTACTS_PER_COMPANY,
  recordDataAcquisitionUsageEvent,
} from '@/lib/data-acquisition-metering';
import {
  discoverApolloCompanies,
  discoverApolloPeopleForCompanies,
  type DiscoveredCompany,
  type DiscoveredPerson,
} from '@/lib/data-acquisition/apollo-discovery';
import {
  apolloOrganizationMatchesIcpKeywords,
  buildApolloCompanySearchRecipes,
  buildApolloPeopleSearchRecipe,
  icpKeywordCorpus,
  type AcquisitionIcp,
  type AcquisitionPersona,
} from '@/lib/data-acquisition/search-spec';

type DataAcquisitionJob = {
  id: string;
  user_id: string;
  icp_id: string;
  upload_batch_id: string | null;
  request_type: 'expand_companies' | 'better_contacts' | 'more_contacts_at_accounts' | 'contacts_at_company';
  target_company_count: number;
  target_contact_count: number | null;
  max_screened_companies: number | null;
  max_contact_enrichments: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type ExistingCompany = {
  company_name: string | null;
  domain?: string | null;
  company_website?: string | null;
  linkedin_url: string | null;
};

type ExistingContact = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
};

type CompanyContext = {
  id: string;
  company_name: string | null;
  domain: string | null;
  company_website: string | null;
  linkedin_url: string | null;
  matched_icp_id: string | null;
};

type DbCompanyRow = {
  id: string;
  company_name: string | null;
  domain: string | null;
  company_website: string | null;
  linkedin_url: string | null;
  apollo_organization_raw: unknown;
  employee_count: number | null;
};

function apolloOrgIdFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function discoveredCompanyFromDbRow(row: DbCompanyRow): DiscoveredCompany | null {
  const domain =
    (row.domain || row.company_website || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '') || null;
  const name = row.company_name?.trim() || domain;
  if (!name || !domain) return null;
  const sourceId = apolloOrgIdFromRaw(row.apollo_organization_raw);
  return {
    source: 'apollo',
    source_id: sourceId,
    name,
    domain,
    linkedin_url: row.linkedin_url || null,
    employee_count: typeof row.employee_count === 'number' ? row.employee_count : null,
    raw: {
      name,
      primary_domain: domain,
      website_url: row.company_website || row.domain || null,
      linkedin_url: row.linkedin_url || null,
      id: sourceId || undefined,
    },
  };
}

async function loadPrioritizedCompaniesForIcpAccounts(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  icpId: string,
  requestType: 'better_contacts' | 'more_contacts_at_accounts',
  limit: number,
): Promise<DbCompanyRow[]> {
  const { data: companies, error } = await admin
    .from('companies')
    .select('id, company_name, domain, company_website, linkedin_url, apollo_organization_raw, employee_count')
    .eq('user_id', userId)
    .eq('matched_icp_id', icpId);

  if (error) throw new Error(error.message);
  const rows = (companies || []) as DbCompanyRow[];
  if (rows.length === 0) return [];

  const { data: contacts, error: cErr } = await admin
    .from('contacts')
    .select('company_id, contact_fit_score')
    .eq('user_id', userId)
    .not('company_id', 'is', null);

  if (cErr) throw new Error(cErr.message);

  const byCompany = new Map<string, { count: number; fitSum: number; fitN: number }>();
  for (const row of contacts || []) {
    const cid = row.company_id as string | null;
    if (!cid) continue;
    if (!byCompany.has(cid)) byCompany.set(cid, { count: 0, fitSum: 0, fitN: 0 });
    const agg = byCompany.get(cid)!;
    agg.count += 1;
    const rawFit = row.contact_fit_score;
    if (typeof rawFit === 'number' && Number.isFinite(rawFit)) {
      let f = rawFit;
      if (f > 1 && f <= 100) f /= 100;
      if (f >= 0 && f <= 1) {
        agg.fitSum += f;
        agg.fitN += 1;
      }
    }
  }

  const scored = rows.map((row) => {
    const agg = byCompany.get(row.id) || { count: 0, fitSum: 0, fitN: 0 };
    const avgFit = agg.fitN > 0 ? agg.fitSum / agg.fitN : null;
    return { row, contactCount: agg.count, avgFit };
  });

  if (requestType === 'more_contacts_at_accounts') {
    scored.sort((a, b) => a.contactCount - b.contactCount || a.row.id.localeCompare(b.row.id));
  } else {
    scored.sort((a, b) => {
      const af = a.avgFit ?? -1;
      const bf = b.avgFit ?? -1;
      if (af !== bf) return af - bf;
      return a.contactCount - b.contactCount;
    });
  }

  return scored.slice(0, limit).map((s) => s.row);
}

async function ingestPeopleAndRunImportPipeline(
  admin: ReturnType<typeof createAdminClient>,
  job: DataAcquisitionJob,
  uniquePeople: DiscoveredPerson[],
  usageMeta: Record<string, unknown>,
): Promise<void> {
  const rawRows = uniquePeople.map((person) =>
    rawUploadFromPerson(job.user_id, job.upload_batch_id!, person, job.id),
  );
  const { data: insertedRows, error: insertError } =
    rawRows.length > 0
      ? await admin
          .from('raw_uploads')
          .insert(rawRows)
          .select('id, full_name, email, linkedin_url, company_name, raw_data')
      : { data: [], error: null };

  if (insertError) throw new Error(insertError.message);

  await admin
    .from('upload_batches')
    .update({
      total_rows: rawRows.length,
      status: rawRows.length > 0 ? 'processing' : 'complete',
      completed_at: rawRows.length > 0 ? null : new Date().toISOString(),
    })
    .eq('id', job.upload_batch_id);

  if (rawRows.length > 0) {
    await recordDataAcquisitionUsageEvent(admin, {
      jobId: job.id,
      userId: job.user_id,
      eventType: 'apollo_person_enrichment',
      provider: 'apollo',
      quantity: rawRows.length,
      metadata: { batchId: job.upload_batch_id, ...usageMeta },
    });
  }

  const queuedRows: QueuedRow[] = (insertedRows || []).map((row) => ({
    id: row.id as string,
    full_name: row.full_name as string | null,
    email: row.email as string | null,
    linkedin_url: row.linkedin_url as string | null,
    company_name: row.company_name as string | null,
    raw_data: row.raw_data as Record<string, unknown>,
  }));

  await updateJob(job.id, { status: rawRows.length > 0 ? 'enriching' : 'complete' });

  if (queuedRows.length > 0) {
    await processQueuedRowsInBackground({
      queuedRows,
      batchId: job.upload_batch_id!,
      userId: job.user_id,
    });

    const { count: importedContacts } = await admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id)
      .eq('batch_id', job.upload_batch_id);

    if (importedContacts && importedContacts > 0) {
      await recordDataAcquisitionUsageEvent(admin, {
        jobId: job.id,
        userId: job.user_id,
        eventType: 'imported_contact',
        provider: 'arcova',
        quantity: importedContacts,
        metadata: { batchId: job.upload_batch_id, ...usageMeta },
      });
    }
  }

  await updateJob(job.id, { status: 'complete', completed_at: new Date().toISOString() });
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companyKeys(company: Pick<DiscoveredCompany, 'domain' | 'linkedin_url' | 'name'>): string[] {
  return [
    company.domain ? `domain:${normalizeKey(company.domain)}` : '',
    company.linkedin_url ? `linkedin:${normalizeKey(company.linkedin_url)}` : '',
    company.name ? `name:${normalizeKey(company.name)}` : '',
  ].filter(Boolean);
}

function existingCompanyKeys(company: ExistingCompany): string[] {
  return [
    company.domain ? `domain:${normalizeKey(company.domain)}` : '',
    company.company_website ? `domain:${normalizeKey(company.company_website)}` : '',
    company.linkedin_url ? `linkedin:${normalizeKey(company.linkedin_url)}` : '',
    company.company_name ? `name:${normalizeKey(company.company_name)}` : '',
  ].filter(Boolean);
}

function contactKey(person: DiscoveredPerson): string {
  return (
    (person.linkedin_url && `linkedin:${normalizeKey(person.linkedin_url)}`) ||
    (person.email && `email:${normalizeKey(person.email)}`) ||
    `name_company:${normalizeKey(person.full_name)}:${normalizeKey(person.company_name)}`
  );
}

function existingContactKeys(contact: ExistingContact): string[] {
  const fullName =
    contact.full_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(' ') ||
    null;
  return [
    contact.linkedin_url ? `linkedin:${normalizeKey(contact.linkedin_url)}` : '',
    contact.email ? `email:${normalizeKey(contact.email)}` : '',
    fullName && contact.company_name
      ? `name_company:${normalizeKey(fullName)}:${normalizeKey(contact.company_name)}`
      : '',
  ].filter(Boolean);
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const admin = createAdminClient();
  const { error } = await admin
    .from('data_acquisition_jobs')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) throw new Error(error.message);
}

function rawUploadFromPerson(userId: string, batchId: string, person: DiscoveredPerson, jobId: string) {
  const rawData = {
    full_name: person.full_name,
    first_name: person.first_name,
    last_name: person.last_name,
    company_name: person.company_name,
    company_domain: person.company_domain || '',
    company_linkedin_url: person.company_linkedin_url || '',
    job_title: person.job_title || '',
    email: person.email || '',
    linkedin_url: person.linkedin_url || '',
    location: person.location || '',
    source: 'arcova_data_acquisition',
    data_acquisition_job_id: jobId,
    apollo_person_raw: person.raw,
  };

  return {
    user_id: userId,
    batch_id: batchId,
    raw_data: rawData,
    full_name: person.full_name,
    email: person.email,
    linkedin_url: person.linkedin_url,
    company_name: person.company_name,
    status: 'enriching',
  };
}

function getCompanyContext(job: DataAcquisitionJob): CompanyContext | null {
  const company = job.metadata?.company;
  if (!company || typeof company !== 'object') return null;
  const record = company as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  return {
    id,
    company_name: typeof record.company_name === 'string' ? record.company_name : null,
    domain: typeof record.domain === 'string' ? record.domain : null,
    company_website: typeof record.company_website === 'string' ? record.company_website : null,
    linkedin_url: typeof record.linkedin_url === 'string' ? record.linkedin_url : null,
    matched_icp_id: typeof record.matched_icp_id === 'string' ? record.matched_icp_id : null,
  };
}

function discoveredCompanyFromContext(company: CompanyContext): DiscoveredCompany {
  const domain = normalizeKey(company.domain || company.company_website);
  const name = company.company_name || domain || 'Selected company';

  return {
    source: 'apollo',
    source_id: null,
    name,
    domain: domain || null,
    linkedin_url: company.linkedin_url || null,
    employee_count: null,
    raw: {
      name,
      primary_domain: domain || null,
      website_url: company.company_website || company.domain || null,
      linkedin_url: company.linkedin_url || null,
    },
  };
}

export async function runDataAcquisitionJob(jobId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: jobData, error: jobError } = await admin
    .from('data_acquisition_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !jobData) {
    throw new Error(jobError?.message || `Data acquisition job ${jobId} not found`);
  }

  const job = jobData as DataAcquisitionJob;
  if (!job.upload_batch_id) {
    throw new Error(`Data acquisition job ${jobId} is missing upload_batch_id`);
  }
  if (!['queued', 'failed'].includes(job.status)) return;

  try {
    await updateJob(job.id, { status: 'discovering', started_at: new Date().toISOString(), error: null });

    const [{ data: icpData, error: icpError }, { data: personaData, error: personaError }] = await Promise.all([
      admin
        .from('icps')
        .select(
          'id, name, company_type, platform_category, therapeutic_areas, modalities, development_stages, company_sizes, funding_stages, target_customers, buyer_types',
        )
        .eq('user_id', job.user_id)
        .eq('id', job.icp_id)
        .maybeSingle(),
      admin
        .from('personas')
        .select('id, name, functions, seniority_levels, job_titles')
        .eq('user_id', job.user_id)
        .eq('icp_id', job.icp_id),
    ]);

    if (icpError || !icpData) throw new Error(icpError?.message || 'ICP not found');
    if (personaError) throw new Error(personaError.message);

    const icp = icpData as AcquisitionIcp;
    const personas = (personaData || []) as AcquisitionPersona[];

    if (job.request_type === 'contacts_at_company') {
      const companyContext = getCompanyContext(job);
      if (!companyContext) {
        throw new Error('contacts_at_company job is missing company context');
      }

      const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
      const targetContactCount = Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
      const company = discoveredCompanyFromContext(companyContext);
      const people = await discoverApolloPeopleForCompanies({
        companies: [company],
        recipe: peopleRecipe,
        contactsPerCompany: targetContactCount,
        onSearchResult: async (count) => {
          if (count <= 0) return;
          await recordDataAcquisitionUsageEvent(admin, {
            jobId: job.id,
            userId: job.user_id,
            eventType: 'apollo_people_search_result',
            provider: 'apollo',
            quantity: count,
            metadata: { company: company.name, domain: company.domain, companyId: companyContext.id },
          });
        },
      });

      const { data: existingContacts } = await admin
        .from('contacts')
        .select('full_name, first_name, last_name, email, linkedin_url, company_name, company_domain')
        .eq('user_id', job.user_id);
      const existingContactKeySet = new Set(
        ((existingContacts || []) as ExistingContact[]).flatMap(existingContactKeys),
      );

      const uniquePeople: DiscoveredPerson[] = [];
      const seenContactKeys = new Set<string>();
      for (const person of people) {
        const key = contactKey(person);
        if (existingContactKeySet.has(key) || seenContactKeys.has(key)) {
          await recordDataAcquisitionUsageEvent(admin, {
            jobId: job.id,
            userId: job.user_id,
            eventType: 'duplicate_contact_skipped',
            provider: 'apollo',
            quantity: 1,
            metadata: { person: person.full_name, company: person.company_name, companyId: companyContext.id },
          });
          continue;
        }
        seenContactKeys.add(key);
        uniquePeople.push(person);
        if (uniquePeople.length >= targetContactCount) break;
      }

      await updateJob(job.id, { status: 'importing' });
      await ingestPeopleAndRunImportPipeline(admin, job, uniquePeople, {
        companyId: companyContext.id,
      });
      return;
    }

    if (job.request_type === 'better_contacts' || job.request_type === 'more_contacts_at_accounts') {
      const targetContactCount = Math.max(1, job.target_contact_count || DEFAULT_CONTACTS_PER_COMPANY);
      const maxAccounts = Math.min(100, Math.max(1, Math.ceil(targetContactCount / DEFAULT_CONTACTS_PER_COMPANY)));
      const prioritizedRows = await loadPrioritizedCompaniesForIcpAccounts(
        admin,
        job.user_id,
        job.icp_id,
        job.request_type,
        500,
      );
      const accountCompanies: DiscoveredCompany[] = [];
      for (const row of prioritizedRows) {
        const discovered = discoveredCompanyFromDbRow(row);
        if (discovered) accountCompanies.push(discovered);
        if (accountCompanies.length >= maxAccounts) break;
      }

      if (accountCompanies.length === 0) {
        throw new Error(
          'No ICP-matched accounts with a usable domain for Apollo search. Add or enrich company domains first.',
        );
      }

      const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
      const contactsPerCompany = Math.max(1, Math.ceil(targetContactCount / accountCompanies.length));

      const people = await discoverApolloPeopleForCompanies({
        companies: accountCompanies,
        recipe: peopleRecipe,
        contactsPerCompany,
        onSearchResult: async (count, company) => {
          if (count <= 0) return;
          await recordDataAcquisitionUsageEvent(admin, {
            jobId: job.id,
            userId: job.user_id,
            eventType: 'apollo_people_search_result',
            provider: 'apollo',
            quantity: count,
            metadata: { company: company.name, domain: company.domain, requestType: job.request_type },
          });
        },
      });

      const { data: existingContactsIcp } = await admin
        .from('contacts')
        .select('full_name, first_name, last_name, email, linkedin_url, company_name, company_domain')
        .eq('user_id', job.user_id);
      const existingContactKeySetIcp = new Set(
        ((existingContactsIcp || []) as ExistingContact[]).flatMap(existingContactKeys),
      );

      const uniquePeopleIcp: DiscoveredPerson[] = [];
      const seenContactKeysIcp = new Set<string>();
      for (const person of people) {
        const key = contactKey(person);
        if (existingContactKeySetIcp.has(key) || seenContactKeysIcp.has(key)) {
          await recordDataAcquisitionUsageEvent(admin, {
            jobId: job.id,
            userId: job.user_id,
            eventType: 'duplicate_contact_skipped',
            provider: 'apollo',
            quantity: 1,
            metadata: { person: person.full_name, company: person.company_name },
          });
          continue;
        }
        seenContactKeysIcp.add(key);
        uniquePeopleIcp.push(person);
        if (uniquePeopleIcp.length >= targetContactCount) break;
      }

      await updateJob(job.id, { status: 'importing' });
      await ingestPeopleAndRunImportPipeline(admin, job, uniquePeopleIcp, {
        requestType: job.request_type,
      });
      return;
    }

    if (job.request_type !== 'expand_companies') {
      throw new Error(`Unsupported data acquisition request type: ${job.request_type}`);
    }

    const companyRecipes = buildApolloCompanySearchRecipes(icp, job.request_type);
    const targetCompanyCount = Math.max(1, job.target_company_count || 50);
    const maxScreenedCompanies = Math.max(
      targetCompanyCount,
      job.max_screened_companies || targetCompanyCount * 6,
    );

    const { data: existingCompanies } = await admin
      .from('companies')
      .select('company_name, domain, company_website, linkedin_url')
      .eq('user_id', job.user_id);
    const existingCompanyKeySet = new Set(
      ((existingCompanies || []) as ExistingCompany[]).flatMap(existingCompanyKeys),
    );

    const icpKeywords = icpKeywordCorpus(icp);

    const discovery = await discoverApolloCompanies({
      recipes: companyRecipes,
      targetCompanyCount: Math.min(maxScreenedCompanies, targetCompanyCount * 6),
      maxScreenedCompanies,
      onScreened: async (count, recipe) => {
        if (count <= 0) return;
        await recordDataAcquisitionUsageEvent(admin, {
          jobId: job.id,
          userId: job.user_id,
          eventType: 'apollo_company_search_result',
          provider: 'apollo',
          quantity: count,
          metadata: { recipe: recipe.name },
        });
        await recordDataAcquisitionUsageEvent(admin, {
          jobId: job.id,
          userId: job.user_id,
          eventType: 'llm_fit_screen',
          provider: 'arcova',
          quantity: count,
          metadata: { recipe: recipe.name },
        });
      },
    });

    const qualifiedCompanies: DiscoveredCompany[] = [];
    for (const company of discovery.companies) {
      const isDuplicate = companyKeys(company).some((key) => existingCompanyKeySet.has(key));
      if (isDuplicate) {
        await recordDataAcquisitionUsageEvent(admin, {
          jobId: job.id,
          userId: job.user_id,
          eventType: 'duplicate_company_skipped',
          provider: 'apollo',
          quantity: 1,
          metadata: { company: company.name, domain: company.domain },
        });
        continue;
      }

      if (!apolloOrganizationMatchesIcpKeywords(company.raw, icpKeywords)) {
        await recordDataAcquisitionUsageEvent(admin, {
          jobId: job.id,
          userId: job.user_id,
          eventType: 'low_fit_company_rejected',
          provider: 'arcova',
          quantity: 1,
          metadata: { company: company.name, domain: company.domain },
        });
        continue;
      }

      qualifiedCompanies.push(company);
      await recordDataAcquisitionUsageEvent(admin, {
        jobId: job.id,
        userId: job.user_id,
        eventType: 'qualified_company',
        provider: 'apollo',
        quantity: 1,
        metadata: { company: company.name, domain: company.domain },
      });

      if (qualifiedCompanies.length >= targetCompanyCount) break;
    }

    if (qualifiedCompanies.length === 0) {
      throw new Error(
        'No new companies passed deduplication and ICP keyword screening. Widen the ICP or try again later.',
      );
    }

    await updateJob(job.id, { status: 'importing' });

    const peopleRecipe = buildApolloPeopleSearchRecipe(personas);
    const targetContactCount =
      job.target_contact_count || qualifiedCompanies.length * DEFAULT_CONTACTS_PER_COMPANY;
    const contactsPerCompany = Math.max(
      1,
      Math.ceil(targetContactCount / Math.max(1, qualifiedCompanies.length)),
    );

    const people = await discoverApolloPeopleForCompanies({
      companies: qualifiedCompanies,
      recipe: peopleRecipe,
      contactsPerCompany,
      onSearchResult: async (count, company) => {
        if (count <= 0) return;
        await recordDataAcquisitionUsageEvent(admin, {
          jobId: job.id,
          userId: job.user_id,
          eventType: 'apollo_people_search_result',
          provider: 'apollo',
          quantity: count,
          metadata: { company: company.name, domain: company.domain },
        });
      },
    });

    const { data: existingContacts } = await admin
      .from('contacts')
      .select('full_name, first_name, last_name, email, linkedin_url, company_name, company_domain')
      .eq('user_id', job.user_id);
    const existingContactKeySet = new Set(
      ((existingContacts || []) as ExistingContact[]).flatMap(existingContactKeys),
    );

    const uniquePeople: DiscoveredPerson[] = [];
    const seenContactKeys = new Set<string>();
    for (const person of people) {
      const key = contactKey(person);
      if (existingContactKeySet.has(key) || seenContactKeys.has(key)) {
        await recordDataAcquisitionUsageEvent(admin, {
          jobId: job.id,
          userId: job.user_id,
          eventType: 'duplicate_contact_skipped',
          provider: 'apollo',
          quantity: 1,
          metadata: { person: person.full_name, company: person.company_name },
        });
        continue;
      }
      seenContactKeys.add(key);
      uniquePeople.push(person);
      if (uniquePeople.length >= targetContactCount) break;
    }

    await ingestPeopleAndRunImportPipeline(admin, job, uniquePeople, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown data acquisition failure';
    await updateJob(job.id, { status: 'failed', error: message, completed_at: new Date().toISOString() });
    if (job.upload_batch_id) {
      await admin
        .from('upload_batches')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', job.upload_batch_id);
    }
    throw error;
  }
}
