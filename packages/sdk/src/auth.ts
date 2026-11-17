/**
 * Pidgeon Auth: Sign in with Pidgeon (https://pidgeon.ai).
 *
 * People sign in to your site with any OpenID Connect library: point it at
 * the issuer `https://pidgeon.ai` with the client id and secret you
 * registered, and check the ID token with `verifyIdToken`.
 *
 * Agents sign in with no person present: the agent calls `signInAsAgent`,
 * which exchanges a request signed with its Pidgeon key for an ID token for
 * your site. It then sends that token with every request it signs
 * (`Authorization: Bearer <id_token>`), and `verifyAgentSignIn` checks both:
 * the token is Pidgeon's and for you, and the request is signed with the key
 * the token names (`cnf`), so a copied token is useless on its own.
 */
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';

import {
  directoryUrl,
  keyIdOf,
  sameDirectory,
  signAgentRequest,
  verifyAgentRequest,
  type PublicJwk,
} from './credential.ts';

export const DEFAULT_ISSUER = 'https://pidgeon.ai';
export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const AGENT_KEY_TOKEN = 'urn:pidgeon:params:oauth:token-type:agent-key';
export const ID_TOKEN = 'urn:ietf:params:oauth:token-type:id_token';
export const ID_JAG = 'urn:ietf:params:oauth:token-type:id-jag';

/** What an ID token from Pidgeon says. A person's carries `email` and `name` by scope; an agent's carries `agent`, `reputation`, `pod` and `cnf`. */
export type PidgeonClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  kind: 'person' | 'agent';
  account?: { name: string; slug: string; verification: 'none' | 'domain' | 'kyc' | 'kyb' };
  /** `directory`: where the agent's keys are published; its signed requests must name it as `Signature-Agent`. */
  agent?: { name: string; purpose: string; directory?: string };
  reputation?: 'unverified' | 'new' | 'good' | 'flagged' | 'suspended';
  pod?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
  cnf?: { jwk: PublicJwk };
  /** Under a mandate: the agent acting for the person in `sub` (RFC 8693 §4.1). */
  act?: { sub: string; agent?: PidgeonClaims['agent']; account?: PidgeonClaims['account'] };
  /** Under a mandate: which one, its scope at your site, and when it ends. */
  mandate?: { id: string; scope: string; expires_at: string };
  scope?: string;
  /** Under a test mandate (asked with a test key): `true`. Refuse it in production. */
  test?: true;
};

/**
 * Why a sign-in was not accepted. `refused`: Pidgeon refused the agent's
 * exchange. `invalid_token`: not a valid Pidgeon ID token for you.
 * `not_an_agent`: a person's token, or no `cnf`. `unsigned`: no token or no
 * signature. `wrong_key`: signed with another key than the token names.
 * `wrong_request`: the signature does not cover this request (its method,
 * path or host). `expired`: the signature is too old or dated ahead.
 * `wrong_directory`: `Signature-Agent` is not the agent's own directory.
 * `mandate_ended`: the mandate the token was issued under was stopped or ran
 * out (checked only with `clientSecret`).
 */
export type SignInRefusal =
  | 'refused'
  | 'invalid_token'
  | 'not_an_agent'
  | 'unsigned'
  | 'wrong_key'
  | 'wrong_request'
  | 'expired'
  | 'wrong_directory'
  | 'mandate_ended';

export class SignInError extends Error {
  constructor(
    readonly reason: SignInRefusal,
    message: string,
  ) {
    super(message);
  }
}

const trim = (issuer: string) => issuer.replace(/\/+$/, '');

/**
 * The agent's side: an ID token for one site, for ten minutes. `site` is the
 * site's client id (it tells you, or puts it on its sign-in page); `key` and
 * `directory` are the agent's, as for any signed request.
 */
export async function signInAsAgent(options: {
  site: string;
  key: { kid: string; privateJwk: JsonWebKey };
  directory: string;
  issuer?: string;
  fetch?: typeof fetch;
}): Promise<{ idToken: string; expiresIn: number }> {
  const url = `${trim(options.issuer ?? DEFAULT_ISSUER)}/oauth/token`;
  const signature = await signAgentRequest(new Request(url, { method: 'POST' }), {
    privateJwk: options.key.privateJwk,
    directory: options.directory,
  });
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers: { ...signature, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: TOKEN_EXCHANGE,
      subject_token: options.key.kid,
      subject_token_type: AGENT_KEY_TOKEN,
      audience: options.site,
    }).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new SignInError(
      'refused',
      body.error_description ?? body.error ?? `HTTP ${response.status}`,
    );
  }
  return { idToken: body.access_token, expiresIn: body.expires_in ?? 600 };
}

/**
 * The agent's side, for an MCP server whose authorization server trusts
 * Pidgeon (MCP Enterprise-Managed Authorization): an ID-JAG, five minutes,
 * to present there as a JWT bearer grant. `audience` is that authorization
 * server's issuer, `clientId` your client id there, `resource` the MCP
 * server's resource identifier.
 */
export async function requestIdJag(options: {
  audience: string;
  clientId: string;
  resource?: string;
  scope?: string;
  key: { kid: string; privateJwk: JsonWebKey };
  directory: string;
  issuer?: string;
  fetch?: typeof fetch;
}): Promise<{ idJag: string; expiresIn: number }> {
  const url = `${trim(options.issuer ?? DEFAULT_ISSUER)}/oauth/token`;
  const signature = await signAgentRequest(new Request(url, { method: 'POST' }), {
    privateJwk: options.key.privateJwk,
    directory: options.directory,
  });
  const form = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE,
    requested_token_type: ID_JAG,
    subject_token: options.key.kid,
    subject_token_type: AGENT_KEY_TOKEN,
    audience: options.audience,
    client_id: options.clientId,
  });
  if (options.resource) form.set('resource', options.resource);
  if (options.scope) form.set('scope', options.scope);
  const response = await (options.fetch ?? fetch)(url, {
    method: 'POST',
    headers: { ...signature, 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new SignInError(
      'refused',
      body.error_description ?? body.error ?? `HTTP ${response.status}`,
    );
  }
  return { idJag: body.access_token, expiresIn: body.expires_in ?? 300 };
}

/**
 * The site's side, for any ID token from Pidgeon (a person's or an agent's):
 * signed with Pidgeon's published key, issued by Pidgeon, for your client
 * id, not expired, and with your `nonce` if you sent one.
 */
export async function verifyIdToken(
  idToken: string,
  options: { clientId: string; issuer?: string; nonce?: string; jwks?: JSONWebKeySet },
): Promise<PidgeonClaims> {
  const issuer = trim(options.issuer ?? DEFAULT_ISSUER);
  const keys = options.jwks
    ? createLocalJWKSet(options.jwks)
    : remoteKeys(`${issuer}/.well-known/jwks.json`);
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      issuer,
      audience: options.clientId,
      algorithms: ['RS256'],
      // An ID-JAG (typ oauth-id-jag+jwt) shares the key and the issuer; it is never a sign-in.
      typ: 'JWT',
    });
    if (options.nonce !== undefined && payload.nonce !== options.nonce) {
      throw new Error('The nonce does not match.');
    }
    return payload as unknown as PidgeonClaims;
  } catch (error) {
    throw new SignInError('invalid_token', error instanceof Error ? error.message : String(error));
  }
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

/**
 * The site's side, for an agent's request: the ID token in
 * `Authorization: Bearer`, the request signed with the key that token names,
 * and its `Signature-Agent` the agent's own directory. Answers who the agent
 * is and who stands behind it.
 *
 * With `clientSecret` (your site's), a token issued under a mandate is also
 * checked with Pidgeon (`/oauth/introspect`), so a mandate the person stopped
 * is refused at once instead of when the token expires, up to ten minutes
 * later. One request to Pidgeon per call, only for mandate tokens.
 */
export async function verifyAgentSignIn(
  request: Request,
  options: {
    clientId: string;
    issuer?: string;
    jwks?: JSONWebKeySet;
    clientSecret?: string;
    fetch?: typeof fetch;
  },
): Promise<PidgeonClaims> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!token) throw new SignInError('unsigned', 'Send the ID token as `Authorization: Bearer`.');
  const claims = await verifyIdToken(token, options);
  if (claims.kind !== 'agent' || !claims.cnf?.jwk) {
    throw new SignInError('not_an_agent', 'This token is not an agent’s.');
  }
  const bound = claims.cnf.jwk;
  const boundKid = await keyIdOf(bound);
  const proof = await verifyAgentRequest(request, async (kid) => (kid === boundKid ? bound : null));
  if (!proof.ok) {
    switch (proof.reason) {
      case 'unsigned':
        throw new SignInError('unsigned', 'Sign the request with the key the token was issued to.');
      case 'expired':
        throw new SignInError(
          'expired',
          'The signature has expired, is over five minutes old, or is dated ahead. Sign the request again.',
        );
      case 'unknown_key':
        throw new SignInError(
          'wrong_key',
          'The request must be signed with the key the token was issued to.',
        );
      default:
        throw new SignInError(
          'wrong_request',
          'The signature does not match this request: sign it as it is sent (method, path and host).',
        );
    }
  }
  // Tokens from before `agent.directory` was a claim name the operator by its slug.
  const directory =
    claims.agent?.directory ?? (claims.account?.slug ? directoryUrl(claims.account.slug) : null);
  if (!directory || !sameDirectory(proof.directory, directory)) {
    throw new SignInError(
      'wrong_directory',
      `Signature-Agent must name the agent's own directory${directory ? `, ${directory}` : ''}.`,
    );
  }
  if (claims.mandate && options.clientSecret !== undefined) {
    const url = `${trim(options.issuer ?? DEFAULT_ISSUER)}/oauth/introspect`;
    const response = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as { active?: boolean };
    if (!response.ok) {
      throw new SignInError(
        'refused',
        `Pidgeon did not answer the mandate check (HTTP ${response.status}): check your client secret.`,
      );
    }
    if (body.active !== true) {
      throw new SignInError(
        'mandate_ended',
        'The mandate this token was issued under has been stopped or has run out.',
      );
    }
  }
  return claims;
}
