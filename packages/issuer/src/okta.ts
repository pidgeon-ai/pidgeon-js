import { createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';

import { onePerAddress, type Directory, type DirectoryAgent } from './directory';
import { withBackoff } from './rate-limit';

/**
 * Okta as the directory: the issuer reads the org's Apps API and never
 * writes it.
 *
 * **An agent is an active OAuth 2.0 service app** (`application_type:
 * service`, client credentials) whose `profile` names it. An Okta group
 * holds people, never apps, so the agent's groups live in the profile too,
 * as Okta's own `profile.groupallowlist` pattern does:
 *
 * ```json
 * "profile": { "pidgeon": { "key": "<x>", "address": "support@acme.com", "kind": "agent", "groups": ["refunds"] } }
 * ```
 *
 * A deactivated app (`status: INACTIVE`) or a deleted one is not an agent
 * from its next sign-in. The card's `sub` is the app's id; `created_at` is
 * the app's `created`.
 *
 * **One key, two uses is not possible here.** An Okta app's JWKS takes RSA
 * and EC keys only, not Ed25519, so the agent authenticates to Okta with
 * another key and names its Pidgeon key in the profile.
 *
 * **The issuer's own credential** is a service app of its own, granted the
 * `okta.apps.read` scope and a read-only admin role (Okta requires both).
 * Okta takes only Private Key JWT for its own scopes, so the issuer signs a
 * client assertion with an RSA or P-256 key whose public half is in that
 * app's JWKS; the private half comes from the environment.
 */
export interface OktaOptions {
  /** The org: `https://acme.okta.com`. */
  org: string;
  /** The issuer's own service app. */
  clientId: string;
  /** Its RSA or P-256 private key, PEM, for the client assertion. */
  privateKey: string | KeyObject;
  /** That key's `kid` in the app's JWKS, when the app has more than one. */
  keyId?: string;
  /** The domain agents' addresses are at. */
  domain: string;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch, for tests. */
  now?: () => number;
}

interface OktaApp {
  id: string;
  status?: string;
  created?: string;
  settings?: { oauthClient?: { application_type?: string } };
  profile?: {
    pidgeon?: { key?: unknown; address?: unknown; kind?: unknown; groups?: unknown };
  };
}

export const OKTA_SCOPE = 'okta.apps.read';

export function oktaDirectory(options: OktaOptions): Directory {
  const org = options.org.replace(/\/$/, '');
  const domain = options.domain.toLowerCase();
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  const privateKey =
    typeof options.privateKey === 'string'
      ? createPrivateKey(options.privateKey)
      : options.privateKey;
  const alg =
    privateKey.asymmetricKeyType === 'rsa'
      ? 'RS256'
      : privateKey.asymmetricKeyType === 'ec' &&
          privateKey.asymmetricKeyDetails?.namedCurve === 'prime256v1'
        ? 'ES256'
        : null;
  if (!alg) throw new Error("Okta's client assertion is signed with an RSA or P-256 key.");
  let token: { value: string; until: number } | null = null;

  /** RFC 7523 client authentication, as Okta's org authorization server takes it. */
  function assertion(audience: string): string {
    const at = Math.floor(now() / 1000);
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${b64({ alg, typ: 'JWT', ...(options.keyId ? { kid: options.keyId } : {}) })}.${b64(
      {
        iss: options.clientId,
        sub: options.clientId,
        aud: audience,
        iat: at,
        exp: at + 300,
        jti: randomUUID(),
      },
    )}`;
    const signature = sign(
      'sha256',
      Buffer.from(input),
      alg === 'ES256' ? { key: privateKey, dsaEncoding: 'ieee-p1363' } : privateKey,
    );
    return `${input}.${signature.toString('base64url')}`;
  }

  async function accessToken(): Promise<string> {
    if (token && token.until > now()) return token.value;
    const endpoint = `${org}/oauth2/v1/token`;
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: OKTA_SCOPE,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion(endpoint),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new Error(
        `Okta refused the issuer's app ${options.clientId} (${response.status}${body.error_description ? `: ${body.error_description}` : ''}).`,
      );
    }
    token = { value: body.access_token, until: now() + ((body.expires_in ?? 120) - 60) * 1000 };
    return token.value;
  }

  async function api(url: string): Promise<Response> {
    const bearer = await accessToken();
    const response = await withBackoff(
      () =>
        fetcher(url, {
          headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        }),
      now,
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Okta answered ${response.status} for ${new URL(url).pathname}.`);
    }
    return response;
  }

  function agentOf(app: OktaApp): DirectoryAgent | null {
    if (app.status !== 'ACTIVE') return null;
    if (app.settings?.oauthClient?.application_type !== 'service') return null;
    const pidgeon = app.profile?.pidgeon;
    const key = typeof pidgeon?.key === 'string' ? pidgeon.key.trim() : '';
    if (!key || Buffer.from(key, 'base64url').length !== 32) return null;
    const address =
      typeof pidgeon?.address === 'string' ? pidgeon.address.trim().toLowerCase() : '';
    if (!address.endsWith(`@${domain}`)) return null;
    return {
      sub: app.id,
      address,
      kind: pidgeon?.kind === 'service' ? 'service' : 'agent',
      key,
      groups: Array.isArray(pidgeon?.groups)
        ? pidgeon.groups.filter((group): group is string => typeof group === 'string')
        : [],
      createdAt: new Date(app.created ? Date.parse(app.created) : now()).toISOString(),
    };
  }

  /** The `next` link of an Okta page, kept on the org's own origin. */
  function nextPage(response: Response): string | null {
    for (const part of (response.headers.get('link') ?? '').split(',')) {
      const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
      if (match && new URL(match[1]!).origin === new URL(org).origin) return match[1]!;
    }
    return null;
  }

  return {
    async agents() {
      const agents: DirectoryAgent[] = [];
      let url: string | null =
        `${org}/api/v1/apps?filter=${encodeURIComponent('status eq "ACTIVE"')}&limit=200`;
      for (let pages = 0; url && pages < 100; pages++) {
        const response = await api(url);
        for (const app of ((await response.json()) as OktaApp[]) ?? []) {
          const agent = agentOf(app);
          if (agent) agents.push(agent);
        }
        url = nextPage(response);
      }
      return onePerAddress(agents);
    },
    async agent(sub) {
      const response = await api(`${org}/api/v1/apps/${encodeURIComponent(sub)}`);
      if (response.status === 404) return null;
      const agent = agentOf((await response.json()) as OktaApp);
      return agent?.sub === sub ? agent : null;
    },
  };
}
