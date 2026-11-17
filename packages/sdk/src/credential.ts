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
import { verifySignature } from 'http-message-sig';
import { jwkToKeyID, parseSignatureAgentHeader, sign } from 'web-bot-auth';
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

const DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';

/**
 * Whether the directory a signature names (its `Signature-Agent`) is
 * `directory`: the same origin, given bare or with the well-known path. A
 * key's signature proves the key; this binds it to the operator whose
 * directory publishes it, so a request cannot claim another operator's.
 */
export function sameDirectory(named: string | null | undefined, directory: string): boolean {
  if (!named) return false;
  try {
    const a = new URL(named);
    const b = new URL(directory);
    const path = a.pathname.replace(/\/+$/, '');
    return a.origin === b.origin && (path === '' || path === DIRECTORY_PATH) && !a.search;
  } catch {
    return false;
  }
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
      /** The directory the signature named and covered (its `Signature-Agent`), or null when it named none. */
      directory: string | null;
      created: Date;
      expires: Date;
      /** The signature's nonce, when it has one: remember it to refuse the same signature twice. */
      nonce: string | null;
      /** The signature itself, base64url: what to remember when it carries no nonce. */
      signature: string;
    }
  | { ok: false; reason: Rejection; kid?: string; directory?: string | null; detail: string };

/** The `web-bot-auth` profile's refusal: a policy the signature broke, before or instead of its key. */
class ProfileError extends Error {}

/** The members of a Signature-Input dictionary: each label and its own text. */
function inputMembers(input: string): { label: string; text: string }[] {
  return input
    .split(/,(?=\s*[A-Za-z*][A-Za-z0-9_.*-]*=\()/)
    .map((text) => ({ label: /^\s*([^=]+)=/.exec(text)?.[1]?.trim() ?? '', text }))
    .filter((member) => member.label !== '');
}

/**
 * Which signature to check when a request carries several (RFC 9421 §4.3: a
 * proxy or CDN may add its own): the one tagged `web-bot-auth`, or the only
 * one there is. Undefined lets the verifier refuse an ambiguous request.
 */
function labelToCheck(request: Request): string | undefined {
  const members = inputMembers(request.headers.get('signature-input') ?? '');
  if (members.length === 1) return members[0]!.label;
  return members.find((member) => /;\s*tag="web-bot-auth"/.test(member.text))?.label;
}

/**
 * The directory a signature names, from its `Signature-Agent`: the member it
 * covers (`"signature-agent";key="…"`, the draft's dictionary form) or the
 * whole header when it covers it bare (the string form our agents and
 * Cloudflare send). The header is required to be covered when present
 * (draft-ietf-webbotauth-httpsig-protocol §5.2.1), so a directory is never
 * taken from an unsigned header.
 */
function coveredDirectory(
  request: Request,
  components: readonly { name: string; parameters: Record<string, unknown> }[],
): string | null {
  const header = request.headers.get('signature-agent');
  if (header === null) return null;
  let parsed: ReturnType<typeof parseSignatureAgentHeader>;
  try {
    parsed = parseSignatureAgentHeader(header);
  } catch (error) {
    throw new ProfileError(error instanceof Error ? error.message : 'Unreadable Signature-Agent.');
  }
  const covered = components.filter((c) => c.name === 'signature-agent');
  if (parsed.kind === 'legacy') {
    if (!covered.some((c) => Object.keys(c.parameters).length === 0))
      throw new ProfileError('The signature must cover Signature-Agent.');
    return parsed.entries[0]?.uri ?? null;
  }
  const keys = covered.flatMap((c) =>
    typeof c.parameters.key === 'string' && Object.keys(c.parameters).length === 1
      ? [c.parameters.key]
      : [],
  );
  if (keys.length !== 1)
    throw new ProfileError('The signature must cover exactly one Signature-Agent member.');
  const entry = parsed.entries.find((candidate) => candidate.label === keys[0]);
  if (!entry) throw new ProfileError(`Signature-Agent has no member ${keys[0]}.`);
  return entry.type === 'directory' ? entry.uri : null;
}

/**
 * The directory a request's `Signature-Agent` names, read without checking
 * anything: what a check records about a request it refused. Null when
 * there is none; the header itself, cut short, when it cannot be read.
 */
export function signatureAgentOf(request: Request): string | null {
  const header = request.headers.get('signature-agent');
  if (header === null) return null;
  try {
    return parseSignatureAgentHeader(header).entries[0]?.uri.slice(0, 512) ?? null;
  } catch {
    return header.slice(0, 512);
  }
}

/** Why a signature failed, with the reason under the verifier's own words. */
function detailOf(error: unknown): string {
  const words: string[] = [];
  for (let e: unknown = error; e instanceof Error && words.length < 3; e = e.cause)
    if (e.message) words.push(e.message);
  return (words.join(': ') || String(error)).slice(0, 300);
}

/**
 * Check a request's agent signature, under Web Bot Auth as the working group
 * wrote it (draft-ietf-webbotauth-httpsig-protocol-01 §5.2): Ed25519, tagged
 * `web-bot-auth`, with `created`, `expires` and `keyid`, covering the bare
 * `@authority` or `@target-uri`, and the `Signature-Agent` when there is one.
 * `alg` and `nonce` are optional, as the draft and RFC 9421 make them, and a
 * nonce of any length is remembered. On top of the draft, no signature
 * verifies more than five minutes after it was made.
 *
 * `findKey` turns a key id, and the directory the signature names, into the
 * public key to check it with, or null; whether that key is revoked, and its
 * operator's reputation, are the caller's next questions.
 */
export async function verifyAgentRequest(
  request: Request,
  findKey: (kid: string, directory: string | null) => Promise<PublicJwk | null>,
  options: { now?: Date } = {},
): Promise<Verification> {
  if (!request.headers.has('signature') || !request.headers.has('signature-input')) {
    return { ok: false, reason: 'unsigned', detail: 'The request carries no agent signature.' };
  }

  let unknown: string | undefined;
  let named: string | null | undefined;
  let profile: { kid: string; directory: string | null } | undefined;
  try {
    const verified = await verifySignature(request, {
      label: labelToCheck(request),
      policy: {
        algorithms: ['ed25519'],
        requiredComponents: [],
        requiredParameters: ['created', 'expires', 'keyid', 'tag'],
        maxAge: MAX_LIFETIME_SECONDS,
        clockSkew: CLOCK_SKEW_SECONDS,
        now: Math.floor((options.now ?? new Date()).getTime() / 1000),
      },
      resolveVerifier: async (candidate) => {
        const { parameters, components } = candidate;
        const keyid = parameters.keyid;
        if (typeof keyid !== 'string' || keyid === '')
          throw new ProfileError('keyid must be a non-empty string.');
        if (parameters.tag !== 'web-bot-auth')
          throw new ProfileError('The signature is not tagged web-bot-auth.');
        if (typeof parameters.created !== 'number' || typeof parameters.expires !== 'number')
          throw new ProfileError('created and expires must be integers.');
        if (parameters.created > parameters.expires)
          throw new ProfileError('created is after expires.');
        if (parameters.nonce !== undefined && typeof parameters.nonce !== 'string')
          throw new ProfileError('nonce must be a string.');
        if (
          !components.some(
            (c) =>
              (c.name === '@authority' || c.name === '@target-uri') &&
              Object.keys(c.parameters).length === 0,
          )
        )
          throw new ProfileError('The signature must cover @authority or @target-uri.');
        named = coveredDirectory(request, components);
        const jwk = await findKey(keyid, named);
        if (!jwk) {
          unknown = keyid;
          throw new Error(`No published key ${keyid}.`);
        }
        profile = { kid: keyid, directory: named };
        return verifierFromJWK(jwk);
      },
    });
    if (!profile) throw new Error('The signature was not resolved.');
    const nonce = verified.parameters.nonce;
    return {
      ok: true,
      kid: profile.kid,
      directory: profile.directory,
      created: new Date(Number(verified.parameters.created) * 1000),
      expires: new Date(Number(verified.parameters.expires) * 1000),
      nonce: typeof nonce === 'string' ? nonce : null,
      signature: base64Url(verified.signature.slice().buffer as ArrayBuffer),
    };
  } catch (error) {
    const detail = detailOf(error);
    if (unknown)
      return { ok: false, reason: 'unknown_key', kid: unknown, directory: named, detail };
    if (/expired|too old|max ?age|in the future/i.test(detail))
      return { ok: false, reason: 'expired', directory: named, detail };
    return { ok: false, reason: 'invalid', directory: named, detail };
  }
}
