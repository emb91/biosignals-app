'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Copy, Check, Trash2, KeyRound, Plus } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';

type Scope = 'read' | 'write' | 'acquire';

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: Scope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const SCOPE_LABELS: Record<Scope, string> = {
  read: 'Read — query accounts, contacts and ICPs',
  write: 'Write — edit ICPs and set targets',
  acquire: 'Acquire — run data sourcing (uses credits)',
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
}

export default function ApiTokensPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<Scope>>(new Set(['read']));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const mcpUrl = useMemo(
    () => (typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp'),
    [],
  );

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  const load = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch('/api/settings/api-tokens');
      const data = await res.json();
      setTokens(res.ok ? (data.tokens ?? []) : []);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { if (user) void load(); }, [user, load]);

  const copy = useCallback((text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }, []);

  const toggleScope = (s: Scope) => {
    if (s === 'read') return; // read is always implied
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      next.add('read');
      return next;
    });
  };

  const create = async () => {
    setError(null);
    setNewToken(null);
    if (!name.trim()) { setError('Give the token a name.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/settings/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: [...scopes] }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Failed to create token.'); return; }
      setNewToken(data.token.plaintext);
      setName('');
      setScopes(new Set(['read']));
      await load();
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/settings/api-tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Loader2 className="h-8 w-8 animate-spin text-arcova-teal" />
      </div>
    );
  }
  if (!user) return null;

  const configSnippet = `{
  "mcpServers": {
    "arcova": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}`;

  return (
    <div className="flex h-screen bg-transparent">
      <AppSidebar />
      <main className="bg-transparent min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-arcova-teal" />
            <h1 className="text-2xl font-semibold text-slate-950">Developer access</h1>
          </div>
          <p className="mt-2 text-sm text-[#5b6b75]">
            Connect Arcova to AI assistants and tools that speak MCP. Create a token, then add it to
            your client. Tokens act as you and respect your workspace permissions.
          </p>

          {/* Connection details */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Connection</h2>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-4">
              <label className="text-xs font-medium text-[#7d909a]">Server URL</label>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">{mcpUrl}</code>
                <button onClick={() => copy(mcpUrl, 'url')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-50">
                  {copied === 'url' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-arcova-teal">Show client config example</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{configSnippet}</pre>
              </details>
            </div>
          </section>

          {/* Create token */}
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Create a token</h2>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-4">
              <label className="text-xs font-medium text-[#7d909a]">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Claude Desktop"
                maxLength={120}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-arcova-teal"
              />
              <div className="mt-4 space-y-2">
                <span className="text-xs font-medium text-[#7d909a]">Permissions</span>
                {(['read', 'write', 'acquire'] as Scope[]).map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={scopes.has(s)}
                      disabled={s === 'read'}
                      onChange={() => toggleScope(s)}
                      className="h-4 w-4 rounded border-slate-300 text-arcova-teal"
                    />
                    {SCOPE_LABELS[s]}
                  </label>
                ))}
              </div>
              {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
              <button
                onClick={create}
                disabled={creating}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-arcova-teal px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Generate token
              </button>

              {newToken && (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-800">Copy this token now — you will not see it again.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-white px-3 py-2 text-sm text-slate-800">{newToken}</code>
                    <button onClick={() => copy(newToken, 'new')} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs text-amber-800 hover:bg-amber-100">
                      {copied === 'new' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Existing tokens */}
          <section className="mt-8 pb-12">
            <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-[#7d909a]">Your tokens</h2>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white/70">
              {listLoading ? (
                <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : tokens.length === 0 ? (
                <p className="p-6 text-sm text-[#5b6b75]">No tokens yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {tokens.map((t) => {
                    const revoked = !!t.revoked_at;
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-4 p-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`truncate text-sm font-medium ${revoked ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.name}</span>
                            <code className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">{t.token_prefix}…</code>
                          </div>
                          <p className="mt-0.5 text-xs text-[#7d909a]">
                            {t.scopes.join(', ')} · created {fmtDate(t.created_at)} · last used {fmtDate(t.last_used_at)}
                            {revoked ? ' · revoked' : ''}
                          </p>
                        </div>
                        {!revoked && (
                          <button onClick={() => revoke(t.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50">
                            <Trash2 className="h-3.5 w-3.5" /> Revoke
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
