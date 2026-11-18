import { createHmac, timingSafeEqual } from 'crypto';

/** How old a delivery may be before it is refused, in seconds. */
export const TOLERANCE_SECONDS = 300;

/**
 * Whether a webhook delivery came from Pidgeon. Pidgeon sends
 * `Pidgeon-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`
 * with the endpoint's secret. The body must be the bytes received: JSON
 * parsed and serialised again is not. Signing the time is what makes a
 * captured delivery useless five minutes later.
 */
export function verifySignature(input: {
  secret: string;
  header: string | undefined;
  body: string;
  now?: number;
}): boolean {
  const parts: Record<string, string> = {};
  for (const part of (input.header ?? '').split(',')) {
    const at = part.indexOf('=');
    if (at > 0) parts[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(sign(input.secret, timestamp, input.body));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
