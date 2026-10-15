/**
 * Verifying a delivery.
 *
 * The only part of this package with a security contract: it is what a
 * customer runs to decide whether a request claiming a message arrived
 * actually came from us. Everything else here is a typed `fetch`.
 *
 * Two properties carry that contract, and both are tested against payloads
 * signed by the server's own implementation — see
 * `tests/unit/sdk-webhook-verifier.test.ts`. Testing this file against
 * itself would prove only that it agrees with itself, which is exactly the
 * bug two implementations of one scheme produce.
 */

export const SIGNATURE_HEADER = 'x-pidgeon-signature';
export const TIMESTAMP_HEADER = 'x-pidgeon-timestamp';

export interface WebhookEnvelope {
  id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}

/**
 * Verifies a delivery and returns its payload.
 *
 * Throws rather than returning false, because the one thing this must not
 * allow is a caller who forgets to check the boolean. Uses `crypto.subtle`,
 * so it works unchanged in Node, Bun, Deno, Workers and Vercel functions.
 *
 * `rawBody` must be the exact bytes we sent. Re-serialising parsed JSON
 * changes key order and whitespace, and the signature will not match — read
 * the body as text before you parse it.
 */
export async function verifyWebhook(input: {
  rawBody: string;
  headers: Headers | Record<string, string | undefined>;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): Promise<WebhookEnvelope> {
  /*
   * **However the framework spells it**, which this did not do.
   *
   * It read `headers[name] ?? headers[name.toLowerCase()]`, and `name` is
   * already one of the lowercase constants above — so the fallback lowercased
   * a string that was lowercase and looked up the same key twice. A plain
   * object keyed `X-Pidgeon-Signature` was rejected as unsigned.
   *
   * It survived every test and every local run because `Headers` and Node's
   * `req.headers` both lowercase their keys for you, so the broken branch is
   * only reached by a plain object somebody built themselves — which is what
   * API Gateway hands a Lambda, and what any test fixture written by hand
   * looks like. `pidgeon` on PyPI has done this correctly at the same version
   * number, and that module's docstring says keeping the two in step is the
   * point of writing it twice.
   *
   * The rejection made it worse: *"This request is not signed."* is the same
   * sentence `/docs/webhooks/verifying` tells you means *you parsed the body
   * first*, so the documentation sent you to the wrong cause. Found by a
   * field test on 15 October, against docs that promise case-insensitive
   * matching in both clients.
   */
  const get = (name: string): string | undefined => {
    if (input.headers instanceof Headers) return input.headers.get(name) ?? undefined;

    const direct = input.headers[name];
    if (direct !== undefined) return direct;

    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(input.headers)) {
      if (key.toLowerCase() === wanted) return value;
    }

    return undefined;
  };

  const timestamp = get(TIMESTAMP_HEADER);
  const signature = get(SIGNATURE_HEADER);

  if (!timestamp || !signature) throw new Error('This request is not signed.');

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) throw new Error('The signature timestamp is not a number.');

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;

  if (Math.abs(now - seconds) > tolerance) {
    throw new Error('This request is too old to trust. It may be a replay.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${seconds}.${input.rawBody}`),
  );

  const expected = `v1=${[...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;

  if (!constantTimeEqual(expected, signature)) {
    throw new Error('The signature does not match.');
  }

  return JSON.parse(input.rawBody) as WebhookEnvelope;
}

/** Length-independent compare. Not `===`, which returns on the first byte. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return difference === 0;
}
