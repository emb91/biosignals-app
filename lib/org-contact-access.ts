import { createAdminClient } from '@/lib/supabase-admin';
import type { ContactEmailRow } from '@/lib/contact-emails';
import type { ContactPhoneRow } from '@/lib/contact-phones';

type AdminClient = ReturnType<typeof createAdminClient>;

export type OrgContactAccess = {
  contactId: string;
  personId: string;
  ownerUserId: string;
  companyId: string | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  memberIds: string[];
};

type ContactLinkRow = {
  id: string;
  user_id: string;
  person_id: string | null;
  company_id: string | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

async function orgMemberIds(admin: AdminClient, orgId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId);
  if (error) throw new Error(`org member lookup failed: ${error.message}`);
  return dedupe((data ?? []).map((row) => row.user_id as string).filter(Boolean));
}

function chooseRepresentativeLink(links: ContactLinkRow[], userId: string): ContactLinkRow | null {
  const own = links.find((link) => link.user_id === userId);
  if (own) return own;
  return [...links].sort((a, b) => {
    const aUpdated = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
    const bUpdated = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;
    return a.id.localeCompare(b.id);
  })[0] ?? null;
}

export async function resolveOrgContactAccess(params: {
  id: string;
  orgId: string;
  userId: string;
  admin?: AdminClient;
}): Promise<OrgContactAccess | null> {
  const admin = params.admin ?? createAdminClient();
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

  const { data: links, error: linksError } = await admin
    .from('user_contacts')
    .select('id, user_id, person_id, company_id, source, created_at, updated_at')
    .in('user_id', memberIds)
    .eq('person_id', requestedPersonId)
    .is('archived_at', null);
  if (linksError) throw new Error(`org contact links lookup failed: ${linksError.message}`);

  const link = chooseRepresentativeLink((links ?? []) as ContactLinkRow[], params.userId);
  if (!link) return null;

  return {
    contactId: link.id,
    personId: requestedPersonId,
    ownerUserId: link.user_id,
    companyId: (state.company_id as string | null) ?? link.company_id ?? null,
    source: (state.source as string | null) ?? link.source ?? null,
    createdAt: (state.added_at as string | null) ?? link.created_at ?? null,
    updatedAt: (state.updated_at as string | null) ?? link.updated_at ?? null,
    memberIds,
  };
}

export async function listOrgContactAccesses(params: {
  orgId: string;
  userId: string;
  admin?: AdminClient;
}): Promise<OrgContactAccess[]> {
  const admin = params.admin ?? createAdminClient();
  const memberIds = await orgMemberIds(admin, params.orgId);
  if (memberIds.length === 0) return [];

  const { data: states, error: stateError } = await admin
    .from('org_contact_state')
    .select('person_id, company_id, source, added_at, updated_at')
    .eq('org_id', params.orgId)
    .is('archived_at', null);
  if (stateError) throw new Error(`org contact state lookup failed: ${stateError.message}`);

  const personIds = dedupe(
    (states ?? [])
      .map((row) => row.person_id as string | null)
      .filter((value): value is string => Boolean(value)),
  );
  if (personIds.length === 0) return [];

  const { data: links, error: linksError } = await admin
    .from('user_contacts')
    .select('id, user_id, person_id, company_id, source, created_at, updated_at')
    .in('user_id', memberIds)
    .in('person_id', personIds)
    .is('archived_at', null);
  if (linksError) throw new Error(`org contact links lookup failed: ${linksError.message}`);

  const linksByPersonId = new Map<string, ContactLinkRow[]>();
  for (const link of (links ?? []) as ContactLinkRow[]) {
    if (!link.person_id) continue;
    linksByPersonId.set(link.person_id, [...(linksByPersonId.get(link.person_id) ?? []), link]);
  }

  return (states ?? [])
    .map((state): OrgContactAccess | null => {
      const personId = state.person_id as string | null;
      if (!personId) return null;
      const link = chooseRepresentativeLink(linksByPersonId.get(personId) ?? [], params.userId);
      if (!link) return null;
      return {
        contactId: link.id,
        personId,
        ownerUserId: link.user_id,
        companyId: (state.company_id as string | null) ?? link.company_id ?? null,
        source: (state.source as string | null) ?? link.source ?? null,
        createdAt: (state.added_at as string | null) ?? link.created_at ?? null,
        updatedAt: (state.updated_at as string | null) ?? link.updated_at ?? null,
        memberIds,
      };
    })
    .filter((access): access is OrgContactAccess => Boolean(access));
}

export async function fetchOrgContactEmails(
  access: Pick<OrgContactAccess, 'contactId'>,
  admin: AdminClient = createAdminClient(),
): Promise<ContactEmailRow[]> {
  const { data, error } = await admin
    .from('contact_emails')
    .select(
      'id, contact_id, user_id, email, category, label, source_provider, apollo_email_status, email_deliverability, email_deliverability_provider, email_deliverability_checked_at, email_deliverability_metadata, created_at, updated_at',
    )
    .eq('contact_id', access.contactId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`contact emails lookup failed: ${error.message}`);
  return (data ?? []) as ContactEmailRow[];
}

export async function fetchOrgContactPhones(
  access: Pick<OrgContactAccess, 'contactId'>,
  admin: AdminClient = createAdminClient(),
): Promise<ContactPhoneRow[]> {
  const { data, error } = await admin
    .from('contact_phones')
    .select('*')
    .eq('contact_id', access.contactId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`contact phones lookup failed: ${error.message}`);
  return (data ?? []) as ContactPhoneRow[];
}
