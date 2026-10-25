import { createHmac, timingSafeEqual } from 'crypto';

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
  signature: string | undefined;
  timestamp: string | undefined;
  body: string;
  now?: number;
}): boolean {
  if (!input.signature || !input.timestamp) return false;

  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) return false;

  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(sign(input.secret, timestamp, input.body));
  const given = Buffer.from(input.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sign(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
