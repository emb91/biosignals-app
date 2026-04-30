/**
 * Server-Sent Events (SSE) helpers for enrichment streaming routes.
 *
 * Events emitted in order:
 *   step_claude   — Claude web-search narrative fields arrive
 *   step_apollo   — Apollo firmographic fields arrive
 *   step_apify    — Apify LinkedIn fields arrive (logo, tagline, followers)
 *   step_taxonomy — Taxonomy classification (company_type, TAs, modalities, stages)
 *   done          — Full merged result (same shape as the non-streaming JSON response)
 *   error         — Pipeline error (stream closes after this)
 */

export type SSEStepName =
  | 'step_claude'
  | 'step_apollo'
  | 'step_apify'
  | 'step_taxonomy'
  | 'done'
  | 'error';

const encoder = new TextEncoder();

export function encodeSSEEvent(event: SSEStepName, data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/**
 * Parse raw SSE text from a fetch ReadableStream into typed events.
 * Yields one object per complete SSE block (event + data pair).
 */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<{ event: SSEStepName; data: Record<string, unknown> }> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE blocks are separated by blank lines (\n\n)
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      let eventName: SSEStepName | null = null;
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim() as SSEStepName;
        else if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      if (eventName && dataStr) {
        try {
          yield { event: eventName, data: JSON.parse(dataStr) as Record<string, unknown> };
        } catch {
          // malformed data — skip
        }
      }
    }
  }
}
