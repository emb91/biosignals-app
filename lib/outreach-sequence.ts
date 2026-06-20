export type OutreachChannel = 'email' | 'linkedin';

export type OutreachSequenceMessage = {
  day_offset: number;
  subject: string;
  body: string;
  channel: OutreachChannel;
};

export const OUTREACH_COPY_DAY_OFFSETS = [1, 4, 8, 11, 14, 21] as const;
export const OUTREACH_DAY_OFFSETS = [1, 4, 7, 8, 11, 14, 21] as const;

const CHANNEL_BY_DAY: Record<number, OutreachChannel> = {
  1: 'email',
  4: 'email',
  7: 'linkedin',
  8: 'linkedin',
  11: 'email',
  14: 'linkedin',
  21: 'email',
};

export function defaultOutreachChannel(dayOffset: number): OutreachChannel {
  return CHANNEL_BY_DAY[dayOffset] ?? 'email';
}

export function isLinkedInInvite(message: Pick<OutreachSequenceMessage, 'day_offset' | 'channel'>): boolean {
  return message.day_offset === 7 && message.channel === 'linkedin';
}

export function withLinkedInInvite(
  messages: OutreachSequenceMessage[],
): OutreachSequenceMessage[] {
  const byDay = new Map(messages.map((message) => [message.day_offset, message]));
  if (!byDay.has(7)) {
    byDay.set(7, {
      day_offset: 7,
      subject: '',
      body: '',
      channel: 'linkedin',
    });
  }

  return OUTREACH_DAY_OFFSETS
    .map((dayOffset) => byDay.get(dayOffset))
    .filter((message): message is OutreachSequenceMessage => Boolean(message));
}

export function sanitizeOutreachMessages(
  input: unknown,
  options: { injectLinkedInInvite?: boolean } = {},
): OutreachSequenceMessage[] {
  if (!Array.isArray(input)) return [];

  const messages = input
    .map((message): OutreachSequenceMessage | null => {
      if (!message || typeof message !== 'object') return null;
      const raw = message as Record<string, unknown>;
      const dayOffset =
        typeof raw.day_offset === 'number' && Number.isFinite(raw.day_offset)
          ? Math.floor(raw.day_offset)
          : null;
      if (dayOffset === null) return null;

      const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
      const body = typeof raw.body === 'string' ? raw.body.trim() : '';
      const channel =
        raw.channel === 'email' || raw.channel === 'linkedin'
          ? raw.channel
          : defaultOutreachChannel(dayOffset);
      const invite = dayOffset === 7 && channel === 'linkedin';

      // LinkedIn messages do not have subjects. Requiring one here used to
      // silently delete the Day 8 and Day 14 steps during staging/editing.
      if (!invite && !body) return null;
      if (channel === 'email' && !subject) return null;

      return { day_offset: dayOffset, subject, body, channel };
    })
    .filter((message): message is OutreachSequenceMessage => message !== null);

  return options.injectLinkedInInvite ? withLinkedInInvite(messages) : messages;
}

export function hasCompleteBestPracticeCadence(
  messages: OutreachSequenceMessage[],
): boolean {
  return OUTREACH_DAY_OFFSETS.every((dayOffset) =>
    messages.some((message) => message.day_offset === dayOffset),
  );
}
