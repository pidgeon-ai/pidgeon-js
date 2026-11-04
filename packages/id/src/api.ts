import { signRequest } from './http';
import { b64url, type Identity } from './keys';

/**
 * Pidgeon's issuance API (`/api/id`), for an operator with no account.
 *
 * **The key is the account.** Every request is signed with the operator's
 * key — HTTP Message Signatures with the tag `pidgeon-id`, never
 * `web-bot-auth`, so a signature an agent made for somebody's API is never
 * one the issuance API accepts — and the server finds the domain from the
 * `keyid`. Nothing to sign up for and no token to leak.
 */

export const ISSUANCE_TAG = 'pidgeon-id';
export const DEFAULT_ID_URL = 'https://pidgeon.ai/api/id';

export interface DnsRecord {
  purpose: 'proof' | 'host';
  type: 'TXT' | 'CNAME';
  /** Relative to the domain: `_post`, `post`. */
  name: string;
  value: string;
  /** Whether it is in place now. */
  found: boolean;
}

export interface IdDomain {
  object: 'id_domain';
  domain: string;
  status: 'pending' | 'verified' | 'lapsed';
  kid: string;
  /** `_post` proves the domain; `post` serves its keys and cards at `post.<domain>`. */
  records: DnsRecord[];
  /** One click at the DNS provider, when it offers Domain Connect. */
  setup_url: string | null;
}

export interface AgentCardDocument {
  object: 'agent_card';
  url: string;
  jws: string;
  card: Record<string, unknown> & { address: string; exp: number };
}

export interface IdAgent {
  object: 'id_agent';
  address: string;
  kind: 'agent' | 'service';
  on_behalf_of: string | null;
  created_at: string;
  card_url: string;
}

export class IdApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export class IdClient {
  constructor(
    private readonly identity: Identity,
    private readonly baseUrl: string = DEFAULT_ID_URL,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    const text = body === undefined ? null : JSON.stringify(body);
    const headers: Record<string, string> = text ? { 'content-type': 'application/json' } : {};
    Object.assign(
      headers,
      await signRequest(this.identity, { method, url, headers, body: text, tag: ISSUANCE_TAG }),
    );

    const response = await this.fetcher(url, { method, headers, body: text ?? undefined });
    const json = (await response.json().catch(() => null)) as {
      data?: T;
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok || !json || json.data === undefined) {
      throw new IdApiError(
        response.status,
        json?.error?.code,
        json?.error?.message ?? `Pidgeon answered ${response.status}.`,
      );
    }
    return json.data;
  }

  /** Claim the domain with this key. Idempotent: a second call returns the same records. */
  claim(): Promise<IdDomain> {
    return this.call('POST', '/domains', {
      domain: this.identity.domain,
      public_key: b64url(this.identity.publicKey),
    });
  }

  /** Look at DNS now; `verified` once `_post` says this key's id. */
  check(): Promise<IdDomain> {
    return this.call('POST', '/domains/check', { domain: this.identity.domain });
  }

  issue(input: {
    name: string;
    kind?: 'agent' | 'service';
    on_behalf_of?: string;
  }): Promise<AgentCardDocument> {
    return this.call('POST', '/agents', input);
  }

  list(): Promise<IdAgent[]> {
    return this.call('GET', '/agents');
  }

  revoke(name: string): Promise<{ object: 'id_agent'; address: string; revoked: true }> {
    return this.call('DELETE', `/agents/${encodeURIComponent(name)}`);
  }

  /**
   * Publish `next` as the domain's key, signed by the current one. `proof`
   * is `next`'s own signature over the rotation, so nobody can rotate a
   * domain onto a key they do not hold.
   */
  rotate(next: Identity): Promise<IdDomain> {
    const statement = rotationStatement(this.identity.domain, this.identity.kid, next.kid);
    return this.call('POST', '/keys', {
      public_key: b64url(next.publicKey),
      proof: b64url(next.sign(new TextEncoder().encode(statement))),
    });
  }
}

/** What a new key signs to show it is held by whoever asks for it. The server builds the same. */
export function rotationStatement(domain: string, from: string, to: string): string {
  return `pidgeon id rotate\n${domain}\n${from}\n${to}`;
}
