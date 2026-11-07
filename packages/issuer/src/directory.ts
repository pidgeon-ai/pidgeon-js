/**
 * Who the agents are. The issuer holds no list of its own: the company's
 * identity provider is the record (`keycloak.ts`, `auth0.ts`, `okta.ts`), read
 * through this interface, and the issuer turns what it says into cards,
 * keys in the policy, and grants. Pidgeon is the format and the check,
 * never the identity provider.
 */
export interface DirectoryAgent {
  /** Never reassigned: the card's `sub`. Keycloak's is the service account's id. */
  sub: string;
  /** `name@<the issuer's domain>`, lower-cased. */
  address: string;
  kind: 'agent' | 'service';
  /** The agent's own Ed25519 public key, base64url (`x`). The agent holds the private half. */
  key: string;
  /** Groups or roles, which the config's `grants` map to grants. */
  groups: string[];
  /** When the agent was made, ISO 8601. */
  createdAt: string;
}

export interface Directory {
  /** Every live agent: for the policy, the key directory and the cards anyone reads. */
  agents(): Promise<DirectoryAgent[]>;
  /**
   * One agent, read now, never from a copy: the token endpoint asks this
   * before it signs anything, so an agent disabled a second ago fails its
   * next sign-in. Null when it is not a live agent.
   */
  agent(sub: string): Promise<DirectoryAgent | null>;
}

/**
 * Each address once. Where the identity provider lets two apps name the
 * same address, neither is an agent: a member who claims a colleague's
 * agent's address blocks it (denial, fixed in the identity provider by
 * whoever may edit apps) but can never sign in as it.
 */
export function onePerAddress(agents: DirectoryAgent[]): DirectoryAgent[] {
  const count = new Map<string, number>();
  for (const agent of agents) count.set(agent.address, (count.get(agent.address) ?? 0) + 1);
  return agents.filter((agent) => count.get(agent.address) === 1);
}

/**
 * Agents listed in the config: for a laptop, a test, or a company that
 * keeps its agents in a file under change control. Live until removed.
 */
export function staticDirectory(agents: DirectoryAgent[]): Directory {
  const list = agents.map((agent) => ({ ...agent, address: agent.address.toLowerCase() }));
  return {
    agents: async () => list,
    agent: async (sub) => list.find((agent) => agent.sub === sub) ?? null,
  };
}

/**
 * A directory read through a short-lived copy, for the reads anyone can
 * make (the policy, cards): the identity provider is asked at most once per
 * `seconds`. `agent(sub)` is never cached.
 */
export function cachedDirectory(
  inner: Directory,
  seconds = 60,
  now: () => number = () => Date.now(),
): Directory {
  let held: { at: number; value: Promise<DirectoryAgent[]> } | null = null;
  return {
    agents() {
      if (!held || held.at <= now() - seconds * 1000) {
        const value = inner.agents();
        held = { at: now(), value };
        // A failed read is not kept: the next one asks again.
        value.catch(() => {
          if (held?.value === value) held = null;
        });
      }
      return held.value;
    },
    agent: (sub) => inner.agent(sub),
  };
}
