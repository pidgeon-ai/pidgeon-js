/**
 * The four calls the channel makes to Pidgeon, over `fetch`.
 *
 * Not `@pidgeon-ai/sdk`: an OpenClaw plugin is installed into the Gateway's
 * own `node_modules`, and four endpoints do not earn a dependency there.
 * The shapes are the public contract's (`public/openapi.json`), cut to the
 * fields read here.
 */

export interface Mailbox {
  email: string;
  name: string | null;
}

export interface FirewallSignal {
  kind: string;
  detail: string;
}

export interface Firewall {
  verdict: 'clean' | 'suspicious';
  signals: FirewallSignal[];
  clean_text: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

/**
 * What the receiving transport said about the sending domain: `"pass"`,
 * `"fail"` and the rest, lowercased. Null is "not reported", not "failed".
 */
export interface Authentication {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

export interface Message {
  id: string;
  thread_id: string;
  identity_id: string;
  identity: string | null;
  direction: string;
  from: Mailbox;
  to: Mailbox[];
  subject: string | null;
  text: string | null;
  reply_text: string | null;
  is_spam: boolean;
  authentication: Authentication | null;
  /** `kind` is set only on mail a Pidgeon address wrote; SMTP mail declares nothing. */
  sender: { address: string; kind: string | null } | null;
  /** `"smtp"` for mail that arrived from outside Pidgeon. */
  origin: string | null;
  firewall: Firewall | null;
  attachments: Attachment[];
  created_at: string;
}

export interface Event {
  id: string;
  type: string;
  identity: string | null;
  message_id: string | null;
  thread_id: string | null;
  created_at: string;
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface Me {
  kind: string;
  workspace?: { name?: string };
  reaches?: unknown;
}

export interface Sent {
  id: string;
  thread_id: string;
}

/** A refusal from the API, with its status and the sentence it gave. */
export class PidgeonApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PidgeonApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** The bearer for the next request: a key, or a current access token. */
  token: () => Promise<string>;
  /**
   * Called once when a request answers 401, before it is tried again. An
   * OAuth credential refreshes here; a key has nothing to do, so the retry
   * fails the same way and the error reaches the caller.
   */
  onUnauthorized?: () => Promise<void>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface Client {
  me(): Promise<Me>;
  /** `message.received`, oldest first, strictly after `after`. */
  receivedSince(after: string, limit?: number): Promise<Page<Event>>;
  /** The message as an agent should read it: the Firewall's clean text. */
  message(id: string): Promise<Message>;
  reply(id: string, text: string, idempotencyKey: string): Promise<Sent>;
}

const USER_AGENT = '@pidgeon-ai/openclaw';

export function createClient(options: ClientOptions): Client {
  const call = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await call(`${base}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await options.token()}`,
          accept: 'application/json',
          'user-agent': USER_AGENT,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.signal,
      });

      if (response.status === 401 && attempt === 0 && options.onUnauthorized) {
        await options.onUnauthorized();
        continue;
      }

      const text = await response.text();
      const json = text ? (JSON.parse(text) as unknown) : undefined;
      if (!response.ok) {
        const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
        throw new PidgeonApiError(
          response.status,
          error?.code ?? `http_${response.status}`,
          error?.message ?? `Pidgeon answered ${response.status} to ${method} ${path}.`,
        );
      }
      return json as T;
    }
  }

  return {
    me: async () => (await request<{ data: Me }>('GET', '/me')).data,
    receivedSince: (after, limit = 100) =>
      request<Page<Event>>(
        'GET',
        `/events?type=message.received&limit=${limit}&after=${encodeURIComponent(after)}`,
      ),
    message: async (id) =>
      (await request<{ data: Message }>('GET', `/messages/${encodeURIComponent(id)}?body=clean`))
        .data,
    reply: async (id, text, idempotencyKey) =>
      (
        await request<{ data: Sent }>(
          'POST',
          `/messages/${encodeURIComponent(id)}/reply`,
          { text },
          { 'idempotency-key': idempotencyKey },
        )
      ).data,
  };
}
