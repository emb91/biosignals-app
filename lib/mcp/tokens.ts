import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase-admin';

/**
 * Personal Access Token layer for the Arcova MCP server.
 *
 * Format: `arc_mcp_<43-char base64url>` (32 random bytes). The plaintext is shown to
 * the user exactly once at mint time; only a sha256 hash is persisted. Validation runs
 * through the service-role client (bypassing RLS) — it hashes the presented token and
 * looks it up, then re-resolves the user's *current* org (never trusting the stored
 * org_id). See memory/project_mcp_server_build.md.
 *
 * PAT now, OAuth-ready: if an OAuth authorization server is layered on later, issued
 * access tokens validate against this same shape (hash lookup + scopes).
 */

export type McpScope = 'read' | 'write' | 'acquire';
export const ALL_SCOPES: readonly McpScope[] = ['read', 'write', 'acquire'] as const;

const TOKEN_PREFIX = 'arc_mcp_';
const PREFIX_DISPLAY_LEN = TOKEN_PREFIX.length + 6; // e.g. "arc_mcp_AbCdEf"

export interface MintedToken {
  /** Full plaintext token — returned ONCE, never stored. */
  plaintext: string;
  /** Non-secret display fragment persisted for the UI. */
  prefix: string;
  /** sha256 hex of the plaintext. */
  hash: string;
}

export interface ResolvedToken {
  tokenId: string;
  userId: string;
  /** The user's current org, re-resolved at request time (not the stored value). */
  orgId: string | null;
  scopes: McpScope[];
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** Generate a fresh token. Pure — the caller persists the hash/prefix. */
export function generateToken(): MintedToken {
  const plaintext = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return {
    plaintext,
    prefix: plaintext.slice(0, PREFIX_DISPLAY_LEN),
    hash: hashToken(plaintext),
  };
}

function sanitizeScopes(raw: unknown): McpScope[] {
  if (!Array.isArray(raw)) return ['read'];
  const set = new Set<McpScope>();
  for (const s of raw) {
    if (s === 'read' || s === 'write' || s === 'acquire') set.add(s);
  }
  // 'read' is always implied — write/acquire without read makes no sense for this surface.
  set.add('read');
  return [...set];
}

/**
 * Validate a presented Authorization header value and resolve it to a user + org + scopes.
 * Returns null for anything malformed, unknown, revoked, or expired. Best-effort updates
 * last_used_at. Uses the service-role client by design (RLS would otherwise hide the row
 * since there is no logged-in user on an MCP request).
 */
export async function resolveToken(bearer: string | null | undefined): Promise<ResolvedToken | null> {
  if (!bearer) return null;
  const raw = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : bearer.trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;

  const presentedHash = hashToken(raw);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('api_tokens')
    .select('id, user_id, scopes, expires_at, revoked_at, token_hash')
    .eq('token_hash', presentedHash)
    .is('revoked_at', null)
    .maybeSingle<{
      id: string;
      user_id: string;
      scopes: string[] | null;
      expires_at: string | null;
      revoked_at: string | null;
      token_hash: string;
    }>();

  if (error || !data) return null;

  // Constant-time compare of the hash hex as defense-in-depth against timing leaks on
  // the unique-index lookup (both are fixed-length sha256 hex, so lengths always match).
  const a = Buffer.from(presentedHash, 'utf8');
  const b = Buffer.from(data.token_hash, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

  // Re-resolve the user's current org (membership may have changed since mint).
  const { data: membership } = await admin
    .from('org_members')
    .select('org_id')
    .eq('user_id', data.user_id)
    .maybeSingle<{ org_id: string }>();

  // Fire-and-forget last_used bump; never block or fail the request on it.
  void admin
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(undefined, () => {});

  return {
    tokenId: data.id,
    userId: data.user_id,
    orgId: membership?.org_id ?? null,
    scopes: sanitizeScopes(data.scopes),
  };
}

export { sanitizeScopes };
