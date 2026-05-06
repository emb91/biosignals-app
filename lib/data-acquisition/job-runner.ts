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
  buildApolloCompanySearchRecipes,
  buildApolloPeopleSearchRecipe,
  type AcquisitionIcp,
  type AcquisitionPersona,
} from '@/lib/data-acquisition/search-spec';

type DataAcquisitionJob = {
  id: string;
  user_id: string;
  icp_id: string;
  upload_batch_id: string | null;
  request_type: 'expand_companies' | 'better_contacts' | 'more_contacts_at_accounts';
  target_company_count: number;
  target_contact_count: number | null;
  max_screened_companies: number | null;
  max_contact_enrichments: number | null;
  status: string;
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
  if (job.request_type !== 'expand_companies') {
    await updateJob(job.id, {
      status: 'queued',
      error: `${job.request_type} acquisition is queued but not implemented in the Apollo-first runner yet.`,
    });
    return;
  }

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

    const discovery = await discoverApolloCompanies({
      recipes: companyRecipes,
      targetCompanyCount: targetCompanyCount * 2,
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
          eventType: 'duplicate_contact_skipped',
          provider: 'apollo',
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
          eventType: 'duplicate_company_skipped',
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

    const rawRows = uniquePeople.map((person) => rawUploadFromPerson(job.user_id, job.upload_batch_id!, person, job.id));
    const { data: insertedRows, error: insertError } = rawRows.length > 0
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
        metadata: { batchId: job.upload_batch_id },
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
        batchId: job.upload_batch_id,
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
          metadata: { batchId: job.upload_batch_id },
        });
      }
    }

    await updateJob(job.id, { status: 'complete', completed_at: new Date().toISOString() });
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
