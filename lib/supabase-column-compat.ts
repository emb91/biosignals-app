export function isMissingColumnError(error: unknown, columnName?: string): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };

  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  const matchesMissingColumn =
    code === '42703' || (message.includes('column') && message.includes('does not exist'));

  if (!matchesMissingColumn) return false;
  if (!columnName) return true;

  return message.includes(columnName);
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
