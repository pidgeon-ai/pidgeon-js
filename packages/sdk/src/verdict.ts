/**
 * Pidgeon verdicts, for a sign-up hook that cannot see the agent's request
 * (Supabase's Before User Created, an Auth0 Action, WorkOS Actions).
 *
 * 1. The website's proxy verifies the agent (`/v1/verify`, or `verdictFor`
 *    in `@pidgeon-ai/sdk/next`) and gets `verdict`: what Pidgeon found,
 *    signed, for five minutes.
 * 2. The app passes it to the sign-up (Supabase `options.data`, a hidden
 *    field, a header).
 * 3. The hook checks it: offline here, against Pidgeon's published keys, or
 *    with Pidgeon (`new Pidgeon({ apiKey }).checkVerdict()`), which also
 *    holds it to your account, spends it once and sees a revocation since.
 *
 * ```ts
 * import { verifyVerdict } from '@pidgeon-ai/sdk/verdict';
 *
 * const verdict = await verifyVerdict(token, { origin: 'https://shop.example', ip });
 * if (verdict.result === 'verified') // verdict.operator.name stands behind it
 * ```
 */
import { createLocalJWKSet, createRemoteJWKSet, errors, jwtVerify, type JSONWebKeySet } from 'jose';

import { DEFAULT_BASE_URL, type VerdictClaims, type VerdictRefusal } from './index.ts';

export type { VerdictClaims, VerdictRefusal } from './index.ts';
export { VERDICT_HEADER, VERDICT_LIFETIME_SECONDS } from './index.ts';

/** The `typ` a verdict carries, and an ID token never does. */
export const VERDICT_TYP = 'pidgeon-verdict+jwt';

/** Clocks between Pidgeon and the hook may differ by this much. */
const LEEWAY_SECONDS = 30;

export class VerdictError extends Error {
  constructor(
    readonly reason: VerdictRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'VerdictError';
  }
}

/**
 * An address as one form: IPv6 compressed and lower case, `::ffff:1.2.3.4`
 * as `1.2.3.4`. Null when it is not an address.
 */
export function canonicalIp(raw: string | null | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(text)) {
    return text;
  }
  if (!text.includes(':')) return null;
  let host: string;
  try {
    host = new URL(`http://[${text}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  return host;
}

/**
 * Check a verdict offline: signed with Pidgeon's published key under the
 * verdict `typ`, issued by Pidgeon, for `origin`, not expired, and, when it
 * names an address and you pass `ip`, for that address. With `account`,
 * also issued to your Pidgeon account (recommended: a verdict another
 * account asked for is refused). Throws `VerdictError` otherwise.
 *
 * Offline means it cannot be spent: within its five minutes it verifies
 * each time it is shown. Where one sign-up per verdict matters, check it
 * with Pidgeon instead (`checkVerdict`).
 */
export async function verifyVerdict(
  token: string,
  options: {
    /** Your site, as `https://shop.example`: the origin the agent signed for. */
    origin: string;
    /** Your Pidgeon account's id (`/v1/account`, or Settings). */
    account?: string;
    /** The address signing up, as the hook sees it. */
    ip?: string | null;
    issuer?: string;
    /** Pidgeon's keys, if you keep a copy; fetched from `<issuer>/.well-known/jwks.json` otherwise. */
    jwks?: JSONWebKeySet;
  },
): Promise<VerdictClaims> {
  const issuer = (options.issuer ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const keys = options.jwks
    ? createLocalJWKSet(options.jwks)
    : remoteKeys(`${issuer}/.well-known/jwks.json`);
  let claims: VerdictClaims;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: new URL(options.origin).origin,
      algorithms: ['RS256'],
      typ: VERDICT_TYP,
      clockTolerance: LEEWAY_SECONDS,
      requiredClaims: ['exp', 'iat', 'jti'],
    });
    claims = payload as unknown as VerdictClaims;
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new VerdictError('expired', 'The verdict has expired.');
    }
    if (error instanceof errors.JWTClaimValidationFailed && error.claim === 'aud') {
      throw new VerdictError('wrong_site', 'The verdict is for another site.');
    }
    throw new VerdictError('invalid', error instanceof Error ? error.message : String(error));
  }
  if (options.account !== undefined && claims.receiver !== options.account) {
    throw new VerdictError('wrong_account', 'The verdict was issued to another Pidgeon account.');
  }
  if (claims.ip && options.ip && canonicalIp(options.ip) !== claims.ip) {
    throw new VerdictError('wrong_ip', 'The verdict is for another address.');
  }
  return claims;
}

const remote = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function remoteKeys(url: string) {
  let keys = remote.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url));
    remote.set(url, keys);
  }
  return keys;
}
