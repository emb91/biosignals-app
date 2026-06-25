import { NextResponse } from 'next/server';
import {
  looksLikeEmail,
  normalizeUserEmailDeliverability,
  syncEmailDeliverabilityOverrides,
  syncUserAddedContactEmails,
  syncPrimaryEmailAsUserRowIfNeeded,
  type EmailDeliverabilityOverride,
} from '@/lib/contact-emails';
import {
  looksLikePhone,
  syncUserAddedContactPhones,
} from '@/lib/contact-phones';
import { effectiveReadiness } from '@/lib/lead-action';
import { getOrgContext } from '@/lib/org-context';
import {
  accountReadinessByCompanyIdForOrg,
  contactReadinessByContactIdForOrg,
} from '@/lib/org-readiness-snapshots';
import { createAdminClient } from '@/lib/supabase-admin';
import {
  fetchOrgContactEmails,
  fetchOrgContactPhones,
  resolveOrgContactAccess,
} from '@/lib/org-contact-access';

type LeadUpdateBody = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  headline?: string;
  email?: string;
  linkedin_url?: string;
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  location?: string;
  city?: string;
  country?: string;
  /** Secondary addresses with category `user` (primary `email` is separate). */
  user_secondary_emails?: unknown;
  /** Phones with category `user` — manual entry block on the contact panel. */
  user_phones?: unknown;
  /** Manual deliverability overrides keyed by email address. */
  email_deliverability_overrides?: unknown;
};

const PERSON_DETAIL_SELECT =
  'id, full_name, first_name, last_name, job_title, job_title_standardised, seniority_level, business_area, headline, email, email_status, email_deliverability, linkedin_url, profile_photo_url, profile_photo_cached, company_name, company_domain, company_linkedin_url, location, city, country, contact_bio, resolved_current_company_name, resolved_current_company_domain, resolved_current_job_title, resolved_employment_history, enrichment_refresh_status, enrichment_refresh_finished_at, profile_enrichment_status, profile_enrichment_completed_at, linkedin_resolution_status, created_at, updated_at, company_id';

const COMPANY_DETAIL_SELECT =
  'id, company_name, domain, website, linkedin_url, description, bio_summary, tagline, logo_url, follower_count, industry, sub_industry, employee_count, employee_range, company_size_bucket, founded_year, headquarters_city, headquarters_state, headquarters_country, specialties, products_services, services, technologies, company_type, company_type_display, platform_category, funding_stage, funding_status_label, total_funding_usd, latest_funding_date, funding_data_source, funding_resolution_summary, therapeutic_areas, modalities, development_stages, clinical_stage, last_enriched_at';

type OrgContactLinkRow = {
  id: string;
  user_id: string;
  person_id: string;
  company_id: string | null;
  source: string | null;
  contact_fit_score: number | null;
  readiness_score: number | null;
  priority_score: number | null;
  contact_panel_summary: string | null;
  contact_fit_summary: string | null;
  fit_score: number | null;
  overall_fit_score: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

function finiteScoreNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priorityFromScores(input: {
  companyFit: unknown;
  contactFit: unknown;
  companyReadiness: unknown;
  contactReadiness: unknown;
}): number | null {
  const companyFit = finiteScoreNumber(input.companyFit);
  const contactFit = finiteScoreNumber(input.contactFit);
  const readiness = effectiveReadiness(
    finiteScoreNumber(input.companyReadiness),
    finiteScoreNumber(input.contactReadiness),
  ) ?? 0;
  if (companyFit == null || contactFit == null) return null;
  return Math.max(0, Math.min(1, companyFit * contactFit * (0.5 + 0.5 * readiness)));
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.details === 'string' && o.details) return o.details;
    if (typeof o.hint === 'string' && o.hint) return o.hint;
  }
  return 'Internal server error';
}

const splitFullName = (fullName: string | null): { first: string | null; last: string | null } => {
  if (!fullName) return { first: null, last: null };

  const tokens = fullName.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first: null, last: null };
  if (tokens.length === 1) return { first: tokens[0], last: null };

  return {
    first: tokens[0],
    last: tokens.slice(1).join(' '),
  };
};

const CONTACT_OVERRIDE_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'job_title',
  'headline',
  'email',
  'linkedin_url',
  'company_name',
  'company_domain',
  'company_linkedin_url',
  'location',
  'city',
  'country',
] as const;

type ContactOverrideField = (typeof CONTACT_OVERRIDE_FIELDS)[number];
type ContactOverrides = Partial<Record<ContactOverrideField, string>>;

function applyContactOverrides<T extends Record<string, unknown>>(row: T, overrides: Record<string, unknown> | null): T {
  if (!overrides) return row;
  const next: Record<string, unknown> = { ...row };
  for (const key of CONTACT_OVERRIDE_FIELDS) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim()) {
      next[key] = value;
    }
  }
  return next as T;
}

function chooseRepresentativeLink(links: OrgContactLinkRow[], memberIds: string[]): OrgContactLinkRow | null {
  const memberRank = new Map(memberIds.map((userId, index) => [userId, index]));
  return [...links].sort((a, b) => {
    const rankDiff = (memberRank.get(a.user_id) ?? Number.MAX_SAFE_INTEGER) -
      (memberRank.get(b.user_id) ?? Number.MAX_SAFE_INTEGER);
    if (rankDiff !== 0) return rankDiff;
    const aCreated = Date.parse(a.created_at ?? '') || Number.MAX_SAFE_INTEGER;
    const bCreated = Date.parse(b.created_at ?? '') || Number.MAX_SAFE_INTEGER;
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.id.localeCompare(b.id);
  })[0] ?? null;
}

async function orgMemberIds(admin: ReturnType<typeof createAdminClient>, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .order('user_id', { ascending: true });
  if (error) throw new Error(`org member lookup failed: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.user_id as string).filter(Boolean))];
}

async function resolveOrgContactDetail(params: {
  id: string;
  orgId: string;
  userId: string;
}): Promise<Record<string, unknown> | null> {
  const admin = createAdminClient();
  const memberIds = await orgMemberIds(admin, params.orgId);
  if (memberIds.length === 0) return null;

  const { data: requestedLink, error: requestedLinkError } = await admin
    .from('user_contacts')
    .select('id, user_id, person_id')
    .eq('id', params.id)
    .maybeSingle();
  if (requestedLinkError) throw new Error(`contact link lookup failed: ${requestedLinkError.message}`);

  if (requestedLink && !memberIds.includes(requestedLink.user_id as string)) return null;
  const requestedPersonId = requestedLink ? (requestedLink.person_id as string | null) : params.id;
  if (!requestedPersonId) return null;

  const { data: state, error: stateError } = await admin
    .from('org_contact_state')
    .select('person_id, company_id, source, added_at, updated_at')
    .eq('org_id', params.orgId)
    .eq('person_id', requestedPersonId)
    .is('archived_at', null)
    .maybeSingle();
  if (stateError) throw new Error(`org contact state lookup failed: ${stateError.message}`);
  if (!state?.person_id) return null;

  const [personResult, linksResult] = await Promise.all([
    admin.from('people').select(PERSON_DETAIL_SELECT).eq('id', requestedPersonId).maybeSingle(),
    admin
      .from('user_contacts')
      .select(
        'id, user_id, person_id, company_id, source, contact_fit_score, readiness_score, priority_score, contact_panel_summary, contact_fit_summary, fit_score, overall_fit_score, created_at, updated_at',
      )
      .in('user_id', memberIds)
      .eq('person_id', requestedPersonId)
      .is('archived_at', null),
  ]);

  if (personResult.error) throw new Error(`person lookup failed: ${personResult.error.message}`);
  if (linksResult.error) throw new Error(`org contact links lookup failed: ${linksResult.error.message}`);
  if (!personResult.data) return null;

  const link = chooseRepresentativeLink((linksResult.data ?? []) as OrgContactLinkRow[], memberIds);
  if (!link) return null;

  const companyId =
    (state.company_id as string | null) ??
    link.company_id ??
    ((personResult.data as Record<string, unknown>).company_id as string | null) ??
    null;
  let company: Record<string, unknown> | null = null;
  if (companyId) {
    const { data: companyRow } = await admin
      .from('companies')
      .select(COMPANY_DETAIL_SELECT)
      .eq('id', companyId)
      .maybeSingle();
    company = (companyRow as Record<string, unknown> | null) ?? null;
  }

  return {
    ...(personResult.data as Record<string, unknown>),
    id: link.id,
    person_id: requestedPersonId,
    user_id: params.userId,
    owner_user_id: link.user_id,
    company_id: companyId,
    source: (state.source as string | null) ?? link.source ?? (personResult.data as Record<string, unknown>).source ?? null,
    created_at: (state.added_at as string | null) ?? link.created_at ?? (personResult.data as Record<string, unknown>).created_at ?? null,
    updated_at: (state.updated_at as string | null) ?? link.updated_at ?? (personResult.data as Record<string, unknown>).updated_at ?? null,
    contact_fit_score: link.contact_fit_score ?? null,
    readiness_score: link.readiness_score ?? null,
    priority_score: link.priority_score ?? null,
    contact_panel_summary: link.contact_panel_summary ?? (personResult.data as Record<string, unknown>).contact_panel_summary ?? null,
    contact_fit_summary: link.contact_fit_summary ?? (personResult.data as Record<string, unknown>).contact_fit_summary ?? null,
    fit_score: link.fit_score ?? (personResult.data as Record<string, unknown>).fit_score ?? null,
    overall_fit_score: link.overall_fit_score ?? (personResult.data as Record<string, unknown>).overall_fit_score ?? null,
    companies: company,
  };
}

function buildContactOverridePatch(input: Record<ContactOverrideField, string | null>): {
  set: ContactOverrides;
  clear: ContactOverrideField[];
} {
  const set: ContactOverrides = {};
  const clear: ContactOverrideField[] = [];
  for (const key of CONTACT_OVERRIDE_FIELDS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      set[key] = value.trim();
    } else {
      clear.push(key);
    }
  }
  return { set, clear };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await getOrgContext();

    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await resolveOrgContactDetail({
      id,
      orgId: ctx.orgId,
      userId: ctx.user.id,
    });

    if (!data) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    try {
      const contactRow = data as Record<string, unknown>;
      const companyId = typeof contactRow.company_id === 'string' ? contactRow.company_id : null;
      const contactId = typeof contactRow.id === 'string' ? contactRow.id : id;
      const personId = typeof contactRow.person_id === 'string' ? contactRow.person_id : null;
      const access = personId
        ? {
            contactId,
            personId,
          }
        : null;
      const admin = createAdminClient();

      const [
        overrideResult,
        contactEmails,
        contactPhones,
        accountResult,
        accountReadinessByCompany,
        contactReadinessByContact,
      ] = await Promise.all([
        personId
          ? ctx.supabase
              .from('org_contact_overrides')
              .select('overrides')
              .eq('org_id', ctx.orgId)
              .eq('person_id', personId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        access ? fetchOrgContactEmails(access, admin) : Promise.resolve([]),
        access ? fetchOrgContactPhones(access, admin) : Promise.resolve([]),
        companyId
          ? ctx.supabase
              .from('org_companies')
              .select('company_fit_score, readiness_score')
              .eq('org_id', ctx.orgId)
              .eq('company_id', companyId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        companyId
          ? accountReadinessByCompanyIdForOrg({
              orgId: ctx.orgId,
              userId: ctx.user.id,
              companyIds: [companyId],
            })
          : Promise.resolve(new Map()),
        contactReadinessByContactIdForOrg({
          orgId: ctx.orgId,
          userId: ctx.user.id,
          contactIds: [contactId],
        }),
      ]);

      const overrides =
        overrideResult && typeof overrideResult === 'object' && 'data' in overrideResult
          ? ((overrideResult as { data?: { overrides?: Record<string, unknown> | null } | null }).data?.overrides ?? null)
          : null;
      const accountRow =
        accountResult && typeof accountResult === 'object' && 'data' in accountResult
          ? ((accountResult as { data?: Record<string, unknown> | null }).data ?? null)
          : null;
      const companyFit = finiteScoreNumber(accountRow?.company_fit_score);
      const teamAccountReadiness = companyId ? accountReadinessByCompany.get(companyId)?.score ?? null : null;
      const companyReadiness = teamAccountReadiness ?? finiteScoreNumber(accountRow?.readiness_score);
      const contactReadiness = contactReadinessByContact.get(contactId)?.score ?? null;
      const priority = priorityFromScores({
        companyFit,
        contactFit: contactRow.contact_fit_score,
        companyReadiness,
        contactReadiness,
      });

      return NextResponse.json({
        data: {
          ...applyContactOverrides(contactRow, overrides),
          company_fit_score: companyFit,
          company_readiness_score: companyReadiness,
          contact_readiness_score: contactReadiness,
          priority_score: priority,
          intrinsic_priority_score: priority,
          contact_emails: contactEmails,
          contact_phones: contactPhones,
        },
      });
    } catch {
      return NextResponse.json({
        data: { ...data, contact_emails: [], contact_phones: [] },
      });
    }
  } catch (error) {
    console.error('Error in contacts/[id] GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await getOrgContext();

    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as LeadUpdateBody;
    const fullName = normalizeString(body.full_name);
    const firstName = normalizeString(body.first_name);
    const lastName = normalizeString(body.last_name);
    const primaryEmailNorm = normalizeString(body.email)?.toLowerCase() ?? '';

    const userSecondaryEmails = Array.isArray(body.user_secondary_emails)
      ? (body.user_secondary_emails.filter((item) => typeof item === 'string') as string[])
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.toLowerCase() !== primaryEmailNorm)
      : [];

    const userPhones = Array.isArray(body.user_phones)
      ? (body.user_phones.filter((item) => typeof item === 'string') as string[])
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

    const primaryEmailRaw = normalizeString(body.email);
    if (primaryEmailRaw && !looksLikeEmail(primaryEmailRaw)) {
      return NextResponse.json(
        { error: 'Enter a valid email address (for example name@company.com).' },
        { status: 400 },
      );
    }

    for (const s of userSecondaryEmails) {
      if (!looksLikeEmail(s)) {
        return NextResponse.json(
          { error: 'Each additional email must look like a valid address.' },
          { status: 400 },
        );
      }
    }

    for (const p of userPhones) {
      if (!looksLikePhone(p)) {
        return NextResponse.json(
          { error: 'Each phone must look like a valid number.' },
          { status: 400 },
        );
      }
    }

    const derivedNames = !firstName && !lastName ? splitFullName(fullName) : { first: firstName, last: lastName };

    const updatePayload: Record<ContactOverrideField, string | null> = {
      full_name: fullName,
      first_name: derivedNames.first,
      last_name: derivedNames.last,
      job_title: normalizeString(body.job_title),
      headline: normalizeString(body.headline),
      email: normalizeString(body.email),
      linkedin_url: normalizeString(body.linkedin_url),
      company_name: normalizeString(body.company_name),
      company_domain: normalizeString(body.company_domain)?.toLowerCase() || null,
      company_linkedin_url: normalizeString(body.company_linkedin_url),
      location: normalizeString(body.location),
      city: normalizeString(body.city),
      country: normalizeString(body.country),
    };

    const now = new Date().toISOString();
    const admin = createAdminClient();
    const access = await resolveOrgContactAccess({
      id,
      orgId: ctx.orgId,
      userId: ctx.user.id,
      admin,
    });
    if (!access) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { data: existingOverride, error: existingOverrideError } = await ctx.supabase
      .from('org_contact_overrides')
      .select('overrides')
      .eq('org_id', ctx.orgId)
      .eq('person_id', access.personId)
      .maybeSingle();

    if (existingOverrideError) {
      return NextResponse.json({ error: existingOverrideError.message }, { status: 500 });
    }

    const { set, clear } = buildContactOverridePatch(updatePayload);
    const nextOverrides: Record<string, unknown> = {
      ...(((existingOverride as { overrides: Record<string, unknown> | null } | null)?.overrides ?? {}) as Record<string, unknown>),
      ...set,
    };
    for (const key of clear) delete nextOverrides[key];

    const { error: stateError } = await ctx.supabase
      .from('org_contact_state')
      .upsert({
        org_id: ctx.orgId,
        person_id: access.personId,
        company_id: access.companyId,
        source: access.source,
        added_at: access.createdAt ?? now,
        updated_at: now,
        created_by: ctx.user.id,
      }, { onConflict: 'org_id,person_id' });

    if (stateError) {
      return NextResponse.json({ error: stateError.message }, { status: 500 });
    }

    const { error: overrideError } = await ctx.supabase
      .from('org_contact_overrides')
      .upsert({
        org_id: ctx.orgId,
        person_id: access.personId,
        overrides: nextOverrides,
        overridden_by: ctx.user.id,
        overridden_at: now,
      }, { onConflict: 'org_id,person_id' });

    if (overrideError) {
      return NextResponse.json({ error: overrideError.message }, { status: 500 });
    }

    try {
      await syncUserAddedContactEmails(admin, {
        contactId: access.contactId,
        userId: access.ownerUserId,
        additionalEmails: userSecondaryEmails,
      });
    } catch (emailErr) {
      console.error('syncUserAddedContactEmails failed:', emailErr);
      return NextResponse.json(
        { error: `Could not save additional emails: ${messageFromUnknown(emailErr)}` },
        { status: 500 },
      );
    }

    try {
      await syncUserAddedContactPhones(admin, {
        contactId: access.contactId,
        userId: access.ownerUserId,
        additionalPhones: userPhones,
      });
    } catch (phoneErr) {
      console.error('syncUserAddedContactPhones failed:', phoneErr);
      return NextResponse.json(
        { error: `Could not save phones: ${messageFromUnknown(phoneErr)}` },
        { status: 500 },
      );
    }

    try {
      await syncPrimaryEmailAsUserRowIfNeeded(admin, {
        contactId: access.contactId,
        userId: access.ownerUserId,
        primaryEmail: normalizeString(body.email),
      });
    } catch (syncErr) {
      console.error('syncPrimaryEmailAsUserRowIfNeeded failed:', syncErr);
      return NextResponse.json(
        { error: `Could not sync primary email: ${messageFromUnknown(syncErr)}` },
        { status: 500 },
      );
    }

    const emailDeliverabilityOverrides: EmailDeliverabilityOverride[] = [];
    if (Array.isArray(body.email_deliverability_overrides)) {
      for (const item of body.email_deliverability_overrides) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const email = normalizeString(row.email);
        if (!email || !looksLikeEmail(email)) continue;
        if (!('email_deliverability' in row)) continue;
        const deliverability =
          row.email_deliverability == null || row.email_deliverability === ''
            ? null
            : normalizeUserEmailDeliverability(row.email_deliverability);
        if (row.email_deliverability != null && row.email_deliverability !== '' && deliverability == null) {
          return NextResponse.json(
            { error: 'Each email status override must be a supported deliverability value.' },
            { status: 400 },
          );
        }
        emailDeliverabilityOverrides.push({ email, email_deliverability: deliverability });
      }
    }

    try {
      await syncEmailDeliverabilityOverrides(admin, {
        contactId: access.contactId,
        userId: access.ownerUserId,
        primaryEmail: normalizeString(body.email),
        overrides: emailDeliverabilityOverrides,
      });
    } catch (deliverabilityErr) {
      console.error('syncEmailDeliverabilityOverrides failed:', deliverabilityErr);
      return NextResponse.json(
        { error: `Could not save email status overrides: ${messageFromUnknown(deliverabilityErr)}` },
        { status: 500 },
      );
    }

    try {
      const [contactEmails, contactPhones] = await Promise.all([
        fetchOrgContactEmails(access, admin),
        fetchOrgContactPhones(access, admin),
      ]);
      return NextResponse.json({
        data: {
          id: access.contactId,
          ...applyContactOverrides(
            {
              ...updatePayload,
              updated_at: now,
              created_at: access.createdAt,
            },
            nextOverrides,
          ),
          contact_emails: contactEmails,
          contact_phones: contactPhones,
        },
      });
    } catch {
      return NextResponse.json({
        data: {
          id: access.contactId,
          ...applyContactOverrides(
            {
              ...updatePayload,
              updated_at: now,
              created_at: access.createdAt,
            },
            nextOverrides,
          ),
          contact_emails: [],
          contact_phones: [],
        },
      });
    }
  } catch (error) {
    console.error('Error in contacts/[id] PUT:', error);
    return NextResponse.json({ error: messageFromUnknown(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const ctx = await getOrgContext();

    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date().toISOString();
    const admin = createAdminClient();
    const access = await resolveOrgContactAccess({
      id,
      orgId: ctx.orgId,
      userId: ctx.user.id,
      admin,
    });
    if (!access) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { error: stateError } = await ctx.supabase
      .from('org_contact_state')
      .upsert({
        org_id: ctx.orgId,
        person_id: access.personId,
        company_id: access.companyId,
        source: access.source,
        archived_at: now,
        archived_by: ctx.user.id,
        archived_reason: 'user_archived',
        updated_at: now,
      }, { onConflict: 'org_id,person_id' });

    if (stateError) {
      return NextResponse.json({ error: stateError.message }, { status: 500 });
    }

    const { error } = await admin
      .from('contacts')
      .update({
        archived_at: now,
        archived_by: ctx.user.id,
        archived_reason: 'user_archived',
        updated_at: now,
      })
      .eq('user_id', access.ownerUserId)
      .eq('id', access.contactId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id, archived: true });
  } catch (error) {
    console.error('Error in contacts/[id] DELETE:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
