/**
 * Holding the event log open.
 *
 * **The second thing a generator cannot produce**, for the same reason as
 * `webhooks.ts`: `GET /events/stream` answers `text/event-stream` and
 * `openapi-ts` builds a typed `fetch` that resolves once with a body. There
 * is nowhere in a generated client to put a connection that stays open, so
 * `eventsStream` exists in the types and does nothing useful, and the
 * endpoint the documentation recommends for *"a caller that cannot host a
 * webhook endpoint — a script on a laptop, a notebook, an agent runtime with
 * no public address"* was the one endpoint every customer hand-rolled.
 *
 * A field test on 15 October wrote forty lines of it and they worked first
 * try, which is the argument both ways: the protocol is simple, and nobody
 * should write it twice. These are those forty lines, once.
 *
 * `EventSource` is not used. It cannot send an `Authorization` header — the
 * browser API takes a URL and nothing else — and putting an API key in a
 * query string is the one place it must never go. So this is `fetch` with a
 * reader, which also works unchanged in Node, Bun, Deno, Workers and Vercel
 * functions.
 */

/** A row of `GET /events`, delivered as it happens. The same shape either way. */
export interface StreamedEvent {
  id: string;
  type: string;
  identity: string | null;
  message_id: string | null;
  thread_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface StreamOptions {
  /** `https://pidgeon.ai/api/v1` unless you are pointing at something else. */
  baseUrl?: string;
  apiKey: string;
  /** Narrow to one mailbox. Omitted, the stream spans every one the key reaches. */
  identityId?: string;
  /** A comma-separated list, exactly as `GET /events` takes it. */
  type?: string;
  /**
   * Where to start, as an ISO timestamp.
   *
   * **`1970-01-01T00:00:00Z` reads the whole log from the beginning**, which
   * is the answer to a question the API otherwise makes you guess at: with
   * no cursor at all the plain listing pages *backwards*, so a first-time
   * consumer that stores its last row stores the oldest event and never
   * advances. Omit this and the stream starts from now.
   */
  after?: string;
  /** Stop the stream. Aborting mid-event drops that event rather than half of it. */
  signal?: AbortSignal;
}

/**
 * Every event, as it happens, until you stop asking.
 *
 * ```ts
 * for await (const event of streamEvents({ apiKey })) {
 *   if (event.type === 'message.received' && !event.data.from_self) {
 *     await answer(event.data.message_id as string);
 *   }
 * }
 * ```
 *
 * **Reconnection is this function's job and it is lossless.** The server
 * closes the connection itself after about 280 seconds so that the last
 * thing you receive is a cursor rather than a socket error; this reconnects
 * with `Last-Event-ID`, which the server prefers over `after`, so there is
 * no gap and no repeat. A network failure is retried the same way with a
 * short backoff. The loop ends when `signal` aborts and in no other case —
 * a stream that gave up quietly would be worse than one that never started.
 */
export async function* streamEvents(options: StreamOptions): AsyncGenerator<StreamedEvent> {
  const base = (options.baseUrl ?? 'https://pidgeon.ai/api/v1').replace(/\/$/, '');
  let lastEventId: string | undefined;
  let backoffMs = 1_000;

  while (!options.signal?.aborted) {
    const url = new URL(`${base}/events/stream`);
    if (options.identityId) url.searchParams.set('identity_id', options.identityId);
    if (options.type) url.searchParams.set('type', options.type);
    if (options.after && !lastEventId) url.searchParams.set('after', options.after);

    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          accept: 'text/event-stream',
          ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
        },
        signal: options.signal,
      });
    } catch {
      if (options.signal?.aborted) return;
      await sleep(backoffMs, options.signal);
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }

    /*
     * A refusal is not a blip. `401` on a revoked key and `403` on a
     * mailbox the key cannot reach will answer the same way for ever, so
     * retrying is a loop that never ends and never says why. `429` and the
     * 5xx family are temporary and are retried.
     */
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error(
        `Pidgeon refused the stream: ${response.status} ${await response.text().catch(() => '')}`.trim(),
      );
    }

    if (!response.ok || !response.body) {
      await sleep(backoffMs, options.signal);
      backoffMs = Math.min(backoffMs * 2, 30_000);
      continue;
    }

    // Connected. Anything after this is an ordinary close, not a failure.
    backoffMs = 1_000;

    for await (const frame of frames(response.body, options.signal)) {
      /*
       * **The frame's `id:` is a cursor, not the event's id.** It is the
       * event's `created_at`, because `Last-Event-ID` is handed back in
       * place of `after` and `after` takes a timestamp — sending the event
       * id would produce a reconnect that silently restarts from the
       * beginning. The event's own id is inside `data`.
       */
      if (frame.id) lastEventId = frame.id;
      if (!frame.data) continue;

      /*
       * The server sends one of these before it gives up, and then closes.
       * It is not an event and must not be yielded as one — the loop
       * reconnects from the cursor, which is what it says to do.
       */
      if (frame.event === 'error') continue;

      let parsed: StreamedEvent;

      try {
        parsed = JSON.parse(frame.data) as StreamedEvent;
      } catch {
        // A frame we cannot read is one event lost, not a reason to drop the
        // connection and re-read from a cursor we have already passed.
        continue;
      }

      yield parsed;
    }
  }
}

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

/**
 * The wire format, which is four lines and two rules.
 *
 * A frame ends at a blank line; a line starting `:` is a comment and the
 * server sends one on connect so proxies do not buffer the first event.
 * `data:` may repeat, and the pieces join with a newline — our events never
 * do, and handling it is two characters.
 */
async function* frames(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) return;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const frame: Frame = {};
        const data: string[] = [];

        for (const line of block.split('\n')) {
          if (line.startsWith(':')) continue;

          const colon = line.indexOf(':');
          if (colon === -1) continue;

          const field = line.slice(0, colon);
          // One optional space after the colon, per the spec.
          const value = line.slice(colon + 1).replace(/^ /, '');

          if (field === 'id') frame.id = value;
          else if (field === 'event') frame.event = value;
          else if (field === 'data') data.push(value);
        }

        if (data.length > 0) frame.data = data.join('\n');
        if (frame.id || frame.data) yield frame;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Waits, and returns early if the caller gives up while we are waiting. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
