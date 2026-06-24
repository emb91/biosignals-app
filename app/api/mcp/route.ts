import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { MCP_TOOLS, type AgentDbClient } from '@/lib/agent/mcp/tool-registry';
import { jsonSchemaToZodShape } from '@/lib/agent/mcp/json-schema-to-zod';
import { resolveToken } from '@/lib/mcp/tokens';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkRateLimit } from '@/lib/rate-limit';

// The token lib uses node:crypto and the service-role client — force the Node runtime.
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Stash resolved identity on AuthInfo.extra so tool callbacks can read it. */
interface McpAuthExtra extends Record<string, unknown> {
  userId: string;
  orgId: string | null;
  tokenId: string;
}

const baseHandler = createMcpHandler(
  (server) => {
    for (const tool of MCP_TOOLS) {
      server.tool(
        tool.name,
        tool.description,
        jsonSchemaToZodShape(tool.inputSchema),
        async (args, extra) => {
          const auth = extra.authInfo;
          const identity = auth?.extra as McpAuthExtra | undefined;
          const scopes = auth?.scopes ?? [];

          if (!identity?.userId) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unauthorized.' }) }], isError: true };
          }

          // Scope gate: the token must hold the tool's required scope.
          if (!scopes.includes(tool.scope)) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `This token lacks the "${tool.scope}" scope required by ${tool.name}.` }) }],
              isError: true,
            };
          }

          // Per-token rate limit. Paid tools fail closed; reads fail open.
          const rate = await checkRateLimit(
            `mcp:${tool.name}:${identity.tokenId}`,
            tool.paid ? 10 : 120,
            60,
            { failOpen: !tool.paid },
          );
          if (!rate.allowed) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Rate limit exceeded. Wait and retry.' }) }], isError: true };
          }

          try {
            const supabase = createAdminClient() as unknown as AgentDbClient;
            const text = await tool.handler(
              { supabase, userId: identity.userId, orgId: identity.orgId },
              (args ?? {}) as Record<string, unknown>,
            );
            return { content: [{ type: 'text', text }] };
          } catch (err) {
            console.error(`[mcp] tool ${tool.name} failed:`, err);
            return { content: [{ type: 'text', text: JSON.stringify({ error: 'Tool execution failed.' }) }], isError: true };
          }
        },
      );
    }
  },
  {
    // Advertised server identity (shown in client connector UIs).
    serverInfo: { name: 'arcova', version: '0.1.0' },
  },
  {
    // Next route lives at /api/mcp -> basePath '/api' makes the streamable endpoint '/api/mcp'.
    basePath: '/api',
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
);

/** PAT verification: Bearer arc_mcp_… -> AuthInfo with identity in `extra`. */
async function verifyToken(req: Request, bearer?: string): Promise<AuthInfo | undefined> {
  const resolved = await resolveToken(bearer ?? req.headers.get('authorization'));
  if (!resolved) return undefined;
  return {
    token: bearer ?? '',
    clientId: resolved.userId,
    scopes: resolved.scopes,
    extra: { userId: resolved.userId, orgId: resolved.orgId, tokenId: resolved.tokenId } satisfies McpAuthExtra,
  };
}

const handler = withMcpAuth(baseHandler, verifyToken, { required: true });

export { handler as GET, handler as POST, handler as DELETE };
