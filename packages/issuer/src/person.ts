import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto';

/**
 * A person signs in at the issuer: Pidgeon Cloud's person flow, with the
 * company's own identity provider where Cloud has its consent page.
 *
 * The site speaks to the issuer exactly as it speaks to Cloud (the
 * authorization code flow with PKCE and a nonce, `@pidgeon-ai/sign-in`'s
 * `login` and `callback`). The issuer is a relying party of the company's
 * OpenID Connect provider (Keycloak, Auth0, Okta, Entra): it sends the
 * browser there with its own PKCE, state and nonce, checks the ID token
 * that comes back, and signs the person in to the site as `kind: person`
 * with the provider's `sub` and a verified address at the domain.
 *
 * **No database.** What a store would hold travels sealed (AES-256-GCM
 * under `PIDGEON_ISSUER_SECRET`): the sign-in in progress in an HttpOnly
 * cookie on the issuer's host, bound to the browser that started it; the
 * code, sixty seconds, used once through the issuer's replay store.
 * Rotating the secret ends the sign-ins in flight, and nothing else.
 */

/** The company's identity provider, as its relying party. */
export interface PersonOptions {
  /** At least 32 characters. Seals the sign-in in progress and the code. */
  secret: string;
  oidc: {
    /** The provider's issuer, exactly as its ID tokens say: `https://sso.acme.com/realms/acme`. */
    issuer: string;
    /**
     * Where the issuer fetches the provider's configuration, when it reaches
     * the provider by another name than browsers do. Default
     * `<issuer>/.well-known/openid-configuration`.
     */
    discoveryUrl?: string;
    clientId: string;
    clientSecret: string;
    /** How the issuer authenticates at the provider's token endpoint. Default `client_secret_basic`. */
    tokenAuth?: 'client_secret_basic' | 'client_secret_post';
  };
  /** Domains a person's verified address may be at. Default the issuer's domain. */
  emailDomains?: string[];
}

export const MIN_SECRET = 32;
export const FLOW_COOKIE = 'pidgeon_issuer_flow';
export const CODE_SECONDS = 60;
export const FLOW_SECONDS = 600;
/** How far a provider's clock may be from ours. */
const SKEW = 60;
const UPSTREAM_ALGS = ['RS256', 'ES256', 'EdDSA'];

export function checkSecret(secret: string | undefined): string {
  if (!secret || secret.length < MIN_SECRET) {
    throw new Error(
      `A person's sign-in needs PIDGEON_ISSUER_SECRET, ${MIN_SECRET} characters or more. It seals the sign-in in progress and the code; there is no default.`,
    );
  }
  return secret;
}

// --- Sealing --------------------------------------------------------------------------

const b64url = (bytes: Uint8Array | Buffer | string) => Buffer.from(bytes).toString('base64url');

function sealKey(secret: string, purpose: string): Buffer {
  return createHash('sha256').update(`pidgeon issuer seal\0${purpose}\0${secret}`).digest();
}

/** AES-256-GCM, a key per purpose, so a cookie is never accepted as a code. */
export function seal(secret: string, purpose: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return b64url(Buffer.concat([iv, body, cipher.getAuthTag()]));
}

export function unseal<T>(
  secret: string,
  purpose: string,
  token: string | null | undefined,
): T | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', sealKey(secret, purpose), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const text = Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function pkceHolds(verifier: string, challenge: string): boolean {
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// --- The provider ---------------------------------------------------------------------

interface ProviderConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/** What the issuer takes from the provider's ID token. */
export interface ProviderPerson {
  sub: string;
  email: string;
  authTime: number;
}

export class ProviderRefused extends Error {}

/**
 * The provider, as a relying party sees it: its configuration, its keys,
 * and its ID token checked (OpenID Connect Core §3.1.3.7): from that
 * issuer, for this client, current, with the nonce this sign-in sent,
 * signed by a key in its JWKS, with a verified address.
 */
export function provider(options: PersonOptions['oidc'], fetcher: typeof fetch, now: () => number) {
  const issuer = options.issuer.replace(/\/$/, '');
  let configuration: { at: number; value: Promise<ProviderConfiguration> } | null = null;
  let keys: { at: number; value: JsonWebKey[] } | null = null;

  function discover(): Promise<ProviderConfiguration> {
    if (!configuration || configuration.at <= now() - 3_600_000) {
      const url = options.discoveryUrl ?? `${issuer}/.well-known/openid-configuration`;
      const value = (async () => {
        const response = await fetcher(url, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
        const body = (await response.json()) as ProviderConfiguration;
        if (body.issuer?.replace(/\/$/, '') !== issuer) {
          throw new Error(`${url} names the issuer ${body.issuer}, not ${issuer}.`);
        }
        return body;
      })();
      configuration = { at: now(), value };
      value.catch(() => {
        if (configuration?.value === value) configuration = null;
      });
    }
    return configuration.value;
  }

  async function key(kid: string | undefined): Promise<JsonWebKey | null> {
    const find = () =>
      keys?.value.find((one) => (kid ? one.kid === kid : true) && one.use !== 'enc') ?? null;
    const fresh = keys && keys.at > now() - 300_000;
    if (fresh && find()) return find();
    // Refetched once for a `kid` it has not seen: the provider rotated.
    if (keys && keys.at > now() - 10_000) return null;
    const response = await fetcher((await discover()).jwks_uri);
    const body = (await response.json().catch(() => ({}))) as { keys?: JsonWebKey[] };
    keys = { at: now(), value: Array.isArray(body.keys) ? body.keys : [] };
    return find();
  }

  async function authorizeUrl(input: {
    redirectUri: string;
    state: string;
    nonce: string;
    verifier: string;
  }): Promise<string> {
    const url = new URL((await discover()).authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: input.redirectUri,
      scope: 'openid email',
      state: input.state,
      nonce: input.nonce,
      code_challenge: pkceChallenge(input.verifier),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async function redeem(input: {
    code: string;
    redirectUri: string;
    verifier: string;
    nonce: string;
  }): Promise<ProviderPerson> {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (options.tokenAuth === 'client_secret_post') {
      form.set('client_id', options.clientId);
      form.set('client_secret', options.clientSecret);
    } else {
      // RFC 6749 §2.3.1: each form-encoded, then joined.
      const pair = `${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`;
      headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`;
    }
    const response = await fetcher((await discover()).token_endpoint, {
      method: 'POST',
      headers,
      body: form,
    });
    const body = (await response.json().catch(() => ({}))) as {
      id_token?: string;
      error?: string;
    };
    if (!response.ok || typeof body.id_token !== 'string') {
      throw new ProviderRefused(
        `The identity provider did not sign the person in (${body.error ?? response.status}).`,
      );
    }
    return check(body.id_token, input.nonce);
  }

  async function check(token: string, nonce: string): Promise<ProviderPerson> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new ProviderRefused('The provider sent no ID token.');
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    } catch {
      throw new ProviderRefused('The provider sent no ID token.');
    }
    if (!header.alg || !UPSTREAM_ALGS.includes(header.alg)) {
      throw new ProviderRefused(`The provider's ID token is signed with ${header.alg}.`);
    }
    const jwk = await key(header.kid);
    if (!jwk || !signatureHolds(header.alg, jwk, `${parts[0]}.${parts[1]}`, parts[2]!)) {
      throw new ProviderRefused("The provider's ID token is not signed by its keys.");
    }

    const at = Math.floor(now() / 1000);
    if (typeof claims.iss !== 'string' || claims.iss.replace(/\/$/, '') !== issuer) {
      throw new ProviderRefused("The provider's ID token is from another issuer.");
    }
    const aud = claims.aud;
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(options.clientId)) {
      throw new ProviderRefused("The provider's ID token is for another client.");
    }
    if (audiences.length > 1 && claims.azp !== options.clientId) {
      throw new ProviderRefused("The provider's ID token is for another client.");
    }
    if (typeof claims.exp !== 'number' || claims.exp + SKEW <= at) {
      throw new ProviderRefused("The provider's ID token has expired.");
    }
    if (typeof claims.iat === 'number' && claims.iat > at + SKEW) {
      throw new ProviderRefused("The provider's ID token is from the future.");
    }
    if (claims.nonce !== nonce) {
      throw new ProviderRefused("The provider's ID token is for another sign-in.");
    }
    if (typeof claims.sub !== 'string' || !claims.sub) {
      throw new ProviderRefused("The provider's ID token names nobody.");
    }
    if (claims.email_verified !== true || typeof claims.email !== 'string') {
      throw new ProviderRefused('The identity provider has not verified this person’s address.');
    }
    return {
      sub: claims.sub,
      email: claims.email.trim().toLowerCase(),
      authTime: typeof claims.auth_time === 'number' ? claims.auth_time : at,
    };
  }

  return { authorizeUrl, redeem };
}

function signatureHolds(alg: string, jwk: JsonWebKey, input: string, signature: string): boolean {
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const data = Buffer.from(input);
    const sig = Buffer.from(signature, 'base64url');
    if (alg === 'EdDSA') return jwk.kty === 'OKP' && verify(null, data, key, sig);
    if (alg === 'ES256') {
      return (
        jwk.kty === 'EC' &&
        jwk.crv === 'P-256' &&
        verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
      );
    }
    return jwk.kty === 'RSA' && verify('sha256', data, key, sig);
  } catch {
    return false;
  }
}
