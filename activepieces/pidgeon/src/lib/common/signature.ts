import { createHmac, timingSafeEqual } from 'node:crypto';

/** How old a delivery may be before it is refused, in seconds. Pidgeon's own default. */
export const TOLERANCE_SECONDS = 300;

/**
 * Whether a webhook request came from Pidgeon.
 *
 * Pidgeon signs `timestamp.body` with HMAC-SHA256 and the endpoint's secret,
 * and sends `X-Pidgeon-Signature: v1=<hex>` and `X-Pidgeon-Timestamp`.
 * Signing the timestamp is what makes a captured request useless five
 * minutes later. The body must be the exact bytes received: re-serialising
 * parsed JSON changes them.
 */
export function verifySignature(input: {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody: unknown;
  now?: number;
}): boolean {
  const headers = lowerCase(input.headers);
  const signature = headers['x-pidgeon-signature'];
  const timestamp = Number(headers['x-pidgeon-timestamp']);
  const body = bodyText(input.rawBody);
  if (!signature || !Number.isFinite(timestamp) || body === undefined || !input.secret) return false;

  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(sign(input.secret, timestamp, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sign(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

function bodyText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return undefined;
}

function lowerCase(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}
