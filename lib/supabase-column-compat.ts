export function isMissingColumnError(error: unknown, columnName?: string): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };

  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  const matchesMissingColumn =
    code === '42703' ||
    code === 'PGRST204' ||
    (message.includes('column') && message.includes('does not exist')) ||
    (message.includes('Could not find') &&
      message.includes('column') &&
      message.includes('schema cache'));

  if (!matchesMissingColumn) return false;
  if (!columnName) return true;

  const cn = columnName.replace(/"/g, '');
  return message.includes(columnName) || message.includes(cn) || message.includes(`'${cn}'`);
}

/**
 * Column name from PostgREST schema cache (PGRST204) or PostgreSQL missing-column messages.
 */
export function parseMissingColumnNameFromDbError(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const pgrst = trimmed.match(/Could not find the '([^']+)' column of '/);
  if (pgrst?.[1]) return pgrst[1];
  const dneQuoted = trimmed.match(/column "([^"]+)" does not exist/i);
  if (dneQuoted?.[1]) return dneQuoted[1];
  const dneApos = trimmed.match(/column '([^']+)' does not exist/i);
  if (dneApos?.[1]) return dneApos[1];
  return null;
}

export function withoutPlatformCategory<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  delete next.platform_category;
  return next;
}

export function withoutIcpSegmentColumns<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  delete next.target_customers;
  delete next.buyer_types;
  delete next.competitors;
  return next;
}

const LOG_STACK_MAX_CHARS = 12_000;

/**
 * Normalized error shape for structured logs (JSON-friendly, no thrown reference).
 */
export function serializeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const e = error as Error & { code?: string; details?: string; hint?: string };
    const out: Record<string, unknown> = {
      kind: 'Error',
      name: e.name,
      message: e.message,
    };
    if (e.code != null && e.code !== '') out.code = e.code;
    if (e.details != null && e.details !== '') out.details = e.details;
    if (e.hint != null && e.hint !== '') out.hint = e.hint;
    if (e.stack) {
      out.stack =
        e.stack.length > LOG_STACK_MAX_CHARS
          ? `${e.stack.slice(0, LOG_STACK_MAX_CHARS)}…`
          : e.stack;
    }
    if ('cause' in e && e.cause !== undefined) {
      out.cause = serializeErrorForLog(e.cause);
    }
    return out;
  }

  if (error && typeof error === 'object') {
    const o = error as Record<string, unknown>;
    const code = o.code;
    const message = o.message;
    const details = o.details;
    const hint = o.hint;
    if (
      typeof code === 'string' ||
      typeof details === 'string' ||
      typeof hint === 'string' ||
      typeof message === 'string'
    ) {
      return {
        kind: 'PostgrestShape',
        code: typeof code === 'string' ? code : code != null ? String(code) : undefined,
        message: typeof message === 'string' ? message : message != null ? String(message) : undefined,
        details: typeof details === 'string' ? details : undefined,
        hint: typeof hint === 'string' ? hint : undefined,
      };
    }

    try {
      return { kind: 'object', value: JSON.parse(JSON.stringify(error)) as unknown };
    } catch {
      return { kind: 'object', keys: Object.keys(o), stringified: String(error) };
    }
  }

  if (typeof error === 'string') {
    return { kind: 'string', message: error };
  }

  return { kind: 'unknown', stringified: String(error) };
}

/**
 * One JSON line per failure for grep-friendly server logs (Vercel, Docker, etc.).
 */
export function logApiOperationError(
  tag: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = {
    tag,
    at: new Date().toISOString(),
    error: serializeErrorForLog(err),
  };
  if (context && Object.keys(context).length > 0) {
    payload.context = context;
  }
  console.error(JSON.stringify(payload));
}

/** Supabase PostgREST errors are plain objects; `instanceof Error` is often false. */
export function formatSupabaseWriteError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();

  if (error && typeof error === 'object') {
    const o = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [o.message, o.details, o.hint, o.code]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' | ');
  }

  return 'Internal server error';
}

export function withoutUserCompanyCustomerTaxonomy<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  delete next.customer_therapeutic_areas;
  delete next.customer_modalities;
  delete next.customer_development_stages;
  return next;
}
