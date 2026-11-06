import type { Directory, DirectoryAgent } from './directory';

/**
 * Keycloak as the directory: the company's identity provider says who its
 * agents are, and the issuer reads it, never writes it.
 *
 * **An agent is a Keycloak client with a service account**, the identity
 * Keycloak already gives software, whose service-account user is in the
 * agents group (`agents` by default). The client's attributes say the rest:
 *
 * | Client attribute  | Becomes                                                   |
 * | ----------------- | --------------------------------------------------------- |
 * | `pidgeon.key`     | the agent's Ed25519 public key (`x`, base64url)           |
 * | `pidgeon.address` | its address; default `<clientId>@<domain>`                |
 * | `pidgeon.kind`    | `agent` (default) or `service`                            |
 *
 * **One key, two uses.** Keycloak 26 authenticates a client by a signed
 * JWT under an Ed25519 key in its JWKS (`client-jwt`, signing algorithm
 * EdDSA; tried against 26.4.2, 6 November). A client set up that way needs
 * no `pidgeon.key`: its one Ed25519 key in `jwks.string` is read instead,
 * and the key the agent signs in to sites with is the one it signs in to
 * Keycloak with. `pidgeon.key` wins when both are there.
 *
 * The card's `sub` is the service-account user's id, a UUID Keycloak never
 * reuses; its groups are the ones the config's `grants` map; `created_at`
 * is when that user was made. A client that is disabled, has no service
 * account, no key, or has left the group is not an agent.
 *
 * **The issuer's own credential** is a confidential client of its own with
 * a service account holding `realm-management`'s `view-clients` and
 * `view-users`, nothing that writes. Its secret comes from the environment.
 *
 * Calls are Keycloak's Admin REST API (`/admin/realms/{realm}/…`) and its
 * token endpoint, as documented for Keycloak 26.
 */
export interface KeycloakOptions {
  /** Where Keycloak answers: `https://sso.acme.internal`. */
  url: string;
  realm: string;
  /** The issuer's own client. */
  clientId: string;
  clientSecret: string;
  /** The domain agents' addresses are at. */
  domain: string;
  /** The group whose members are agents. Default `agents`. */
  group?: string;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch, for tests. */
  now?: () => number;
}

interface KeycloakClient {
  id: string;
  clientId: string;
  enabled?: boolean;
  serviceAccountsEnabled?: boolean;
  attributes?: Record<string, string | undefined>;
}

interface KeycloakUser {
  id: string;
  /** `service-account-<clientId>`, lower-cased, for a service account. */
  username?: string;
  /** Absent for a user imported without one. */
  createdTimestamp?: number;
  enabled?: boolean;
}

/** Keycloak names a client's service-account user this, and says so nowhere else on the user. */
const SERVICE_ACCOUNT_PREFIX = 'service-account-';

const ATTRIBUTES = { key: 'pidgeon.key', address: 'pidgeon.address', kind: 'pidgeon.kind' };

/** The agent's key: `pidgeon.key`, else the one Ed25519 key Keycloak authenticates the client with. */
function keyOf(client: KeycloakClient): string | null {
  const own = client.attributes?.[ATTRIBUTES.key]?.trim();
  if (own) return own;
  if (client.attributes?.['use.jwks.string'] !== 'true') return null;
  try {
    const jwks = JSON.parse(client.attributes['jwks.string'] ?? '') as {
      keys?: { kty?: string; crv?: string; x?: string }[];
    };
    const ed25519 = (jwks.keys ?? []).filter((key) => key.kty === 'OKP' && key.crv === 'Ed25519');
    return ed25519.length === 1 && ed25519[0]!.x ? ed25519[0]!.x : null;
  } catch {
    return null;
  }
}

export function keycloakDirectory(options: KeycloakOptions): Directory {
  const base = options.url.replace(/\/$/, '');
  const realm = encodeURIComponent(options.realm);
  const group = options.group ?? 'agents';
  const domain = options.domain.toLowerCase();
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => Date.now());
  let token: { value: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.until > now()) return token.value;
    const response = await fetcher(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!response.ok || !body.access_token) {
      throw new Error(
        `Keycloak refused the issuer's client ${options.clientId} (${response.status}).`,
      );
    }
    // Ten seconds early, so a token is never sent as it expires.
    token = { value: body.access_token, until: now() + ((body.expires_in ?? 60) - 10) * 1000 };
    return token.value;
  }

  async function admin<T>(path: string): Promise<T | null> {
    const response = await fetcher(`${base}/admin/realms/${realm}${path}`, {
      headers: { authorization: `Bearer ${await accessToken()}`, accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Keycloak answered ${response.status} for ${path}.`);
    return (await response.json()) as T;
  }

  /** The agent a client is, or null when it is not one. */
  async function agentOf(client: KeycloakClient): Promise<DirectoryAgent | null> {
    const key = keyOf(client);
    if (!client.enabled || !client.serviceAccountsEnabled || !key) return null;
    if (Buffer.from(key, 'base64url').length !== 32) return null;

    const user = await admin<KeycloakUser>(
      `/clients/${encodeURIComponent(client.id)}/service-account-user`,
    );
    if (!user || user.enabled === false) return null;
    const groups =
      (await admin<{ name: string; path?: string }[]>(
        `/users/${encodeURIComponent(user.id)}/groups`,
      )) ?? [];
    const names = groups.map((one) => one.name);
    if (!names.includes(group)) return null;

    const address = (
      client.attributes?.[ATTRIBUTES.address]?.trim() || `${client.clientId}@${domain}`
    ).toLowerCase();
    if (!address.endsWith(`@${domain}`)) return null;
    return {
      sub: user.id,
      address,
      kind: client.attributes?.[ATTRIBUTES.kind] === 'service' ? 'service' : 'agent',
      key,
      groups: names,
      // An age Keycloak does not know is treated as new: the card says `new`, never older than it is.
      createdAt: new Date(user.createdTimestamp ?? now()).toISOString(),
    };
  }

  return {
    async agents() {
      const clients = (await admin<KeycloakClient[]>('/clients?first=0&max=1000')) ?? [];
      const candidates = clients.filter((client) => keyOf(client) !== null);
      const agents = await Promise.all(candidates.map(agentOf));
      return agents.filter((agent): agent is DirectoryAgent => agent !== null);
    },

    /**
     * The user's record does not name its client (only a realm export
     * does), so the client is found by the username Keycloak gives every
     * service account, and confirmed: that client's service-account user
     * must be this `sub`, or it is nobody.
     */
    async agent(sub) {
      const user = await admin<KeycloakUser>(`/users/${encodeURIComponent(sub)}`);
      const name = user?.username?.startsWith(SERVICE_ACCOUNT_PREFIX)
        ? user.username.slice(SERVICE_ACCOUNT_PREFIX.length)
        : null;
      if (!name) return null;
      let client =
        (await admin<KeycloakClient[]>(`/clients?clientId=${encodeURIComponent(name)}`))?.[0] ??
        null;
      // Usernames are lower-cased; a clientId need not be.
      client ??=
        (await admin<KeycloakClient[]>('/clients?first=0&max=1000'))?.find(
          (candidate) => candidate.clientId.toLowerCase() === name,
        ) ?? null;
      const agent = client ? await agentOf(client) : null;
      return agent?.sub === sub ? agent : null;
    },
  };
}
