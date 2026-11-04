import { signRequest } from './http';
import type { Identity } from './keys';

/**
 * Sign in with Pidgeon, from the agent's side: no browser, no password, no
 * person present.
 *
 * 1. **At Pidgeon**, an RFC 8693 token exchange signed with the agent's key:
 *    its card as the subject token, the site's `client_id` as the audience,
 *    and its grant, when it acts under one, in `Post-Grant`. Out comes an ID
 *    token for that site, bound to this key.
 * 2. **At the site**, the ID token as an RFC 7523 JWT-bearer grant, signed
 *    again with the same key, so a copy of the token is no use to anyone
 *    else. The site answers with its own session.
 *
 * The site says where both are: `GET` on its token endpoint answers its
 * issuer and `client_id` (`@pidgeon-ai/sign-in` serves it).
 */

export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const TOKEN_TYPE_JWT = 'urn:ietf:params:oauth:token-type:jwt';

type Fetch = typeof globalThis.fetch;

export interface SignInWithPidgeonInput {
  /** The agent's address, `support-agent@acme.com`. */
  agent: string;
  /** The site's token endpoint for agents, as its button or docs give it. */
  site: string;
  /** A grant the agent acts under (its JWS), when it has one for this site. */
  grant?: string;
  /** The card's compact JWS. Fetched from `post.<domain>` when not given. */
  card?: string;
  /** Where a domain's protocol host answers. Default `https://post.<domain>`; a laptop's differs. */
  postHost?: (domain: string) => string;
  fetch?: Fetch;
}

export interface SiteMetadata {
  issuer: string;
  client_id: string;
  token_endpoint: string;
}

export interface PidgeonSignIn {
  /** What the site answered: its session, and what it learned. */
  site: Record<string, unknown>;
  /** The ID token Pidgeon issued, for reading; the site checked it. */
  idToken: string;
  /** Pidgeon's userinfo token, for as long as the grant lasts and ten minutes at most. */
  accessToken: string;
}

export class SignInError extends Error {
  constructor(
    readonly step: 'site' | 'card' | 'pidgeon',
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

function form(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

/** The site's issuer and `client_id`, from `GET` on its token endpoint. */
export async function siteMetadata(site: string, fetcher: Fetch = fetch): Promise<SiteMetadata> {
  const response = await fetcher(site, { headers: { accept: 'application/json' } });
  const body = await json(response);
  if (!response.ok || typeof body.issuer !== 'string' || typeof body.client_id !== 'string') {
    throw new SignInError(
      'site',
      response.status,
      undefined,
      `${site} does not offer Sign in with Pidgeon.`,
    );
  }
  return { issuer: body.issuer, client_id: body.client_id, token_endpoint: site };
}

/** The agent's card, from its domain's protocol host. */
export async function fetchCard(
  agent: string,
  fetcher: Fetch = fetch,
  postHost: (domain: string) => string = (domain) => `https://post.${domain}`,
): Promise<string> {
  const domain = agent.split('@')[1] ?? '';
  const response = await fetcher(
    `${postHost(domain)}/.well-known/post/card?address=${encodeURIComponent(agent)}`,
  );
  const body = await json(response);
  if (!response.ok || typeof body.jws !== 'string') {
    throw new SignInError(
      'card',
      response.status,
      undefined,
      `${agent} has no card to sign in with.`,
    );
  }
  return body.jws;
}

/** Signs in to `site` as `agent`, in the two steps above. */
export async function signInWithPidgeon(
  identity: Identity,
  input: SignInWithPidgeonInput,
): Promise<PidgeonSignIn> {
  const fetcher = input.fetch ?? fetch;
  const agent = input.agent.trim().toLowerCase();
  const site = await siteMetadata(input.site, fetcher);
  const card = input.card ?? (await fetchCard(agent, fetcher, input.postHost));

  // 1. Pidgeon: the card and the grant, for this site, signed with the agent's key.
  const discovery = await json(
    await fetcher(`${site.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`),
  );
  const tokenEndpoint = discovery.token_endpoint;
  if (typeof tokenEndpoint !== 'string') {
    throw new SignInError('pidgeon', 0, undefined, `${site.issuer} has no token endpoint.`);
  }
  const exchange = form({
    grant_type: TOKEN_EXCHANGE,
    subject_token: card,
    subject_token_type: TOKEN_TYPE_JWT,
    audience: site.client_id,
  });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  const issued = await fetcher(tokenEndpoint, {
    method: 'POST',
    headers: {
      ...headers,
      ...(await signRequest(identity, {
        method: 'POST',
        url: tokenEndpoint,
        headers,
        body: exchange,
        agent,
        grants: input.grant ? [input.grant] : undefined,
      })),
    },
    body: exchange,
  });
  const tokens = await json(issued);
  if (!issued.ok || typeof tokens.id_token !== 'string') {
    throw new SignInError(
      'pidgeon',
      issued.status,
      tokens.error as string | undefined,
      (tokens.error_description as string | undefined) ?? `Pidgeon answered ${issued.status}.`,
    );
  }

  // 2. The site: the ID token as a JWT-bearer grant, signed with the same key.
  const bearer = form({ grant_type: JWT_BEARER, assertion: tokens.id_token });
  const answered = await fetcher(site.token_endpoint, {
    method: 'POST',
    headers: {
      ...headers,
      ...(await signRequest(identity, {
        method: 'POST',
        url: site.token_endpoint,
        headers,
        body: bearer,
        agent,
      })),
    },
    body: bearer,
  });
  const session = await json(answered);
  if (!answered.ok) {
    throw new SignInError(
      'site',
      answered.status,
      session.error as string | undefined,
      (session.error_description as string | undefined) ?? `The site answered ${answered.status}.`,
    );
  }
  return {
    site: session,
    idToken: tokens.id_token,
    accessToken: tokens.access_token as string,
  };
}
