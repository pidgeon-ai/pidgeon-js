import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

import { jwkThumbprint, verifyRequest } from '@pidgeon-ai/id';

import type { Directory, DirectoryAgent } from './directory';
import {
  checkSecret,
  CODE_SECONDS,
  cookieOf,
  FLOW_COOKIE,
  FLOW_SECONDS,
  pkceHolds,
  provider,
  ProviderRefused,
  seal,
  unseal,
  type PersonOptions,
} from './person';
import type { RetiredKey, Signer } from './signer';

/**
 * A Post issuer a company runs itself (#568): its own domain signs its
 * agents' cards, ID tokens and grants, with a key that never leaves its
 * network, for the agents its identity provider says it has.
 *
 * **The same wire protocol as Pidgeon Cloud's issuer**, so the libraries
 * work against it unchanged: the policy and the card at `post.<domain>`
 * (the draft's §discovery and §card), the token exchange an agent signs
 * (RFC 8693, Web Bot Auth's profile) and the ID token a site checks
 * (`@pidgeon-ai/sign-in`), grants (§grants), and a person's sign-in, the
 * authorization code flow with PKCE, through the company's own identity
 * provider (`person.ts`). The formats are the app's own
 * (`src/lib/post/card.ts`, `grant.ts`, `pidgeon-sign-in.ts`), written out
 * here because a package cannot import the app; `tests/unit/issuer.test.ts`
 * holds them equal by reading what this signs with the app's own readers.
 *
 * **No database.** Who the agents are is the directory's; a signature is
 * used once through `replay`, in memory unless a shared store is passed.
 * Run one replica, or pass one.
 *
 * Left out on purpose: userinfo, introspection and
 * revocation (each needs a store; an ID token lives five minutes and
 * revoking an agent is disabling it in the identity provider), dynamic
 * client registration, and the card log.
 */

export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const TOKEN_TYPE_JWT = 'urn:ietf:params:oauth:token-type:jwt';
export const TOKEN_TYPE_ID = 'urn:ietf:params:oauth:token-type:id_token';
export const TOKEN_TYPE_ACCESS = 'urn:ietf:params:oauth:token-type:access_token';

/** Where each thing answers under the issuer. The token and JWKS paths are Pidgeon Cloud's. */
export const PATHS = {
  configuration: '/.well-known/openid-configuration',
  policy: '/.well-known/post.json',
  card: '/.well-known/post/card',
  directory: '/.well-known/http-message-signatures-directory',
  token: '/api/post/oidc/token',
  authorize: '/api/post/oidc/authorize',
  /** The issuer's own: where the company's identity provider sends a person back. Cloud has none. */
  callback: '/api/post/oidc/callback',
  jwks: '/api/post/oidc/jwks',
  grants: '/api/post/grants',
} as const;

const POLICY_MAX_AGE = 86_400;
const CARD_SECONDS = 86_400;
const ID_TOKEN_SECONDS = 300;
const NEW_ADDRESS_DAYS = 30;
/** The longest an exchange's signature may have been made before it arrives. */
const EXCHANGE_SIGNATURE_SECONDS = 600;
const EXCHANGE_COMPONENTS = ['@method', '@authority', '@path', 'from', 'content-digest'];
const GRANT_HEADER = 'post-grant';

export interface GrantRule {
  /** The directory group or role that carries this grant. */
  group: string;
  scope: { name: string; label: string; limit?: { amount: number; currency: string } };
  /** The domain the agent may act with. Absent: anywhere. */
  audience?: string;
  subject: { type: 'customer' | 'account' | 'order'; id: string };
  /** How long each signed copy lasts. Default 30. */
  days?: number;
}

/**
 * A site, registered by hand: its `client_id`, the host its grants must be
 * for, and where a person's sign-in may return to, each matched exactly.
 */
export interface StaticClient {
  client_id: string;
  host: string;
  redirect_uris?: string[];
}

/** Remembers a signature's `keyid nonce` until it expires; false when it was used. */
export interface ReplayStore {
  use(key: string, expiresAt: number): boolean | Promise<boolean>;
}

export interface IssuerOptions {
  /** The domain whose agents this issues for: `acme.com`. */
  domain: string;
  /** Default `https://post.<domain>`. */
  issuer?: string;
  signer: Signer;
  /** Keys being withdrawn: published until their `notAfter`, so copies they signed still check. */
  retired?: RetiredKey[];
  directory: Directory;
  /** The card's `on_behalf_of`: who the agents work for. Default the domain. */
  organisation?: string;
  grants?: GrantRule[];
  clients?: StaticClient[];
  /**
   * Hosts whose Client ID Metadata Documents may be fetched, for a site
   * whose `client_id` is a URL. Default none: the token endpoint runs
   * inside the network, and an `audience` the caller chooses must never
   * make it fetch an arbitrary URL.
   */
  clientMetadataHosts?: string[];
  /** A person's sign-in, through the company's identity provider. Absent: agents only. */
  person?: PersonOptions;
  replay?: ReplayStore;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch, for tests. */
  now?: () => number;
}

export interface Issuer {
  readonly issuer: string;
  readonly domain: string;
  /** Answers a request to the issuer, or null when the path is not one of its. */
  handle(request: Request): Promise<Response | null>;
  /** The `_post` TXT record for `_post.<domain>`. */
  record(): string;
  /** Every public document, by path, as `pidgeon-issuer export` writes them. */
  documents(): Promise<Record<string, string>>;
  /** An agent's card, signed now, or null when the directory has no such live agent. */
  card(address: string): Promise<{ jws: string; card: Record<string, unknown> } | null>;
  /** The grants an agent holds now, signed. */
  grantsFor(agent: DirectoryAgent): Promise<{ id: string; jws: string }[]>;
}

const b64url = (bytes: Uint8Array | Buffer | string) => Buffer.from(bytes).toString('base64url');
const encode = (value: unknown) => b64url(JSON.stringify(value));
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** An in-memory `ReplayStore`. */
export function memoryReplayStore(now: () => number = () => Date.now()): ReplayStore {
  const seen = new Map<string, number>();
  return {
    use(key, expiresAt) {
      const at = Math.floor(now() / 1000);
      for (const [held, until] of seen) if (until < at) seen.delete(held);
      if (seen.has(key)) return false;
      seen.set(key, expiresAt);
      return true;
    },
  };
}

/** A JWS this issuer signed, read back: only the claims the checks look at. */
interface Signed {
  iss?: unknown;
  sub?: unknown;
  jti?: unknown;
  exp?: unknown;
  address?: unknown;
  agent?: unknown;
  keys?: unknown;
  aud?: unknown;
  scope?: unknown;
  subject?: unknown;
}

class Refused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function createIssuer(options: IssuerOptions): Issuer {
  const domain = options.domain.toLowerCase();
  const issuer = (options.issuer ?? `https://post.${domain}`).replace(/\/$/, '');
  const now = options.now ?? (() => Date.now());
  const fetcher = options.fetch ?? fetch;
  const replay = options.replay ?? memoryReplayStore(now);
  const organisation = options.organisation ?? domain;
  const nowSeconds = () => Math.floor(now() / 1000);
  const person = options.person
    ? { ...options.person, secret: checkSecret(options.person.secret) }
    : null;
  const upstream = person ? provider(person.oidc, fetcher, now) : null;

  // --- Signing ----------------------------------------------------------------------

  async function jws(header: Record<string, unknown>, payload: unknown): Promise<string> {
    const input = `${encode({ ...header, kid: options.signer.kid })}.${encode(payload)}`;
    const signature = await options.signer.sign(new TextEncoder().encode(input));
    return `${input}.${b64url(signature)}`;
  }

  /** Ours: signed by the current key or one still published, and readable. */
  function readOurs(token: string, typ: string): Signed | null {
    const parts = token.replace(/\s+/g, '').split('.');
    if (parts.length !== 3) return null;
    try {
      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      if (header?.alg !== 'EdDSA' || header?.typ !== typ) return null;
      const key = publishedIssuerKeys().find((candidate) => candidate.kid === header.kid);
      if (!key) return null;
      const signed = verify(
        null,
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({
          key: { kty: 'OKP', crv: 'Ed25519', x: b64url(key.publicKey) },
          format: 'jwk',
        }),
        Buffer.from(parts[2]!, 'base64url'),
      );
      return signed ? JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) : null;
    } catch {
      return null;
    }
  }

  function publishedIssuerKeys(): { kid: string; publicKey: Uint8Array; notAfter: number }[] {
    const current = {
      kid: options.signer.kid,
      publicKey: options.signer.publicKey,
      // The current key is published a year ahead, renewed on every read.
      notAfter: now() + 365 * 86_400_000,
    };
    const retired = (options.retired ?? [])
      .filter((key) => key.notAfter.getTime() > now())
      .map((key) => ({ ...key, notAfter: key.notAfter.getTime() }));
    return [current, ...retired];
  }

  // --- The public documents --------------------------------------------------------

  async function policy(): Promise<string> {
    const agents = await options.directory.agents();
    // An agent's key stays for two policy lifetimes past the read, so a copy
    // fetched just before the agent was removed still lists it no longer.
    const agentNotAfter = iso(now() + 2 * POLICY_MAX_AGE * 1000);
    const keys = [
      ...publishedIssuerKeys().map((key) => ({
        kid: key.kid,
        alg: 'Ed25519',
        pub: b64url(key.publicKey),
        not_after: iso(key.notAfter),
      })),
      ...unique(agents.map((agent) => agent.key)).map((x) => ({
        kid: jwkThumbprint(new Uint8Array(Buffer.from(x, 'base64url'))),
        alg: 'Ed25519',
        pub: x,
        not_after: agentNotAfter,
      })),
    ];
    return (
      JSON.stringify(
        {
          v: 'post0',
          max_age: POLICY_MAX_AGE,
          keys,
          first_contact: { accept: ['known'] },
          identity: { issuer },
          features: [],
        },
        null,
        2,
      ) + '\n'
    );
  }

  /** Web Bot Auth's key directory: the agents' keys, which their `Signature-Agent` points at. */
  async function keyDirectory(): Promise<string> {
    const agents = await options.directory.agents();
    return JSON.stringify({
      keys: unique(agents.map((agent) => agent.key)).map((x) => ({
        kty: 'OKP',
        crv: 'Ed25519',
        kid: jwkThumbprint(new Uint8Array(Buffer.from(x, 'base64url'))),
        x,
        use: 'sig',
      })),
    });
  }

  function jwks() {
    return {
      keys: publishedIssuerKeys().map((key) => ({
        kty: 'OKP',
        crv: 'Ed25519',
        x: b64url(key.publicKey),
        kid: key.kid,
        alg: 'EdDSA',
        use: 'sig',
      })),
    };
  }

  function configuration() {
    return {
      issuer,
      token_endpoint: `${issuer}${PATHS.token}`,
      jwks_uri: `${issuer}${PATHS.jwks}`,
      ...(person
        ? {
            authorization_endpoint: `${issuer}${PATHS.authorize}`,
            grant_types_supported: ['authorization_code', TOKEN_EXCHANGE],
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['openid', 'email'],
          }
        : {
            grant_types_supported: [TOKEN_EXCHANGE],
            // No person signs in here: there is no authorization endpoint.
            response_types_supported: [],
          }),
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      token_endpoint_auth_methods_supported: ['none'],
      claims_supported: [
        'iss',
        'sub',
        'aud',
        'exp',
        'iat',
        'auth_time',
        'jti',
        'email',
        'email_verified',
        'on_behalf_of',
        'kind',
        'operator',
        'standing',
        'card',
        'grant',
        'grants',
        'nonce',
        'cnf',
        'act',
        'sub_type',
      ],
      client_id_metadata_document_supported: (options.clientMetadataHosts ?? []).length > 0,
    };
  }

  function record(): string {
    // Written once: a new agent's key is found by the verifier's unknown-`kid` refetch.
    const id = createHash('sha256')
      .update(`post policy id\0self-hosted\0${domain}`)
      .digest('hex')
      .slice(0, 16);
    return `v=post0; id=${id}`;
  }

  // --- Cards ------------------------------------------------------------------------

  const cardUrl = (address: string) =>
    `${issuer}${PATHS.card}?address=${encodeURIComponent(address)}`;

  /** `src/lib/post/card.ts`'s claims, in `CARD_CLAIMS`' order. */
  function cardClaims(agent: DirectoryAgent) {
    const iat = nowSeconds();
    const created = Date.parse(agent.createdAt);
    const fresh = now() - created < NEW_ADDRESS_DAYS * 86_400_000;
    return {
      iss: issuer,
      sub: agent.sub,
      iat,
      exp: iat + CARD_SECONDS,
      v: 'post0',
      address: agent.address,
      kind: agent.kind,
      on_behalf_of: organisation,
      operator: { domain, verified: true },
      created_at: iso(created),
      keys: [
        {
          type: 'post',
          domain,
          kid: jwkThumbprint(new Uint8Array(Buffer.from(agent.key, 'base64url'))),
        },
      ],
      reputation: { standing: fresh ? 'new' : 'established', since: iso(created).slice(0, 7) },
      url: cardUrl(agent.address),
    };
  }

  async function card(address: string) {
    const wanted = address.trim().toLowerCase();
    const agent = (await options.directory.agents()).find((one) => one.address === wanted);
    if (!agent) return null;
    const claims = cardClaims(agent);
    return { jws: await jws({ alg: 'EdDSA', typ: 'agent-card+jwt' }, claims), card: claims };
  }

  // --- Grants -----------------------------------------------------------------------

  /** Stable for an agent and a rule, so the status read can find it again. */
  const grantId = (agent: DirectoryAgent, rule: GrantRule) =>
    `grt_${createHash('sha256')
      .update(
        `${agent.sub}\0${rule.group}\0${rule.scope.name}\0${rule.subject.type}:${rule.subject.id}`,
      )
      .digest('base64url')
      .slice(0, 22)}`;

  const rulesFor = (agent: DirectoryAgent) =>
    (options.grants ?? []).filter((rule) => agent.groups.includes(rule.group));

  /**
   * `src/lib/post/grant.ts`'s grant, from the organisation (the domain).
   * Signed from the start of today, so each day's copy is the same bytes.
   */
  async function grantsFor(agent: DirectoryAgent) {
    const day = Math.floor(nowSeconds() / 86_400) * 86_400;
    return Promise.all(
      rulesFor(agent).map(async (rule) => {
        const id = grantId(agent, rule);
        const grant = {
          iss: issuer,
          jti: id,
          sub: agent.sub,
          agent: agent.address,
          iat: day,
          exp: day + (rule.days ?? 30) * 86_400,
          v: 'post0',
          grantor: { type: 'organisation', domain, confirmed_by: 'domain' },
          scope: rule.scope,
          ...(rule.audience ? { aud: rule.audience } : {}),
          subject: rule.subject,
          status: `${issuer}${PATHS.grants}/${id}/status`,
        };
        return { id, jws: await jws({ alg: 'EdDSA', typ: 'agent-grant+jwt' }, grant) };
      }),
    );
  }

  /** Whether a grant still holds: its agent still in the directory, still in the rule's group. */
  async function grantStatus(id: string) {
    for (const agent of await options.directory.agents()) {
      for (const rule of rulesFor(agent)) {
        if (grantId(agent, rule) !== id) continue;
        const day = Math.floor(nowSeconds() / 86_400) * 86_400;
        return {
          object: 'grant_status',
          id,
          status: 'active',
          expires_at: iso((day + (rule.days ?? 30) * 86_400) * 1000),
          revoked_at: null,
        };
      }
    }
    return null;
  }

  // --- Sites ------------------------------------------------------------------------

  interface Site {
    host: string;
    redirectUris: string[];
  }
  const clientCache = new Map<string, { at: number; site: Site }>();

  /** The site's host, from the static list or its metadata document. */
  async function clientHost(clientId: string | null): Promise<string> {
    if (!clientId) throw new Refused('invalid_target', "audience is the site's client_id.");
    return (await site(clientId)).host;
  }

  /** A site the issuer knows: listed in the config, or by a metadata document on an allowed host. */
  async function site(clientId: string): Promise<Site> {
    const listed = options.clients?.find((client) => client.client_id === clientId);
    if (listed) {
      return { host: listed.host.toLowerCase(), redirectUris: listed.redirect_uris ?? [] };
    }

    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      throw new Refused('invalid_target', `${clientId} is not a site this issuer knows.`);
    }
    const allowed = (options.clientMetadataHosts ?? []).map((host) => host.toLowerCase());
    if (url.protocol !== 'https:' || !allowed.includes(url.hostname.toLowerCase())) {
      throw new Refused('invalid_target', `${clientId} is not a site this issuer knows.`);
    }
    const held = clientCache.get(clientId);
    if (held && held.at > now() - 300_000) return held.site;

    const response = await fetcher(clientId, {
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    const text = response?.ok ? await response.text() : '';
    let document: { client_id?: unknown; redirect_uris?: unknown } = {};
    try {
      if (text.length <= 64 * 1024) document = JSON.parse(text);
    } catch {
      // Refused below.
    }
    const redirects = Array.isArray(document.redirect_uris)
      ? document.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
      : [];
    if (document.client_id !== clientId || redirects.length === 0) {
      throw new Refused('invalid_target', `${clientId} does not describe a site.`);
    }
    let found: Site;
    try {
      found = { host: new URL(redirects[0]!).hostname.toLowerCase(), redirectUris: redirects };
    } catch {
      throw new Refused('invalid_target', `${clientId} does not describe a site.`);
    }
    clientCache.set(clientId, { at: now(), site: found });
    return found;
  }

  // --- The token exchange ------------------------------------------------------------

  /**
   * `services/pidgeon-sign-in.ts :: exchangeAgentToken` for a `pidgeon id`
   * agent, with the directory in place of the proved domains. In order:
   * the request signed by a key the directory gives an agent, covering what
   * it must, used once; the card ours, current, that agent's and naming that
   * key; the agent live **now** in the identity provider; the grant, when it
   * carries one, ours, that agent's, in force, for this site.
   */
  async function exchange(request: Request, body: string): Promise<Response> {
    const form = new URLSearchParams(body);
    if (form.get('grant_type') !== TOKEN_EXCHANGE) {
      throw new Refused('unsupported_grant_type', `Use ${TOKEN_EXCHANGE}.`);
    }
    const requested = form.get('requested_token_type');
    if (requested && requested !== TOKEN_TYPE_ACCESS && requested !== TOKEN_TYPE_JWT) {
      throw new Refused('invalid_request', `requested_token_type is ${TOKEN_TYPE_JWT} or absent.`);
    }
    const subjectToken = form.get('subject_token');
    if (!subjectToken || form.get('subject_token_type') !== TOKEN_TYPE_JWT) {
      throw new Refused(
        'invalid_request',
        `subject_token is the agent's card, with subject_token_type ${TOKEN_TYPE_JWT}.`,
      );
    }
    const host = await clientHost(form.get('audience'));

    // 1. The signature: a key the directory gives an agent.
    const agents = await options.directory.agents();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => (headers[name] = value));
    const grantHeader = headers[GRANT_HEADER]?.trim() || null;
    let signer: DirectoryAgent | null = null;
    const check = await verifyRequest(
      { method: request.method, url: `${issuer}${PATHS.token}`, headers, body },
      {
        now: now(),
        key: async (keyid) => {
          signer =
            agents.find(
              (agent) =>
                jwkThumbprint(new Uint8Array(Buffer.from(agent.key, 'base64url'))) === keyid,
            ) ?? null;
          return signer ? new Uint8Array(Buffer.from(signer.key, 'base64url')) : null;
        },
      },
    );
    if (!check.ok || !signer) {
      throw new Refused(
        'invalid_grant',
        check.ok || check.reason === 'unsigned'
          ? "Sign the request with the agent's key (@pidgeon-ai/id's signInWithPidgeon)."
          : `The request's signature does not hold (${check.reason}).`,
      );
    }
    const agent = signer as DirectoryAgent;
    const required = [...EXCHANGE_COMPONENTS, ...(grantHeader ? [GRANT_HEADER] : [])];
    const missing = required.find((component) => !check.components.includes(component));
    if (missing) {
      throw new Refused('invalid_grant', `The request's signature must cover ${missing}.`);
    }
    if (check.created < nowSeconds() - EXCHANGE_SIGNATURE_SECONDS) {
      throw new Refused('invalid_grant', "The request's signature is too old. Sign a new one.");
    }
    if (!check.nonce || check.nonce.length > 200) {
      throw new Refused('invalid_request', 'The signature needs a nonce, so it can be used once.');
    }
    if (check.from !== agent.address) {
      throw new Refused('invalid_grant', 'From must be the address of the agent whose key signed.');
    }

    // 2. The card: ours, current, this agent's, naming this key.
    const card = readOurs(subjectToken, 'agent-card+jwt');
    if (!card || card.iss !== issuer) {
      throw new Refused('invalid_grant', 'subject_token is not a card this issuer signed.');
    }
    if (typeof card.exp !== 'number' || card.exp <= nowSeconds()) {
      throw new Refused('invalid_grant', 'The card has expired.');
    }
    if (card.address !== agent.address || card.sub !== agent.sub) {
      throw new Refused('invalid_grant', 'The card is for another agent than the one that signed.');
    }
    if (
      !Array.isArray(card.keys) ||
      !card.keys.some(
        (key: { type?: string; domain?: string; kid?: string }) =>
          key.type === 'post' && key.domain === domain && key.kid === check.keyid,
      )
    ) {
      throw new Refused('invalid_grant', 'The card does not name the key that signed the request.');
    }

    // 3. Live now, asked of the identity provider itself, not the copy above.
    const live = await options.directory.agent(agent.sub);
    if (!live || live.address !== agent.address || live.key !== agent.key) {
      throw new Refused('invalid_grant', "That card's agent is no longer live.");
    }

    // 4. The grant, when it carries one.
    let grant: Record<string, unknown> | undefined;
    if (grantHeader) {
      const presented = grantHeader
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (presented.length !== 1)
        throw new Refused('invalid_request', 'Sign in with one grant at most.');
      const read = readOurs(presented[0]!, 'agent-grant+jwt');
      const reason = !read
        ? 'bad_signature'
        : read.iss !== issuer
          ? 'unknown_issuer'
          : read.sub !== live.sub || read.agent !== live.address
            ? 'wrong_agent'
            : typeof read.exp !== 'number' || read.exp <= nowSeconds()
              ? 'expired'
              : !rulesFor(live).some((rule) => grantId(live, rule) === read.jti)
                ? 'revoked'
                : read.aud && !(host === read.aud || host.endsWith(`.${read.aud}`))
                  ? 'wrong_audience'
                  : null;
      if (reason) throw new Refused('invalid_grant', `The grant does not hold (${reason}).`);
      grant = {
        id: read!.jti,
        scope: read!.scope,
        grantor: { type: 'organisation', domain },
        subject: read!.subject,
        audience: read!.aud ?? null,
        exp: read!.exp,
      };
    }

    // The replay check, last, so a refused request does not spend its nonce.
    if (
      !(await replay.use(
        `${check.keyid} ${check.nonce}`,
        nowSeconds() + EXCHANGE_SIGNATURE_SECONDS,
      ))
    ) {
      throw new Refused(
        'invalid_grant',
        'That signed request has already been used. Sign a new one.',
      );
    }

    const audience = form.get('audience')!;
    const iat = nowSeconds();
    const jti = randomUUID();
    const cnf = { jwk: { kty: 'OKP', crv: 'Ed25519', x: live.key } };
    const fresh = now() - Date.parse(live.createdAt) < NEW_ADDRESS_DAYS * 86_400_000;
    const idToken = await jws(
      { alg: 'EdDSA', typ: 'JWT' },
      {
        iss: issuer,
        aud: audience,
        iat,
        exp: iat + ID_TOKEN_SECONDS,
        auth_time: iat,
        jti,
        sub: live.sub,
        kind: live.kind,
        email: live.address,
        email_verified: true,
        on_behalf_of: organisation,
        operator: { domain, verified: true, shared: false },
        standing: fresh ? 'new' : 'established',
        card: cardUrl(live.address),
        ...(grant ? { grant } : {}),
        cnf,
      },
    );

    // No userinfo here, so without a delegation the ID token is the token issued (RFC 8693 §2.2.1).
    if (requested === TOKEN_TYPE_JWT) {
      if (!grant) {
        throw new Refused(
          'invalid_request',
          `A ${TOKEN_TYPE_JWT} says whom the agent acts for, so it needs a grant in Post-Grant.`,
        );
      }
      const seconds = Math.max(1, Math.min(600, (grant.exp as number) - iat));
      const delegation = await jws(
        { alg: 'EdDSA', typ: 'JWT' },
        {
          iss: issuer,
          aud: audience,
          iat,
          exp: iat + seconds,
          jti,
          sub: domain,
          sub_type: 'organisation',
          act: { iss: issuer, sub: live.sub, email: live.address },
          scope: (grant.scope as { name: string }).name,
          grant: {
            id: grant.id,
            scope: grant.scope,
            subject: grant.subject,
            audience: grant.audience,
            exp: grant.exp,
          },
          cnf,
        },
      );
      return json({
        access_token: delegation,
        issued_token_type: TOKEN_TYPE_JWT,
        token_type: 'Bearer',
        expires_in: seconds,
        id_token: idToken,
      });
    }
    return json({
      access_token: idToken,
      issued_token_type: TOKEN_TYPE_ID,
      token_type: 'N_A',
      expires_in: ID_TOKEN_SECONDS,
      id_token: idToken,
    });
  }

  /** An agent's own grants: a request it signed, as itself. */
  async function listGrants(request: Request): Promise<Response> {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => (headers[name] = value));
    const agents = await options.directory.agents();
    let signer: DirectoryAgent | null = null;
    const check = await verifyRequest(
      { method: request.method, url: `${issuer}${new URL(request.url).pathname}`, headers },
      {
        now: now(),
        key: async (keyid) => {
          signer =
            agents.find(
              (agent) =>
                jwkThumbprint(new Uint8Array(Buffer.from(agent.key, 'base64url'))) === keyid,
            ) ?? null;
          return signer ? new Uint8Array(Buffer.from(signer.key, 'base64url')) : null;
        },
      },
    );
    const agent = signer as DirectoryAgent | null;
    if (!check.ok || !agent || check.from !== agent.address) {
      throw new Refused(
        'invalid_request',
        "Sign the request with the agent's key, From its address.",
        401,
      );
    }
    const grants = await grantsFor(agent);
    return json({ object: 'list', data: grants.map((grant) => ({ object: 'grant', ...grant })) });
  }

  // --- A person ---------------------------------------------------------------------

  interface Flow {
    site: {
      clientId: string;
      redirectUri: string;
      state: string | null;
      nonce: string | null;
      challenge: string;
      scope: string;
    };
    upstream: { state: string; nonce: string; verifier: string };
    exp: number;
  }

  interface Code {
    jti: string;
    clientId: string;
    redirectUri: string;
    challenge: string;
    nonce: string | null;
    scope: string;
    sub: string;
    email: string;
    authTime: number;
    exp: number;
  }

  const callbackUrl = `${issuer}${PATHS.callback}`;
  const random = () => b64url(randomBytes(32));

  function flowCookie(value: string, maxAge: number): string {
    const secure = issuer.startsWith('https:') ? '; Secure' : '';
    return `${FLOW_COOKIE}=${value}; Path=${PATHS.callback}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  }

  /** Back to the site, once its return address is known to be its own. */
  function backToSite(
    redirectUri: string,
    state: string | null,
    values: Record<string, string>,
    headers: Record<string, string> = {},
  ): Response {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(values)) url.searchParams.set(name, value);
    if (state) url.searchParams.set('state', state);
    url.searchParams.set('iss', issuer);
    return new Response(null, {
      status: 302,
      headers: { location: url.toString(), 'cache-control': 'no-store', ...headers },
    });
  }

  /**
   * `GET /api/post/oidc/authorize`, Cloud's parameters. Nothing leaves the
   * issuer until the site is one it knows and `redirect_uri` is one of that
   * site's, compared as strings: a trailing slash, a port or a query makes
   * it another address, and the answer is a page here, never a redirect.
   */
  async function authorize(url: URL): Promise<Response> {
    const params = url.searchParams;
    for (const name of ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge']) {
      if (params.getAll(name).length > 1) return page(`${name} is given more than once`);
    }
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    if (!clientId || !redirectUri) return page('client_id and redirect_uri are required');
    const known = await site(clientId).catch((error) => {
      if (error instanceof Refused) return null;
      throw error;
    });
    if (!known) return page(`${clientId} is not a site this issuer knows`);
    if (!known.redirectUris.includes(redirectUri)) {
      return page(`${redirectUri} is not where ${clientId} receives sign-ins`);
    }

    const state = params.get('state');
    const fail = (error: string, description: string) =>
      backToSite(redirectUri, state, { error, error_description: description });
    if (params.get('response_type') !== 'code') {
      return fail('unsupported_response_type', 'response_type is code.');
    }
    const scope = params.get('scope') ?? '';
    if (!scope.split(' ').includes('openid')) {
      return fail('invalid_scope', 'scope includes openid.');
    }
    const challenge = params.get('code_challenge');
    if (
      !challenge ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      params.get('code_challenge_method') !== 'S256'
    ) {
      return fail('invalid_request', 'PKCE is required: code_challenge with S256.');
    }

    const flow: Flow = {
      site: { clientId, redirectUri, state, nonce: params.get('nonce'), challenge, scope },
      upstream: { state: random(), nonce: random(), verifier: random() },
      exp: nowSeconds() + FLOW_SECONDS,
    };
    const location = await upstream!.authorizeUrl({
      redirectUri: callbackUrl,
      state: flow.upstream.state,
      nonce: flow.upstream.nonce,
      verifier: flow.upstream.verifier,
    });
    return new Response(null, {
      status: 302,
      headers: {
        location,
        'cache-control': 'no-store',
        'set-cookie': flowCookie(seal(person!.secret, 'flow', flow), FLOW_SECONDS),
      },
    });
  }

  /**
   * `GET /api/post/oidc/callback`: the provider's answer, accepted only in
   * the browser that started this sign-in (the sealed cookie's `state`), so
   * a code for one member cannot be dropped into a colleague's browser.
   */
  async function callback(request: Request, url: URL): Promise<Response> {
    const flow = unseal<Flow>(person!.secret, 'flow', cookieOf(request, FLOW_COOKIE));
    const clear = { 'set-cookie': flowCookie('', 0) };
    if (
      !flow ||
      flow.exp <= nowSeconds() ||
      url.searchParams.get('state') !== flow.upstream.state
    ) {
      return page('this sign-in was not started in this browser. Start again from the site', clear);
    }
    const back = (values: Record<string, string>) =>
      backToSite(flow.site.redirectUri, flow.site.state, values, clear);
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) {
      return back({ error: 'access_denied', error_description: 'The person did not sign in.' });
    }

    let who;
    try {
      who = await upstream!.redeem({
        code,
        redirectUri: callbackUrl,
        verifier: flow.upstream.verifier,
        nonce: flow.upstream.nonce,
      });
    } catch (error) {
      if (!(error instanceof ProviderRefused)) throw error;
      return back({ error: 'access_denied', error_description: error.message });
    }
    const domains = (person!.emailDomains ?? [domain]).map((one) => one.toLowerCase());
    if (!domains.includes(who.email.slice(who.email.lastIndexOf('@') + 1))) {
      return back({
        error: 'access_denied',
        error_description: `${who.email} is not an address this issuer signs people in with.`,
      });
    }
    // An agent's address is the agent's: a person given it in the provider is not signed in as it.
    if ((await options.directory.agents()).some((agent) => agent.address === who.email)) {
      return back({
        error: 'access_denied',
        error_description: `${who.email} is an agent's address, not a person's.`,
      });
    }

    const sealed: Code = {
      jti: randomUUID(),
      clientId: flow.site.clientId,
      redirectUri: flow.site.redirectUri,
      challenge: flow.site.challenge,
      nonce: flow.site.nonce,
      scope: flow.site.scope,
      sub: who.sub,
      email: who.email,
      authTime: who.authTime,
      exp: nowSeconds() + CODE_SECONDS,
    };
    return back({ code: seal(person!.secret, 'code', sealed) });
  }

  /** `authorization_code` at the token endpoint, as Cloud's `exchangePersonCode`. */
  async function redeemCode(form: URLSearchParams): Promise<Response> {
    const verifier = form.get('code_verifier');
    const clientId = form.get('client_id');
    if (!verifier || !clientId) {
      throw new Refused('invalid_request', 'code, code_verifier and client_id are required.');
    }
    const code = unseal<Code>(person!.secret, 'code', form.get('code'));
    if (!code) throw new Refused('invalid_grant', 'That code is not valid.');
    if (code.clientId !== clientId) {
      throw new Refused('invalid_grant', 'That code was issued to a different client.');
    }
    // Spent before anything else is checked, so two requests with one code cannot both win.
    if (!(await replay.use(`code ${code.jti}`, code.exp + 60))) {
      throw new Refused('invalid_grant', 'That code has already been used.');
    }
    if (code.exp <= nowSeconds()) throw new Refused('invalid_grant', 'That code has expired.');
    const redirectUri = form.get('redirect_uri');
    if (redirectUri !== null && redirectUri !== code.redirectUri) {
      throw new Refused('invalid_grant', 'redirect_uri does not match the authorization request.');
    }
    if (!pkceHolds(verifier, code.challenge)) {
      throw new Refused('invalid_grant', 'code_verifier does not match the code_challenge.');
    }

    const iat = nowSeconds();
    const idToken = await jws(
      { alg: 'EdDSA', typ: 'JWT' },
      {
        iss: issuer,
        aud: clientId,
        iat,
        exp: iat + ID_TOKEN_SECONDS,
        auth_time: code.authTime,
        ...(code.nonce ? { nonce: code.nonce } : {}),
        jti: randomUUID(),
        sub: code.sub,
        kind: 'person',
        email: code.email,
        email_verified: true,
        // Grants here are the organisation's, to its agents; a person gives none at this issuer.
        grants: [],
      },
    );
    // No userinfo here, so the access token is the ID token.
    return json({
      access_token: idToken,
      token_type: 'Bearer',
      expires_in: ID_TOKEN_SECONDS,
      id_token: idToken,
      scope: code.scope,
    });
  }

  // --- Routes -----------------------------------------------------------------------

  async function handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const path = url.pathname;
    const get = request.method === 'GET' || request.method === 'HEAD';
    try {
      if (get && path === PATHS.configuration) return json(configuration(), 300);
      if (get && path === PATHS.jwks) return json(jwks(), 300);
      if (get && path === PATHS.policy) {
        return text(await policy(), 'application/json', 300);
      }
      if (get && path === PATHS.directory) {
        return text(
          await keyDirectory(),
          'application/http-message-signatures-directory+json',
          300,
        );
      }
      if (get && path === PATHS.card) {
        const found = await card(url.searchParams.get('address') ?? '');
        if (!found)
          return json({ error: 'not_found', error_description: 'No such agent.' }, 0, 404);
        return json(
          { object: 'agent_card', url: found.card.url, jws: found.jws, card: found.card },
          300,
        );
      }
      if (request.method === 'POST' && path === PATHS.token) {
        const body = await request.text();
        const form = new URLSearchParams(body);
        if (person && form.get('grant_type') === 'authorization_code') {
          return await redeemCode(form);
        }
        return await exchange(request, body);
      }
      if (person && get && path === PATHS.authorize) return await authorize(url);
      if (person && get && path === PATHS.callback) return await callback(request, url);
      if (get && path === PATHS.grants) return await listGrants(request);
      const status = /^\/api\/post\/grants\/(grt_[A-Za-z0-9_-]+)\/status$/.exec(path);
      if (get && status) {
        const found = await grantStatus(status[1]!);
        return found ? json(found, 60) : json({ error: 'not_found' }, 0, 404);
      }
      return null;
    } catch (error) {
      if (error instanceof Refused) {
        return json({ error: error.code, error_description: error.message }, 0, error.status);
      }
      throw error;
    }
  }

  async function documents(): Promise<Record<string, string>> {
    const out: Record<string, string> = {
      [PATHS.configuration]: JSON.stringify(configuration(), null, 2),
      [PATHS.jwks]: JSON.stringify(jwks(), null, 2),
      [PATHS.policy]: await policy(),
      [PATHS.directory]: await keyDirectory(),
    };
    return out;
  }

  return { issuer, domain, handle, record, documents, card, grantsFor };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** A page for the person, where a redirect would go somewhere the issuer cannot vouch for. */
function page(reason: string, headers: Record<string, string> = {}): Response {
  return new Response(`This sign-in can’t go on: ${reason}.\n`, {
    status: 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function json(value: unknown, maxAge = 0, status = 200): Response {
  return text(JSON.stringify(value), 'application/json', maxAge, status);
}

function text(body: string, type: string, maxAge = 0, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': type,
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
