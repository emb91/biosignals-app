import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/org-context';
import { generateToken, sanitizeScopes, type McpScope } from '@/lib/mcp/tokens';

export const runtime = 'nodejs';

/** List the caller's tokens (metadata only — never the secret). */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await ctx.supabase
    .from('api_tokens')
    .select('id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at')
    .eq('user_id', ctx.user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'Failed to load tokens.' }, { status: 500 });
  return NextResponse.json({ tokens: data ?? [] });
}

/** Mint a new token. The plaintext is returned ONCE and never stored. */
export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { name?: unknown; scopes?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'A name (1–120 chars) is required.' }, { status: 400 });
  }
  const scopes: McpScope[] = sanitizeScopes(body.scopes);
  const expiresInDays = typeof body.expiresInDays === 'number' && body.expiresInDays > 0
    ? Math.min(365, Math.round(body.expiresInDays))
    : null;
  const expires_at = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
    : null;

  const minted = generateToken();

  const { data, error } = await ctx.supabase
    .from('api_tokens')
    .insert({
      user_id: ctx.user.id,
      org_id: ctx.orgId,
      name,
      token_prefix: minted.prefix,
      token_hash: minted.hash,
      scopes,
      expires_at,
    })
    .select('id, name, token_prefix, scopes, expires_at, created_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to create token.' }, { status: 500 });
  }

  // plaintext returned exactly once
  return NextResponse.json({ token: { ...data, plaintext: minted.plaintext } }, { status: 201 });
}

/** Revoke a token by id (sets revoked_at; rotation = revoke + mint). */
export async function DELETE(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 });

  const { error } = await ctx.supabase
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', ctx.user.id)
    .is('revoked_at', null);

  if (error) return NextResponse.json({ error: 'Failed to revoke token.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
