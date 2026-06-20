import { NextResponse } from 'next/server';
import { getOrgContext, type OrgContext } from '@/lib/org-context';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { isAdminEmail } from '@/lib/admin-access';

type GuardOptions = {
  action: string;
  limit?: number;
  windowSeconds?: number;
  maxBodyBytes?: number;
  adminOnly?: boolean;
};

type GuardResult =
  | { ok: true; context: OrgContext }
  | { ok: false; response: NextResponse };

/**
 * Shared protection for endpoints that can spend provider money or mutate
 * privileged data. Rate-limit failures are deliberately fail-closed here.
 */
export async function guardAuthenticatedAction(
  request: Request,
  options: GuardOptions,
): Promise<GuardResult> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  const maxBodyBytes = options.maxBodyBytes ?? 128_000;
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Request body is too large' }, { status: 413 }),
    };
  }

  const context = await getOrgContext();
  if (!context) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (options.adminOnly && !isAdminEmail(context.user.email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  const rate = await checkRateLimit(
    `paid-action:${options.action}:${context.orgId}:${context.user.id}:${clientIp(request)}`,
    options.limit ?? 20,
    options.windowSeconds ?? 60,
    { failOpen: false },
  );
  if (!rate.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Too many requests. Please wait and try again.' },
        { status: 429, headers: { 'Retry-After': String(options.windowSeconds ?? 60) } },
      ),
    };
  }

  return { ok: true, context };
}
