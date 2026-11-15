/**
 * The agent credential: Web Bot Auth, unchanged.
 *
 * An agent signs each request with its Ed25519 key under HTTP Message
 * Signatures (RFC 9421), tagged `web-bot-auth`, covering the request's
 * authority, method, path and query and the `Signature-Agent` header, which points
 * at its operator's directory on Pidgeon. Signing and verifying are
 * Cloudflare's open-source `web-bot-auth`; this module fixes our choices on
 * top of it and nothing more.
 *
 * Choices:
 * - Ed25519 only, because Cloudflare accepts nothing else.
 * - `Signature-Agent` in the string form (`"https://…"`), which Cloudflare
 *   requires today; the verifier accepts the working group's dictionary form
 *   too.
 * - A minute's lifetime by default, so a captured request is useless soon.
 * - A fresh nonce in every signature, so a verifier that remembers them
 *   accepts each signature once.
 */
import { jwkToKeyID, sign, verify, type WebBotVerifier } from 'web-bot-auth';
import { signerFromJWK, verifierFromJWK } from 'web-bot-auth/crypto';

/** The public half of an agent's key, as published in its directory. */
export type PublicJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string };

/** Both halves. The private half never reaches Pidgeon. */
export type AgentKeyPair = { kid: string; publicJwk: PublicJwk; privateJwk: JsonWebKey };

/** How long a signature lasts unless the agent asks for less. */
export const DEFAULT_LIFETIME_SECONDS = 60;

/**
 * The longest a signature lasts, whatever the signer asks, and the oldest a
 * verifier accepts, whatever its `expires` says: five minutes, so a captured
 * request is soon useless. The draft's own
 * ceiling, a day, left a copied request replayable at the same site all day.
 */
export const MAX_LIFETIME_SECONDS = 5 * 60;

/** How far an agent's clock may run ahead of the verifier's. */
const CLOCK_SKEW_SECONDS = 30;

/**
 * What the signature covers beyond the authority and the Signature-Agent:
 * the method, the path and the query. The query is covered when the URL has
 * none too (its value is then `?`), so one cannot be added in transit.
 */
const COVERED = ['@method', '@path', '@query'] as const;

/**
 * A fresh nonce: 64 random bytes, base64url (Web Bot Auth §4.2.2). A
 * verifier that remembers nonces refuses the same signature twice.
 */
export function newNonce(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An operator's directory: where its agents' public keys are published. */
export function directoryUrl(
  slug: string,
  host = process.env.AGENTS_HOST ?? 'agents.pidgeon.ai',
): string {
  return `https://${slug}.${host}`;
}

/** A key's id: its JWK SHA-256 thumbprint (RFC 7638), Web Bot Auth's `keyid`. */
export async function keyIdOf(publicJwk: PublicJwk): Promise<string> {
  return jwkToKeyID(publicJwk, (bytes) => crypto.subtle.digest('SHA-256', bytes), base64Url);
}

/** base64url without padding; in the browser too, where there is no Buffer (the dashboard makes keys there). */
function base64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether something is an Ed25519 public key, and only that: no private part. */
export function isPublicJwk(value: unknown): value is PublicJwk {
  if (typeof value !== 'object' || value === null) return false;
  const jwk = value as Record<string, unknown>;
  return (
    jwk.kty === 'OKP' &&
    jwk.crv === 'Ed25519' &&
    typeof jwk.x === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(jwk.x) &&
    !('d' in jwk)
  );
}

/** A new key pair, for an agent. Run where the agent runs: the CLI, the SDK. */
export async function generateAgentKey(): Promise<AgentKeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  // Web Bot Auth wants an Ed25519 JWK's alg to be EdDSA or absent; Node writes "Ed25519".
  const { alg: _alg, ...privateJwk } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const publicJwk: PublicJwk = { kty: 'OKP', crv: 'Ed25519', x: exported.x! };
  return { kid: await keyIdOf(publicJwk), publicJwk, privateJwk };
}

/**
 * Sign a request as an agent: returns the headers to add. The request must
 * not carry a Signature-Agent of its own; this sets it. Every signature has
 * a fresh nonce, so sign again for each send, retries included; `nonce` is
 * for tests that need the same bytes twice.
 */
export async function signAgentRequest(
  request: Request,
  options: {
    privateJwk: JsonWebKey;
    directory: string;
    lifetimeSeconds?: number;
    now?: Date;
    nonce?: string;
  },
): Promise<Record<string, string>> {
  const now = options.now ?? new Date();
  const lifetime = Math.min(
    options.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS,
    MAX_LIFETIME_SECONDS,
  );
  const signatureAgent = `"${options.directory}"`;
  const headers = new Headers(request.headers);
  headers.set('signature-agent', signatureAgent);
  // The signature covers the authority, method, path and Signature-Agent,
  // never the body, so sign a body-less copy: building it from `request`
  // itself would consume the body and leave the caller nothing to send.
  const signed = new Request(request.url, { method: request.method, headers });

  const fields = await sign(signed, {
    signer: await signerFromJWK(options.privateJwk),
    created: now,
    expires: new Date(now.getTime() + lifetime * 1000),
    nonce: options.nonce ?? newNonce(),
    additionalComponents: COVERED,
  });

  return {
    'signature-agent': signatureAgent,
    signature: fields.signature,
    'signature-input': fields.signatureInput,
  };
}

/** Why a request's credential was not accepted, in the API's words. */
export type Rejection = 'unsigned' | 'invalid' | 'unknown_key' | 'expired';

export type Verification =
  | {
      ok: true;
      kid: string;
      directory: string | null;
      created: Date;
      expires: Date;
      /** The signature's nonce, when it has one: remember it to refuse the same signature twice. */
      nonce: string | null;
    }
  | { ok: false; reason: Rejection; kid?: string; detail: string };

/**
 * Check a request's agent signature. `findKey` turns a key id into the public
 * key Pidgeon published for it, or null; whether that key is revoked, and the
 * operator's reputation, are the caller's next questions.
 */
export async function verifyAgentRequest(
  request: Request,
  findKey: (kid: string) => Promise<PublicJwk | null>,
  options: { now?: Date } = {},
): Promise<Verification> {
  if (!request.headers.has('signature') || !request.headers.has('signature-input')) {
    return { ok: false, reason: 'unsigned', detail: 'The request carries no agent signature.' };
  }

  let unknown: string | undefined;
  try {
    const verified = await verify(request, {
      algorithms: ['ed25519'],
      maxAge: MAX_LIFETIME_SECONDS,
      clockSkew: CLOCK_SKEW_SECONDS,
      now: options.now,
      resolver: async (candidate): Promise<WebBotVerifier> => {
        const jwk = await findKey(candidate.keyid);
        if (!jwk) {
          unknown = candidate.keyid;
          throw new Error(`No published key ${candidate.keyid}.`);
        }
        return verifierFromJWK(jwk);
      },
    });
    return {
      ok: true,
      kid: verified.keyid,
      directory: verified.signatureAgent?.uri ?? null,
      created: verified.created,
      expires: verified.expires,
      nonce: verified.nonce ?? null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (unknown) return { ok: false, reason: 'unknown_key', kid: unknown, detail };
    if (/expir|too old|max ?age|future/i.test(detail))
      return { ok: false, reason: 'expired', detail };
    return { ok: false, reason: 'invalid', detail };
  }
}
