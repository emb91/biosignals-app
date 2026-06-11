'use client';

/**
 * /org/accept?token=… — accept an org invite (copy-link path for already-registered
 * users). Requires the visitor to be logged in as the invited email; the server
 * enforces the email match. On success we land them in the org's workspace.
 */
import { useAuth } from '@/context/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type AcceptState = 'idle' | 'working' | 'done' | 'error' | 'needs-login';

function AcceptInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState<AcceptState>('idle');
  const [message, setMessage] = useState<string>('');

  const accept = useCallback(async () => {
    setState('working');
    try {
      const res = await fetch('/api/org/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState('error');
        setMessage(json.error ?? 'Could not accept this invite.');
        return;
      }
      setState('done');
      setTimeout(() => router.push('/today'), 800);
    } catch {
      setState('error');
      setMessage('Something went wrong. Try again.');
    }
  }, [router, token]);

  useEffect(() => {
    if (loading) return;
    if (!token) {
      setState('error');
      setMessage('This invite link is missing its token.');
      return;
    }
    if (!user) {
      setState('needs-login');
      return;
    }
    if (state === 'idle') void accept();
  }, [accept, loading, state, token, user]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-transparent font-jakarta p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/80 bg-white/70 p-8 text-center shadow-sm">
        {state === 'working' || state === 'idle' ? (
          <>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-arcova-teal" />
            <p className="mt-4 text-sm text-slate-600">Joining your team…</p>
          </>
        ) : null}

        {state === 'done' && (
          <>
            <h1 className="text-lg font-semibold text-slate-900">You&rsquo;re in</h1>
            <p className="mt-2 text-sm text-slate-600">Taking you to your workspace…</p>
          </>
        )}

        {state === 'needs-login' && (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Sign in to accept</h1>
            <p className="mt-2 text-sm text-slate-600">
              Log in with the email this invite was sent to, then reopen the link.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/login?next=${encodeURIComponent(`/org/accept?token=${token}`)}`)}
              className="mt-4 rounded-lg bg-arcova-teal px-4 py-2 text-sm font-medium text-white"
            >
              Go to login
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Invite problem</h1>
            <p className="mt-2 text-sm text-slate-600">{message}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function OrgAcceptPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInner />
    </Suspense>
  );
}
