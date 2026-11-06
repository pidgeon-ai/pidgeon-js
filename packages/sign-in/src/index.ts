import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'node:crypto';

import { verifyRequest } from '@pidgeon-ai/id';

/**
 * `@pidgeon-ai/sign-in`: Sign in with Pidgeon for a website.
 *
 * Verified AI agents sign up and sign in with no password, no CAPTCHA and no
 * person present, and the site learns who each one is, who it acts for and
 * what it may do. People sign in the ordinary way, as the one their agents
 * act for. Pidgeon is a standard OpenID Connect provider; this package is the
 * few routes a site needs, on Web `Request` and `Response`, with adapters for
 * Next.js (`/next`) and Express (`/express`).
 *
 * **An agent** posts an RFC 7523 JWT-bearer grant to `POST {base}/token`:
 * the ID token Pidgeon issued for this site, in a request signed with the
 * agent's key (HTTP Message Signatures, Web Bot Auth's profile). The ID token
 * names that key in `cnf`, so a copy of it is useless to anyone else, and its
 * `jti` is accepted once. `@pidgeon-ai/id`'s `signInWithPidgeon` does the
 * agent's side. `GET {base}/token` tells it the issuer and `client_id`.
 *
 * **A person** follows `GET {base}/login` (the button), signs in at Pidgeon,
 * and comes back to `GET {base}/callback`: the authorization code flow with
 * PKCE and a nonce.
 *
 * Either way the answer is a session: a cookie for the browser, a bearer
 * token for the agent, both read by `session(request)`.
 */

export const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
/** Pidgeon's production issuer. */
export const PIDGEON_ISSUER = 'https://post.pidgeon.email';

export interface GrantClaim {
  id: string;
  scope: { name: string; label: string; limit?: { amount: number; currency: string } };
  grantor: { type: 'person'; email: string } | { type: 'organisation'; domain: string };
  subject: { type: 'customer' | 'account' | 'order'; id: string };
  audience: string | null;
  exp: number;
}

/** A verified agent: its card's `sub`, never reassigned. Key your accounts on `iss` + `sub`. */
export interface AgentClaims {
  iss: string;
  sub: string;
  kind: 'agent' | 'service';
  email: string;
  email_verified: true;
  on_behalf_of?: string;
  operator: { domain: string; verified: boolean; shared: boolean } | null;
  standing: 'new' | 'established' | 'restricted';
  card: string;
  grant?: GrantClaim;
  cnf: { jwk: { kty: 'OKP'; crv: 'Ed25519'; x: string } };
}

/** A person, with the grants they gave their agents for this site. */
export interface PersonClaims {
  iss: string;
  sub: string;
  kind: 'person';
  email: string;
  email_verified: true;
  grants: {
    id: string;
    agent: { sub: string; address: string };
    scope: GrantClaim['scope'];
    subject: GrantClaim['subject'];
    exp: number;
  }[];
}

export type PidgeonClaims = AgentClaims | PersonClaims;

export interface Session {
  claims: PidgeonClaims;
  /** Unix seconds. */
  exp: number;
}

/** Remembers an ID token's `jti` until it expires; `false` when it was already used. */
export interface ReplayStore {
  use(jti: string, expiresAt: number): boolean | Promise<boolean>;
}

export interface PidgeonSignInOptions {
  /** The site's `client_id` at Pidgeon, from registering it. */
  clientId: string;
  /** The site's origin, as agents and browsers reach it: `https://shop.example`. */
  url: string;
  /** At least 32 characters. Signs the session and the sign-in in progress. */
  secret: string;
  /** Pidgeon's issuer. Default `PIDGEON_ISSUER`. A person signs in here. */
  issuer?: string;
  /**
   * More issuers whose agents may sign in, beside `issuer`: a company's own,
   * self-hosted (`@pidgeon-ai/issuer`), as `https://post.acme.com`. Only
   * these are ever contacted; an ID token from any other is refused before
   * anything is fetched. Default none.
   */
  issuers?: string[];
  /** Where the routes live. Default `/api/auth/pidgeon`. */
  basePath?: string;
  /** Where a person lands after signing in. Default `/`. */
  afterSignIn?: string;
  /** How long a session lasts, in seconds. Default a day. */
  sessionSeconds?: number;
  /**
   * Where used `jti`s are kept. The default is this process's memory: right
   * for one server; several need a shared store (Redis, the database).
   */
  replay?: ReplayStore;
  /** Called once per sign-in, before the session is made: create the account here. Throw to refuse. */
  onSignIn?: (claims: PidgeonClaims) => void | Promise<void>;
  fetch?: typeof fetch;
  /** Seconds since the epoch, for tests. */
  now?: () => number;
}

export class SignInRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const SESSION_COOKIE = 'pidgeon_session';
const FLOW_COOKIE = 'pidgeon_flow';
const SKEW = 60;

const b64url = (bytes: Buffer | Uint8Array | string) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text: string) => Buffer.from(text, 'base64url');

/** RFC 7638: the key's thumbprint, which Web Bot Auth uses as `keyid`. */
export function jwkThumbprint(x: string): string {
  return b64url(createHash('sha256').update(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`).digest());
}

/** An in-memory `ReplayStore`. */
export function memoryReplayStore(
  now: () => number = () => Math.floor(Date.now() / 1000),
): ReplayStore {
  const seen = new Map<string, number>();
  return {
    use(jti, expiresAt) {
      const at = now();
      for (const [key, until] of seen) if (until < at) seen.delete(key);
      if (seen.has(jti)) return false;
      seen.set(jti, expiresAt + SKEW);
      return true;
    },
  };
}

function cookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out.set(part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return out;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const trim = (issuer: string) => issuer.replace(/\/$/, '');

export class PidgeonSignIn {
  readonly issuer: string;
  /** Every issuer an agent may sign in from: `issuer` first, then `issuers`. */
  readonly issuers: string[];
  readonly basePath: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly replay: ReplayStore;
  private discovery = new Map<string, { at: number; value: Discovery }>();
  private keys = new Map<string, { at: number; value: Map<string, string> }>();

  constructor(readonly options: PidgeonSignInOptions) {
    if (!options.secret || options.secret.length < 32) {
      throw new Error('Sign in with Pidgeon needs a secret of 32 characters or more.');
    }
    this.issuer = trim(options.issuer ?? PIDGEON_ISSUER);
    this.issuers = [...new Set([this.issuer, ...(options.issuers ?? []).map(trim)])];
    this.basePath = (options.basePath ?? '/api/auth/pidgeon').replace(/\/$/, '');
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.replay = options.replay ?? memoryReplayStore(this.now);
  }

  private get origin(): string {
    return this.options.url.replace(/\/$/, '');
  }

  /** The button's link. */
  get loginUrl(): string {
    return `${this.basePath}/login`;
  }

  /** Where an agent signs in, absolute: what to tell agents, and what `GET` describes. */
  get tokenUrl(): string {
    return `${this.origin}${this.basePath}/token`;
  }

  get redirectUri(): string {
    return `${this.origin}${this.basePath}/callback`;
  }

  // --- The routes ------------------------------------------------------------------

  /** Answers a request under `basePath`, or null for anything else. */
  async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${this.basePath}/`)) return null;
    const action = url.pathname.slice(this.basePath.length + 1);
    try {
      if (action === 'token' && request.method === 'GET') return this.metadata();
      if (action === 'token' && request.method === 'POST') return await this.agentToken(request);
      if (action === 'login' && request.method === 'GET') return await this.login(url);
      if (action === 'callback' && request.method === 'GET')
        return await this.callback(request, url);
      if (action === 'logout') return this.logout();
      return null;
    } catch (error) {
      if (error instanceof SignInRefused) {
        return Response.json(
          { error: error.code, error_description: error.message },
          { status: error.status, headers: { 'cache-control': 'no-store' } },
        );
      }
      throw error;
    }
  }

  /** The session a request carries: the agent's bearer token or the person's cookie. */
  async session(request: Request): Promise<Session | null> {
    const header = request.headers.get('authorization') ?? '';
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
    return this.readSession(bearer ?? cookies(request).get(SESSION_COOKIE) ?? null);
  }

  /** A session token read back, or null when it is not one of ours or has expired. */
  readSession(token: string | null | undefined): Session | null {
    const value = this.unseal<Session>(token, 'session');
    return value && value.exp > this.now() ? value : null;
  }

  private metadata(): Response {
    return Response.json(
      {
        issuer: this.issuer,
        issuers: this.issuers,
        client_id: this.options.clientId,
        token_endpoint: this.tokenUrl,
        grant_types_supported: [JWT_BEARER],
      },
      { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } },
    );
  }

  /** The agent: an ID token as a JWT-bearer grant, in a request its key signed. */
  private async agentToken(request: Request): Promise<Response> {
    const body = await request.text();
    const form = new URLSearchParams(body);
    if (form.get('grant_type') !== JWT_BEARER) {
      throw new SignInRefused('unsupported_grant_type', `Use ${JWT_BEARER}.`);
    }
    const assertion = form.get('assertion');
    if (!assertion)
      throw new SignInRefused('invalid_request', 'assertion is the ID token from Pidgeon.');

    const claims = await this.verifyIdToken(assertion);
    if (claims.kind === 'person') {
      throw new SignInRefused('invalid_grant', 'A person signs in through the browser, not here.');
    }
    const x = claims.cnf?.jwk?.x;
    if (!x || claims.cnf.jwk.kty !== 'OKP' || claims.cnf.jwk.crv !== 'Ed25519') {
      throw new SignInRefused('invalid_grant', 'The ID token names no key for the agent.');
    }

    // The same key that Pidgeon checked signs this request to us, covering the token itself.
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const check = await verifyRequest(
      { method: request.method, url: `${this.origin}${url.pathname}${url.search}`, headers, body },
      {
        now: this.now() * 1000,
        key: async (keyid) => (keyid === jwkThumbprint(x) ? new Uint8Array(fromB64url(x)) : null),
      },
    );
    if (!check.ok) {
      throw new SignInRefused(
        'invalid_grant',
        `The request is not signed by the agent’s key (${check.reason}).`,
      );
    }
    for (const component of ['@method', '@authority', '@path', 'content-digest']) {
      if (!check.components.includes(component)) {
        throw new SignInRefused(
          'invalid_grant',
          `The request’s signature must cover ${component}.`,
        );
      }
    }
    if (check.from !== null && check.from !== claims.email) {
      throw new SignInRefused(
        'invalid_grant',
        'The request is from another address than the token’s.',
      );
    }

    const jti = (claims as unknown as { jti?: string; exp: number }).jti;
    const exp = (claims as unknown as { exp: number }).exp;
    if (!jti || !(await this.replay.use(jti, exp))) {
      throw new SignInRefused(
        'invalid_grant',
        'That ID token has already been used. Get a new one.',
      );
    }

    await this.options.onSignIn?.(claims);
    const session = this.newSession(claims);
    return Response.json(
      {
        access_token: this.seal(session, 'session'),
        token_type: 'Bearer',
        expires_in: session.exp - this.now(),
        agent: summary(claims),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  /** The person: off to Pidgeon, with PKCE, a state and a nonce kept in a sealed cookie. */
  private async login(url: URL): Promise<Response> {
    const discovery = await this.discover(this.issuer);
    const verifier = b64url(randomBytes(32));
    const flow = {
      state: b64url(randomBytes(16)),
      nonce: b64url(randomBytes(16)),
      verifier,
      returnTo: safePath(url.searchParams.get('return_to')) ?? this.options.afterSignIn ?? '/',
      exp: this.now() + 600,
    };
    const authorize = new URL(discovery.authorization_endpoint);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid email',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        location: authorize.toString(),
        'set-cookie': this.cookie(FLOW_COOKIE, this.seal(flow, 'flow'), 600),
      },
    });
  }

  private async callback(request: Request, url: URL): Promise<Response> {
    const flow = this.unseal<{
      state: string;
      nonce: string;
      verifier: string;
      returnTo: string;
      exp: number;
    }>(cookies(request).get(FLOW_COOKIE), 'flow');
    if (!flow || flow.exp <= this.now() || url.searchParams.get('state') !== flow.state) {
      throw new SignInRefused(
        'invalid_request',
        'That sign-in is not one this site started. Start again.',
      );
    }
    const iss = url.searchParams.get('iss');
    if (iss && iss.replace(/\/$/, '') !== this.issuer) {
      throw new SignInRefused('invalid_request', 'That answer came from another issuer.');
    }
    const error = url.searchParams.get('error');
    if (error) {
      const back = new URL(flow.returnTo, this.origin);
      back.searchParams.set('pidgeon_error', error);
      return new Response(null, {
        status: 302,
        headers: {
          location: back.pathname + back.search,
          'set-cookie': this.cookie(FLOW_COOKIE, '', 0),
        },
      });
    }

    const discovery = await this.discover(this.issuer);
    const response = await this.fetcher(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: url.searchParams.get('code') ?? '',
        code_verifier: flow.verifier,
        client_id: this.options.clientId,
        redirect_uri: this.redirectUri,
      }),
    });
    const tokens = (await response.json().catch(() => ({}))) as {
      id_token?: string;
      error_description?: string;
    };
    if (!response.ok || !tokens.id_token) {
      throw new SignInRefused(
        'invalid_grant',
        tokens.error_description ?? 'Pidgeon did not sign you in.',
      );
    }
    const claims = await this.verifyIdToken(tokens.id_token, { nonce: flow.nonce });

    await this.options.onSignIn?.(claims);
    const headers = new Headers({ location: flow.returnTo });
    headers.append('set-cookie', this.cookie(FLOW_COOKIE, '', 0));
    headers.append(
      'set-cookie',
      this.cookie(
        SESSION_COOKIE,
        this.seal(this.newSession(claims), 'session'),
        this.sessionSeconds,
      ),
    );
    return new Response(null, { status: 302, headers });
  }

  private logout(): Response {
    return new Response(null, {
      status: 302,
      headers: {
        location: this.options.afterSignIn ?? '/',
        'set-cookie': this.cookie(SESSION_COOKIE, '', 0),
      },
    });
  }

  // --- The ID token ----------------------------------------------------------------

  /**
   * An ID token from Pidgeon, checked: from an issuer this site lists (a
   * person's, from `issuer` only), signed by a key in that issuer's JWKS
   * (EdDSA), for this site, current, and with the nonce this site sent when
   * it sent one.
   */
  async verifyIdToken(token: string, expect: { nonce?: string } = {}): Promise<PidgeonClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new SignInRefused('invalid_grant', 'That is not an ID token.');
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(fromB64url(parts[0]!).toString('utf8'));
      claims = JSON.parse(fromB64url(parts[1]!).toString('utf8'));
    } catch {
      throw new SignInRefused('invalid_grant', 'That is not an ID token.');
    }
    if (header.alg !== 'EdDSA' || !header.kid) {
      throw new SignInRefused('invalid_grant', 'The ID token is not signed the way Pidgeon signs.');
    }
    // The issuer is chosen from the list before any key is looked for, so an
    // unlisted one is never contacted. A browser's answer comes from `issuer` only.
    const iss = typeof claims.iss === 'string' ? trim(claims.iss) : '';
    const accepted = expect.nonce !== undefined ? [this.issuer] : this.issuers;
    if (!accepted.includes(iss)) {
      throw new SignInRefused('invalid_grant', 'The ID token is from another issuer.');
    }
    const x = await this.key(iss, header.kid);
    const signed = x
      ? verify(
          null,
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }),
          fromB64url(parts[2]!),
        )
      : false;
    if (!signed)
      throw new SignInRefused('invalid_grant', 'The ID token’s signature does not hold.');

    const now = this.now();
    const aud = claims.aud;
    if (!(
      aud === this.options.clientId ||
      (Array.isArray(aud) && aud.includes(this.options.clientId))
    )) {
      throw new SignInRefused('invalid_grant', 'The ID token is for another site.');
    }
    if (typeof claims.exp !== 'number' || claims.exp + SKEW <= now) {
      throw new SignInRefused('invalid_grant', 'The ID token has expired.');
    }
    if (typeof claims.iat === 'number' && claims.iat > now + SKEW) {
      throw new SignInRefused('invalid_grant', 'The ID token is from the future.');
    }
    if (expect.nonce !== undefined && claims.nonce !== expect.nonce) {
      throw new SignInRefused('invalid_grant', 'The ID token is for another sign-in.');
    }
    if (typeof claims.sub !== 'string' || !claims.kind) {
      throw new SignInRefused('invalid_grant', 'The ID token says nothing about who signed in.');
    }
    return claims as unknown as PidgeonClaims;
  }

  /**
   * An issuer's configuration. It must name the issuer it was fetched from
   * (OpenID Connect Discovery §4.3) and keep its keys on that issuer's
   * origin, so a host that copies another issuer's document cannot point a
   * site at keys of its own.
   */
  private async discover(issuer: string): Promise<Discovery> {
    const held = this.discovery.get(issuer);
    if (held && held.at > this.now() - 300) return held.value;
    const response = await this.fetcher(`${issuer}/.well-known/openid-configuration`);
    if (!response.ok)
      throw new Error(`${issuer} answered ${response.status} for its configuration.`);
    const value = (await response.json()) as Discovery & { issuer?: string };
    if (typeof value.issuer !== 'string' || trim(value.issuer) !== issuer) {
      throw new SignInRefused('invalid_grant', `${issuer}'s configuration names another issuer.`);
    }
    if (!sameOrigin(value.jwks_uri, issuer)) {
      throw new SignInRefused('invalid_grant', `${issuer}'s keys are not on its own host.`);
    }
    this.discovery.set(issuer, { at: this.now(), value });
    return value;
  }

  /** A key from the issuer's JWKS by `kid`, fetched again once when the `kid` is new (a rotation). */
  private async key(issuer: string, kid: string): Promise<string | null> {
    const held = this.keys.get(issuer);
    const fresh = held && held.at > this.now() - 300;
    if (!fresh || !held!.value.has(kid)) {
      if (fresh && held!.at > this.now() - 10) return null;
      const discovery = await this.discover(issuer);
      const response = await this.fetcher(discovery.jwks_uri);
      const jwks = (await response.json().catch(() => ({ keys: [] }))) as {
        keys?: { kid?: string; x?: string; kty?: string; crv?: string }[];
      };
      const value = new Map<string, string>();
      for (const key of jwks.keys ?? []) {
        if (key.kid && key.x && key.kty === 'OKP' && key.crv === 'Ed25519')
          value.set(key.kid, key.x);
      }
      this.keys.set(issuer, { at: this.now(), value });
    }
    return this.keys.get(issuer)!.value.get(kid) ?? null;
  }

  // --- Sessions --------------------------------------------------------------------

  private get sessionSeconds(): number {
    return this.options.sessionSeconds ?? 86_400;
  }

  private newSession(claims: PidgeonClaims): Session {
    return { claims, exp: this.now() + this.sessionSeconds };
  }

  private seal(value: unknown, purpose: string): string {
    const payload = b64url(JSON.stringify(value));
    return `${payload}.${this.mac(purpose, payload)}`;
  }

  private unseal<T>(token: string | null | undefined, purpose: string): T | null {
    if (!token) return null;
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const want = Buffer.from(this.mac(purpose, payload));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      return JSON.parse(fromB64url(payload).toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  private mac(purpose: string, payload: string): string {
    return createHmac('sha256', this.options.secret)
      .update(`${purpose}.${payload}`)
      .digest('base64url');
  }

  private cookie(name: string, value: string, maxAge: number): string {
    const secure = this.origin.startsWith('https:') ? '; Secure' : '';
    const path = name === FLOW_COOKIE ? this.basePath : '/';
    return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  }
}

function sameOrigin(url: unknown, issuer: string): boolean {
  try {
    return typeof url === 'string' && new URL(url).origin === new URL(issuer).origin;
  } catch {
    return false;
  }
}

/** A path on this site, never another origin. */
function safePath(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : null;
}

/** What the site's answer tells the agent back: who it signed in as. */
function summary(claims: AgentClaims) {
  return {
    sub: claims.sub,
    address: claims.email,
    acts_for: actsFor(claims),
    scope: claims.grant?.scope ?? null,
  };
}

/** Who an agent acts for here: its grant's grantor, else what its card says, else nobody named. */
export function actsFor(claims: AgentClaims): string | null {
  const grantor = claims.grant?.grantor;
  if (grantor) return grantor.type === 'person' ? grantor.email : grantor.domain;
  return claims.on_behalf_of ?? null;
}

export function pidgeonSignIn(options: PidgeonSignInOptions): PidgeonSignIn {
  return new PidgeonSignIn(options);
}

/** The button, as HTML, for a page with no framework. */
export function signInButtonHtml(
  href = '/api/auth/pidgeon/login',
  label = 'Sign in with Pidgeon',
): string {
  const escape = (value: string) =>
    value.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
    );
  return `<a href="${escape(href)}" class="pidgeon-sign-in" style="display:inline-flex;align-items:baseline;gap:.3em;padding:.6em 1em;border:1px solid currentColor;border-radius:.5em;font:inherit;text-decoration:none;color:inherit"><svg viewBox="31.3 18.4 163.1 137.6" width="0.863em" height="0.728em" aria-hidden="true" fill="none" style="flex:none;overflow:visible"><path d="${PIDGEON_FIGURE}" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></svg>${escape(label)}</a>`;
}

/**
 * Sign in with Pidgeon's symbol: the Pidgeon figure before the label, in the
 * page's own ink (design-language decision 42, PDL §63; Patrick, 6 November:
 * "this should be the symbol of SIWP"). The figure is `compactSpiralPath()`
 * from `src/lib/brand/mark-path.ts`, written out because a package cannot
 * import the app; `sign-in-button.test.ts` holds the two equal, and the
 * Python twin (`pidgeon.sign_in`) carries the same string.
 */
export const PIDGEON_FIGURE =
  'M177.7 141.3L182.0 128.2L184.1 114.8L184.1 101.5L182.0 88.5L178.0 76.2L172.1 64.8L164.7 54.7L155.9 46.1L146.0 39.0L135.2 33.7L124.0 30.2L112.6 28.6L101.2 28.8L90.3 30.8L79.9 34.4L70.5 39.5L62.1 45.9L55.0 53.4L49.3 61.8L45.1 70.8L42.5 80.2L41.4 89.7L41.8 99.0L43.6 107.9L46.8 116.3L51.1 123.8L56.5 130.4L62.7 136.0L69.6 140.3L76.9 143.4L84.4 145.3L91.9 145.9L99.2 145.3L106.1 143.6L112.5 140.9L118.2 137.3L123.0 132.9L127.0 128.0L130.0 122.6L132.0 117.0L133.1 111.4L133.2 105.9L132.4 100.6L130.8 95.7L128.5 91.3L125.6 87.5L122.3 84.4L118.7 82.0L114.8 80.3L111.0 79.4L107.2 79.1L103.6 79.6L100.3 80.5L97.5 82.0L95.1 83.9L93.2 86.0L91.8 88.3L91.0 90.6';
