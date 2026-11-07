import { onePerAddress, type Directory, type DirectoryAgent } from './directory';
import { withBackoff } from './rate-limit';

/**
 * Auth0 as the directory: the issuer reads the tenant's Management API and
 * never writes it.
 *
 * **An agent is a machine-to-machine application** (`app_type:
 * non_interactive`) whose `client_metadata` says so. Auth0 metadata keys
 * cannot hold a dot, so the names are Keycloak's with an underscore:
 *
 * | `client_metadata`  | Becomes                                                       |
 * | ------------------ | ------------------------------------------------------------- |
 * | `pidgeon_key`      | the agent's Ed25519 public key (`x`, base64url); required     |
 * | `pidgeon_address`  | its address, at the issuer's domain; required                 |
 * | `pidgeon_kind`     | `agent` (default) or `service`                                |
 * | `pidgeon_groups`   | comma-separated, what the config's `grants` map               |
 * | `pidgeon_disabled` | `true`: not an agent, from its next sign-in                    |
 *
 * **Disabling.** An Auth0 application has no enabled switch, so an agent
 * is disabled with `pidgeon_disabled` or by deleting the application.
 * Whoever holds `update:clients` can set or clear it, so it is exactly as
 * strong as that permission, the same people who could change its key.
 *
 * **One key, two uses is not possible here.** Auth0's Private Key JWT takes
 * RS256, RS384 and PS256 with RSA keys only, not Ed25519, so the agent
 * authenticates to Auth0 some other way and names its Pidgeon key in
 * `pidgeon_key`.
 *
 * The card's `sub` is the `client_id`, which Auth0 generates and never lets
 * anyone change; its documentation does not say whether a deleted
 * application's id can come back. `created_at` is the application's.
 *
 * **The issuer's own credential** is a machine-to-machine application
 * authorized for the Management API with `read:clients` only: never
 * `read:client_keys` or `read:client_credentials`, which expose secrets.
 * Its secret comes from the environment.
 */
export interface Auth0Options {
  /** The tenant's domain: `acme.eu.auth0.com`, or its custom domain. */
  tenant: string;
  /** The issuer's own application. */
  clientId: string;
  clientSecret: string;
  /** The domain agents' addresses are at. */
  domain: string;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch, for tests. */
  now?: () => number;
}

interface Auth0Client {
  client_id: string;
  app_type?: string;
  created_at?: string;
  client_metadata?: Record<string, string | undefined>;
}

const PER_PAGE = 100;

export function auth0Directory(options: Auth0Options): Directory {
  const base = `https://${options.tenant.replace(/^https:\/\//, '').replace(/\/$/, '')}`;
  const domain = options.domain.toLowerCase();
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  let token: { value: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.until > now()) return token.value;
    const response = await fetcher(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
        audience: `${base}/api/v2/`,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !body.access_token) {
      throw new Error(
        `Auth0 refused the issuer's application ${options.clientId} (${response.status}).`,
      );
    }
    // A minute early, so a token is never sent as it expires.
    token = { value: body.access_token, until: now() + ((body.expires_in ?? 120) - 60) * 1000 };
    return token.value;
  }

  async function management<T>(path: string): Promise<T | null> {
    const bearer = await accessToken();
    const response = await withBackoff(
      () =>
        fetcher(`${base}/api/v2${path}`, {
          headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
        }),
      now,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Auth0 answered ${response.status} for ${path}.`);
    return (await response.json()) as T;
  }

  function agentOf(client: Auth0Client): DirectoryAgent | null {
    if (client.app_type !== 'non_interactive') return null;
    const metadata = client.client_metadata ?? {};
    if (metadata.pidgeon_disabled?.trim().toLowerCase() === 'true') return null;
    const key = metadata.pidgeon_key?.trim();
    if (!key || Buffer.from(key, 'base64url').length !== 32) return null;
    const address = metadata.pidgeon_address?.trim().toLowerCase();
    if (!address?.endsWith(`@${domain}`)) return null;
    return {
      sub: client.client_id,
      address,
      kind: metadata.pidgeon_kind?.trim() === 'service' ? 'service' : 'agent',
      key,
      groups: (metadata.pidgeon_groups ?? '')
        .split(',')
        .map((group) => group.trim())
        .filter(Boolean),
      // An age Auth0 does not give is treated as new: the card says `new`, never older than it is.
      createdAt: new Date(client.created_at ? Date.parse(client.created_at) : now()).toISOString(),
    };
  }

  async function all(): Promise<DirectoryAgent[]> {
    const agents: DirectoryAgent[] = [];
    for (let page = 0; ; page++) {
      const body = await management<{ clients?: Auth0Client[]; total?: number }>(
        `/clients?app_type=non_interactive&per_page=${PER_PAGE}&page=${page}&include_totals=true`,
      );
      const clients = body?.clients ?? [];
      for (const client of clients) {
        const agent = agentOf(client);
        if (agent) agents.push(agent);
      }
      if (clients.length < PER_PAGE || (page + 1) * PER_PAGE >= (body?.total ?? 0)) break;
    }
    return agents;
  }

  return {
    agents: async () => onePerAddress(await all()),
    async agent(sub) {
      const client = await management<Auth0Client>(`/clients/${encodeURIComponent(sub)}`);
      const agent = client ? agentOf(client) : null;
      return agent?.sub === sub ? agent : null;
    },
  };
}
