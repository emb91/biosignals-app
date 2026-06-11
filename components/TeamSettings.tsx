'use client';

/**
 * Settings → Team. Lists org members + pending invites and lets an owner/admin invite
 * teammates. Two invite outcomes (see /api/org/invite):
 *  - 'email': Supabase emailed a fresh user → we just confirm.
 *  - 'link':  the email already has an account → we show a copy-link the owner sends;
 *             the invitee accepts at /org/accept.
 *
 * Self-contained so it can drop into the large settings page with a single import.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, Copy, UserPlus, X } from 'lucide-react';

type Member = { user_id: string; email: string | null; role: string; joined_at: string | null; pending: boolean };
type PendingInvite = { email: string; role: string; created_at: string };

type Roster = {
  orgId: string;
  role: 'owner' | 'admin' | 'member';
  selfUserId: string;
  members: Member[];
  pendingInvites: PendingInvite[];
};

const ADMIN_ROLES = ['owner', 'admin'];

export default function TeamSettings() {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkResult, setLinkResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/org/members');
      if (res.ok) setRoster(await res.json());
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canManage = roster ? ADMIN_ROLES.includes(roster.role) : false;
  const isOwner = roster?.role === 'owner';

  const changeRole = async (userId: string, role: 'admin' | 'member') => {
    setError(null);
    try {
      const res = await fetch('/api/org/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not change role.');
        return;
      }
      void refresh();
    } catch {
      setError('Could not change role.');
    }
  };

  const removeMember = async (userId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/org/members?user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not remove member.');
        return;
      }
      void refresh();
    } catch {
      setError('Could not remove member.');
    }
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLinkResult(null);
    setNotice(null);
    setCopied(false);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/org/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, role }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        delivered?: 'email' | 'link';
        acceptUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? 'Could not send invite.');
        return;
      }
      if (json.delivered === 'link' && json.acceptUrl) {
        setLinkResult(json.acceptUrl);
        setNotice(`${trimmed} already has an account — send them this link to join.`);
      } else {
        setNotice(`Invite emailed to ${trimmed}.`);
      }
      setEmail('');
      void refresh();
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!linkResult) return;
    try {
      await navigator.clipboard.writeText(linkResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — link is still visible to select */
    }
  };

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Team</h2>
      <p className="mt-1 text-sm text-slate-500">
        People you add here join your team and work alongside you.
      </p>

      <div className="mt-4 rounded-2xl border border-white/80 bg-white/70 p-5 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {(roster?.members ?? []).map((m) => {
                const isSelf = m.user_id === roster?.selfUserId;
                const editableRole = canManage && m.role !== 'owner' && !isSelf;
                return (
                  <li key={m.user_id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {m.email ?? m.user_id.slice(0, 8)}
                      </span>
                      {m.pending && <span className="text-xs text-amber-600">Invited — not joined yet</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {editableRole && !isSelf ? (
                        <select
                          value={m.role}
                          onChange={(e) => void changeRole(m.user_id, e.target.value as 'admin' | 'member')}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium capitalize text-slate-700 outline-none focus:border-arcova-teal"
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-600">
                          {m.role}
                        </span>
                      )}
                      {isOwner && m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => void removeMember(m.user_id)}
                          aria-label="Remove member"
                          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {(roster?.pendingInvites ?? []).map((inv) => (
                <li key={`inv-${inv.email}`} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{inv.email}</span>
                    <span className="text-xs text-amber-600">Invite link pending acceptance</span>
                  </div>
                  <span className="ml-3 shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-600">
                    {inv.role}
                  </span>
                </li>
              ))}
            </ul>

            {canManage ? (
              <form onSubmit={submitInvite} className="mt-4 border-t border-slate-100 pt-4">
                <label className="text-xs font-medium text-slate-500">Invite a teammate</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal"
                  />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-arcova-teal"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    disabled={submitting || !email.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Invite
                  </button>
                </div>

                {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
                {notice && <p className="mt-2 text-sm text-slate-600">{notice}</p>}
                {linkResult && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 p-2">
                    <code className="flex-1 truncate text-xs text-slate-600">{linkResult}</code>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
                Only an owner or admin can invite teammates.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
