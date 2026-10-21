/**
 * The inbound loop: read `message.received` from Pidgeon's event log, hand
 * each to the durable queue, then move the cursor.
 *
 * Written against the four ways AgentMail's channel loses mail
 * (`prd/openclaw-channel.md`):
 *
 * - **No socket to die.** A request every few seconds, from a cursor that
 *   lives in OpenClaw's state store. A dropped connection is one failed
 *   request; the next one resumes from the same cursor.
 * - **It never stops by itself.** The loop returns only when the account is
 *   shut down, and says so in the log. Every other failure is retried with
 *   backoff and published as `degraded` with its sentence, so status never
 *   reads healthy while nothing arrives, and never "stopped" while it runs.
 * - **The cursor moves only after the queue has the message.** `admit` is
 *   the durable append; if it throws, the cursor stays and the page is read
 *   again.
 * - **It re-reads a window behind the cursor.** The log's cursor is a
 *   timestamp and the API reads strictly after it, so two events in the same
 *   instant, or a row committed a moment after a later one, could fall
 *   behind it. Re-reading the last `overlapMs` catches those; the queue keys
 *   on the message id, so a message read twice is one turn.
 *
 * A first start begins at the present: installing the channel does not
 * answer a mailbox's history.
 */
import { PidgeonApiError, type Client, type Event } from './api.js';

export interface Cursor {
  /** The newest `created_at` admitted. */
  after: string;
  /** Where this install began; the overlap never reaches behind it. */
  floor: string;
}

export type PollState = 'starting' | 'running' | 'degraded' | 'unauthorized' | 'stopped';

export interface PollStatus {
  state: PollState;
  lastPollAt?: number;
  lastError?: string;
  /** Consecutive failed polls. */
  failures: number;
}

export interface PollOptions {
  client: Pick<Client, 'receivedSince'>;
  getCursor: () => Promise<Cursor | undefined>;
  setCursor: (cursor: Cursor) => Promise<void>;
  /** The durable append. Must throw if the event is not stored. */
  admit: (event: Event) => Promise<void>;
  /** Lowercased; empty means every address the credential reaches. */
  addresses: string[];
  onStatus: (status: PollStatus) => void;
  log?: { info?: (line: string) => void; warn?: (line: string) => void };
  signal: AbortSignal;
  intervalMs: number;
  overlapMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MAX_BACKOFF_MS = 60_000;
const PAGE = 100;

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

const iso = (ms: number) => new Date(ms).toISOString();
const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a);

/** One pass: every page from the overlap window to the present. */
export async function pollOnce(options: PollOptions): Promise<{ admitted: number }> {
  const now = options.now ?? Date.now;
  const overlap = options.overlapMs ?? 30_000;

  let cursor = await options.getCursor();
  if (!cursor) {
    const start = iso(now());
    cursor = { after: start, floor: start };
    await options.setCursor(cursor);
  }

  let after = later(cursor.floor, iso(Date.parse(cursor.after) - overlap));
  let admitted = 0;
  for (;;) {
    if (options.signal.aborted) break;
    const page = await options.client.receivedSince(after, PAGE);
    let newest: string = cursor.after;
    for (const event of page.data) {
      newest = later(newest, event.created_at);
      if (!event.message_id) continue;
      const address = event.identity?.toLowerCase();
      if (options.addresses.length > 0 && (!address || !options.addresses.includes(address))) {
        continue;
      }
      await options.admit(event);
      admitted++;
    }
    // Every event on the page is in the queue; only now may the cursor pass them.
    if (newest !== cursor.after) {
      cursor = { ...cursor, after: newest };
      await options.setCursor(cursor);
    }
    if (!page.has_more || !page.next_cursor) break;
    // A millisecond back, so an event sharing the boundary's instant is read
    // on the next page rather than skipped; the queue drops the repeat. Not
    // when that would not move forward, or a page of one instant would loop.
    const stepBack = iso(Date.parse(page.next_cursor) - 1);
    after = Date.parse(stepBack) > Date.parse(after) ? stepBack : page.next_cursor;
  }
  return { admitted };
}

/** Runs until `signal` aborts. Never returns early, never throws. */
export async function runPoller(options: PollOptions): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const status: PollStatus = { state: 'starting', failures: 0 };
  const publish = (next: Partial<PollStatus>) => {
    Object.assign(status, next);
    options.onStatus({ ...status });
  };
  publish({});

  while (!options.signal.aborted) {
    try {
      await pollOnce(options);
      if (status.failures > 0) options.log?.info?.('Pidgeon: reading mail again.');
      publish({
        state: 'running',
        lastPollAt: now(),
        failures: 0,
        lastError: undefined,
      });
      await sleep(options.intervalMs, options.signal);
    } catch (error) {
      if (options.signal.aborted) break;
      const failures = status.failures + 1;
      const unauthorized = error instanceof PidgeonApiError && error.status === 401;
      const message = unauthorized
        ? 'Pidgeon refused the credential. Run `openclaw channels login --channel pidgeon`, or check the API key.'
        : error instanceof Error
          ? error.message
          : String(error);
      // Once per change, not once per retry: a log that repeats every five
      // seconds is one nobody reads.
      if (message !== status.lastError) options.log?.warn?.(`Pidgeon: ${message} Retrying.`);
      publish({ state: unauthorized ? 'unauthorized' : 'degraded', failures, lastError: message });
      await sleep(
        Math.min(MAX_BACKOFF_MS, options.intervalMs * 2 ** Math.min(failures, 6)),
        options.signal,
      );
    }
  }
  publish({ state: 'stopped' });
  options.log?.info?.('Pidgeon: stopped reading mail, because the account was shut down.');
}
