const DEFAULT_AUTH_REDIRECT = '/today';
const LOCAL_ORIGIN = 'https://app.arcova.local';

export function safeRelativeRedirect(value: string | null | undefined, fallback = DEFAULT_AUTH_REDIRECT): string {
  if (!value) return fallback;

  const next = value.trim();
  if (
    next.length === 0 ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.startsWith('/\\') ||
    next.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(next)
  ) {
    return fallback;
  }

  try {
    const url = new URL(next, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
