/**
 * The `Idempotency-Key` on a tool that sends, and the one made up when the
 * model passes none.
 *
 * **A model's retry is a fresh call with the same arguments.** It times out,
 * or its client drops the answer, and it calls `send_message` again with what
 * it sent before — it does not think to invent a key first, and a key it
 * invents on the retry is new, so it protects nothing. So when the call
 * carries no key, one is derived from what makes the two calls the same
 * send: the credential, the endpoint (with its ids), the arguments, and the
 * hour. An identical call in the same hour is the same key, and the API
 * answers it with the first send's answer and sends nothing.
 *
 * What it costs: a message meant to go twice, word for word, within the
 * hour. That call is not sent; it gets the first answer and `REPLAY_NOTE`
 * says so, and a new `idempotency_key` sends it. A duplicate in a stranger's
 * inbox cannot be taken back; a second call can be made. `docs/email.md` →
 * "Every send takes an `Idempotency-Key`".
 *
 * Shared by `call.ts` (npm and `/api/mcp`) and `@pidgeon-ai/ai-sdk`, which
 * read the same tool list and so must agree on what this field is.
 */

/** The input field. Never sent as a body field: every request schema is strict. */
export const IDEMPOTENCY_KEY_FIELD = 'idempotency_key';

/**
 * How long an identical call counts as a retry. Fixed windows, so a retry
 * that straddles the hour is a new key: a minute-late retry does that one
 * time in sixty, where a ten-minute window would make it one in ten.
 */
export const DERIVED_KEY_WINDOW_MS = 60 * 60 * 1000;

/** Told to the model when the API answered from a stored send instead of sending. */
export const REPLAY_NOTE =
  'Not sent again: this call matched an earlier send (same idempotency key), and this is ' +
  'that send’s answer. To send the same message a second time on purpose, call again ' +
  'with a new `idempotency_key`.';

/**
 * Told to the model when a send was held for a person rather than sent.
 *
 * Led with for the reason `REPLAY_NOTE` is: the answer carries an `id`, and
 * a model reads an id as "sent" unless something says otherwise. Here rather
 * than a file of its own because the same two callers need it.
 */
export function pendingApprovalNote(result: unknown): string | null {
  const answer = result as { status?: unknown; draft_id?: unknown; approval?: unknown } | null;
  if (answer?.status !== 'pending_approval') return null;

  const reason = (answer.approval as { reason?: unknown } | null)?.reason;
  const why =
    reason === 'risky_thread'
      ? 'a message in this conversation tried to give you instructions'
      : 'this address asks a person before writing to someone it has never written to';

  return (
    `Not sent: it is waiting for a person to approve it, because ${why}. It is draft ` +
    `${String(answer.draft_id)}. Do not send it again. Call \`get_draft_approval\` with that id ` +
    'to see whether it was approved; it expires unsent after 24 hours.'
  );
}

/**
 * Takes the key out of `input` and answers the one to send.
 *
 * Undefined for a tool without the field. `input` is the arguments still
 * bound for the API, path parameters included, so a reply to one message
 * and the same words to another are two keys.
 */
export async function takeIdempotencyKey(
  tool: { endpoint: string; inputSchema: Record<string, unknown> },
  input: Record<string, unknown>,
  credential: string,
  now: number = Date.now(),
): Promise<string | undefined> {
  if (!(IDEMPOTENCY_KEY_FIELD in tool.inputSchema)) return undefined;

  const given = input[IDEMPOTENCY_KEY_FIELD];
  delete input[IDEMPOTENCY_KEY_FIELD];

  if (typeof given === 'string' && given.length > 0) return given;

  /*
   * The credential is in the hash because the API's fingerprint covers the
   * key's id: two keys in one account sending the same words would
   * otherwise share a key and the second would get a 409.
   */
  const material = JSON.stringify([
    credential,
    tool.endpoint,
    canonical(input),
    Math.floor(now / DERIVED_KEY_WINDOW_MS),
  ]);

  return `derived-${(await sha256(material)).slice(0, 40)}`;
}

/** Keys sorted at every depth, so `{a, b}` and `{b, a}` are one send. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** Web Crypto, not `node:crypto`: the AI SDK package runs wherever `fetch` does. */
async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
