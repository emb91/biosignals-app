import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Supabase credentials are required');

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = crypto.randomUUID();
const password = `Launch-${crypto.randomUUID()}-9a`;
const createdUserIds = [];
const createdOrgIds = [];

try {
  const owner = await createUser(`launch-owner-${suffix}@example.com`);
  const administrator = await createUser(`launch-admin-${suffix}@example.com`);
  const member = await createUser(`launch-member-${suffix}@example.com`);
  const joiner = await createUser(`launch-joiner-${suffix}@example.com`);

  const orgId = await createOrg(`__tenancy_verification_${suffix}`);
  const soloOrgId = await createOrg(`__tenancy_joiner_${suffix}`);
  await insertMembership(orgId, owner.id, 'owner');
  await insertMembership(orgId, administrator.id, 'admin');
  await insertMembership(orgId, member.id, 'member');
  await insertMembership(soloOrgId, joiner.id, 'owner');

  const ownerClient = await signedIn(owner.email);
  const adminClient = await signedIn(administrator.email);
  const memberClient = await signedIn(member.email);

  const { data: company, error: companyError } = await ownerClient
    .from('user_company')
    .insert({ user_id: owner.id, org_id: orgId, company_name: 'Launch Verification Co' })
    .select('id, company_name')
    .single();
  if (companyError) throw companyError;

  const { data: sharedIcp, error: sharedError } = await ownerClient
    .from('icps')
    .insert({
      user_id: owner.id,
      org_id: orgId,
      scope: 'org',
      name: 'Shared Verification ICP',
      example_company_url: 'example.com',
    })
    .select('id')
    .single();
  if (sharedError) throw sharedError;

  const { data: persona, error: personaError } = await ownerClient
    .from('personas')
    .insert({
      user_id: owner.id,
      org_id: orgId,
      icp_id: sharedIcp.id,
      name: 'Shared Verification Persona',
    })
    .select('id')
    .single();
  if (personaError) throw personaError;

  await assertVisible(memberClient, 'user_company', company.id, 'member sees company profile');
  await assertVisible(memberClient, 'icps', sharedIcp.id, 'member sees shared ICP');
  await assertVisible(memberClient, 'personas', persona.id, 'member sees shared persona');

  const memberUpdate = await memberClient
    .from('user_company')
    .update({ company_name: 'Forbidden member edit' })
    .eq('id', company.id)
    .select('id');
  assert(!memberUpdate.error && memberUpdate.data.length === 0, 'member cannot edit company profile');

  const adminUpdate = await adminClient
    .from('user_company')
    .update({ company_name: 'Admin edit works' })
    .eq('id', company.id)
    .select('id');
  assert(!adminUpdate.error && adminUpdate.data.length === 1, 'admin can edit owner-created company profile');

  const { data: personalIcp, error: personalError } = await memberClient
    .from('icps')
    .insert({
      user_id: member.id,
      org_id: orgId,
      scope: 'personal',
      name: 'Private Member ICP',
      example_company_url: 'private.example.com',
    })
    .select('id')
    .single();
  if (personalError) throw personalError;

  const ownerPrivateRead = await ownerClient
    .from('icps')
    .select('id')
    .eq('id', personalIcp.id)
    .maybeSingle();
  assert(!ownerPrivateRead.data, 'owner cannot read a member personal ICP');

  await assertRole(orgId, owner.id, 'owner');
  await assertRole(orgId, administrator.id, 'admin');
  await rpc('transfer_org_ownership', {
    p_org_id: orgId,
    p_current_owner: owner.id,
    p_new_owner: administrator.id,
  });
  await assertRole(orgId, administrator.id, 'owner');
  await assertRole(orgId, owner.id, 'admin');
  await rpc('transfer_org_ownership', {
    p_org_id: orgId,
    p_current_owner: administrator.id,
    p_new_owner: owner.id,
  });

  await rpc('leave_org_member', { p_org_id: orgId, p_user_id: member.id });
  await assertNoMembership(member.id);
  await assertRowOwner('icps', personalIcp.id, owner.id, 'leaver personal ICP transferred to owner');

  const { data: invite, error: inviteError } = await admin
    .from('org_invites')
    .insert({
      org_id: orgId,
      email: joiner.email,
      role: 'member',
      token: crypto.randomUUID(),
      invited_by: owner.id,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  if (inviteError) throw inviteError;
  await rpc('accept_org_invite', { p_invite_id: invite.id, p_user_id: joiner.id });
  await assertRole(orgId, joiner.id, 'member');
  const oldOrg = await admin.from('organizations').select('archived_at').eq('id', soloOrgId).single();
  assert(Boolean(oldOrg.data?.archived_at), 'empty previous solo workspace archived on invite acceptance');

  await rpc('remove_org_member', {
    p_org_id: orgId,
    p_actor_id: owner.id,
    p_target_id: joiner.id,
  });
  await assertNoMembership(joiner.id);

  console.log('Organization tenancy verification passed.');
} finally {
  for (const orgId of createdOrgIds.reverse()) {
    await admin.from('organizations').delete().eq('id', orgId);
  }
  for (const userId of createdUserIds.reverse()) {
    await admin.auth.admin.deleteUser(userId);
  }
}

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error('User creation failed');
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function createOrg(name) {
  const { data, error } = await admin.from('organizations').insert({ name }).select('id').single();
  if (error) throw error;
  createdOrgIds.push(data.id);
  return data.id;
}

async function insertMembership(orgId, userId, role) {
  const { error } = await admin.from('org_members').insert({
    org_id: orgId,
    user_id: userId,
    role,
    joined_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function signedIn(email) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function rpc(name, values) {
  const { error } = await admin.rpc(name, values);
  if (error) throw new Error(`${name} failed: ${error.message}`);
}

async function assertVisible(client, table, id, message) {
  const { data, error } = await client.from(table).select('id').eq('id', id).single();
  assert(!error && data?.id === id, message);
}

async function assertRole(orgId, userId, role) {
  const { data, error } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();
  assert(!error && data?.role === role, `${userId} has role ${role}`);
}

async function assertNoMembership(userId) {
  const { data } = await admin.from('org_members').select('user_id').eq('user_id', userId).maybeSingle();
  assert(!data, `${userId} has no membership`);
}

async function assertRowOwner(table, id, userId, message) {
  const { data, error } = await admin.from(table).select('user_id').eq('id', id).single();
  assert(!error && data?.user_id === userId, message);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Tenancy assertion failed: ${message}`);
}
