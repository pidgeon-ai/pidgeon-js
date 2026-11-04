import { createHash, randomBytes } from 'node:crypto';

import { type Identity, verifyBytes } from './keys';

/**
 * Signing an agent's HTTP requests: RFC 9421 HTTP Message Signatures as
 * Web Bot Auth profiles them (draft-ietf-webbotauth-httpsig-protocol-01),
 * in the form Cloudflare verifies today.
 *
 * - `keyid` is the key's JWK thumbprint; `alg="ed25519"`; `tag="web-bot-auth"`.
 * - `Signature-Agent` names `https://post.<domain>`, which serves the key
 *   directory (`/.well-known/http-message-signatures-directory`) and the
 *   domain's agent cards. Sent as the bare string Cloudflare reads, not
 *   the draft's dictionary, until Cloudflare reads that (both verify at
 *   Pidgeon).
 * - Covered: `@method`, `@authority`, `@path`, `@query` when there is one,
 *   `signature-agent`, `from` (the agent's address, the header RFC 9110
 *   gives a robot's operator), `post-grant` when it carries grants, and
 *   `content-digest` when there is a body.
 *   So a signature holds for this request only, not for any request to
 *   the host.
 * - Valid for five minutes. Cloudflare suggests a minute; an agent behind a
 *   queue needs more.
 *
 * An MCP call over Streamable HTTP is an HTTP request, so `signedFetch` is
 * also how an agent signs MCP: give it to the transport as `fetch`.
 */

export const TAG = 'web-bot-auth';
export const SIGNATURE_SECONDS = 300;

export interface SignRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  /** The agent's address, `support-agent@acme.com`: sent and covered as `From`. */
  agent?: string | null;
  /** Override the clock, for tests. Milliseconds. */
  now?: number;
  /** The signature's label. */
  label?: string;
  /** The tag. Pidgeon's issuance API uses its own, so an agent's signature is never an operator's. */
  tag?: string;
  /**
   * Grants the agent was given (compact JWS): sent as `Post-Grant`,
   * comma-separated, and covered like `From`, so the receiver sees what it
   * may do. A grant holds only for the agent it names, whoever forwards it.
   */
  grants?: string[];
  seconds?: number;
}

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function authority(url: URL): string {
  const defaultPort =
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80');
  return `${url.hostname.toLowerCase()}${url.port && !defaultPort ? `:${url.port}` : ''}`;
}

function bytesOf(body: string | Uint8Array): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body;
}

export function contentDigest(body: string | Uint8Array): string {
  return `sha-256=:${createHash('sha256').update(bytesOf(body)).digest('base64')}:`;
}

/**
 * The headers that sign this request, lower-cased: `signature-agent`,
 * `from`, `content-digest` (with a body), `signature-input`, `signature`.
 * Add them to the request as they are; change nothing they cover after.
 */
export async function signRequest(
  identity: Identity,
  input: SignRequestInput,
): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const label = input.label ?? 'sig1';
  const created = Math.floor((input.now ?? Date.now()) / 1000);
  const expires = created + (input.seconds ?? SIGNATURE_SECONDS);
  const agent = input.agent?.trim().toLowerCase() ?? null;
  if (agent && !agent.endsWith(`@${identity.domain}`)) {
    throw new Error(`${agent} is not an address at ${identity.domain}, whose key this is.`);
  }

  const added: Record<string, string> = {
    'signature-agent': quote(`https://post.${identity.domain}`),
    ...(agent ? { from: agent } : {}),
    ...(input.grants?.length
      ? { 'post-grant': input.grants.map((jws) => jws.replace(/\s+/g, '')).join(', ') }
      : {}),
  };
  const body = input.body === undefined || input.body === null ? null : bytesOf(input.body);
  if (body && body.length > 0) added['content-digest'] = contentDigest(body);

  const values: [string, string][] = [
    ['@method', input.method.toUpperCase()],
    ['@authority', authority(url)],
    ['@path', url.pathname || '/'],
    ...(url.search ? ([['@query', url.search]] as [string, string][]) : []),
    ['signature-agent', added['signature-agent']!],
    ...(added.from ? ([['from', added.from]] as [string, string][]) : []),
    ...(added['post-grant'] ? ([['post-grant', added['post-grant']]] as [string, string][]) : []),
    ...(added['content-digest']
      ? ([['content-digest', added['content-digest']]] as [string, string][])
      : []),
  ];

  const params =
    `(${values.map(([name]) => quote(name)).join(' ')})` +
    `;created=${created};expires=${expires};keyid=${quote(identity.kid)};alg="ed25519"` +
    `;nonce=${quote(randomBytes(32).toString('base64'))};tag=${quote(input.tag ?? TAG)}`;
  const base = [
    ...values.map(([name, value]) => `${quote(name)}: ${value}`),
    `"@signature-params": ${params}`,
  ].join('\n');

  const signature = identity.sign(new TextEncoder().encode(base));
  return {
    ...added,
    'signature-input': `${label}=${params}`,
    signature: `${label}=:${Buffer.from(signature).toString('base64')}:`,
  };
}

type Fetch = typeof globalThis.fetch;

/**
 * `fetch`, signing every request as `agent`. For MCP:
 *
 * ```ts
 * new StreamableHTTPClientTransport(new URL(server), { fetch: signedFetch(identity, { agent }) })
 * ```
 */
export function signedFetch(
  identity: Identity,
  options: { agent: string; fetch?: Fetch; grants?: string[] },
): Fetch {
  const base = options.fetch ?? globalThis.fetch;
  return async (resource, init) => {
    const request = new Request(resource, init);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : null;
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const signature = await signRequest(identity, {
      method: request.method,
      url: request.url,
      headers,
      body,
      agent: options.agent,
      grants: options.grants,
    });
    const signedHeaders = new Headers(request.headers);
    for (const [name, value] of Object.entries(signature)) signedHeaders.set(name, value);
    return base(request.url, {
      method: request.method,
      headers: signedHeaders,
      body: body && body.length > 0 ? body : undefined,
      redirect: request.redirect,
      signal: request.signal,
    });
  };
}

// --- Verifying, for a receiver ---------------------------------------------------

export interface VerifyRequestInput {
  method: string;
  url: string;
  headers: Record<string, string> | Headers;
  body?: string | Uint8Array | null;
}

export type RequestCheck =
  | {
      ok: true;
      keyid: string;
      agent: string | null;
      from: string | null;
      created: number;
      /** What the signature covers, by name: a receiver insists on the ones it needs. */
      components: string[];
      nonce: string | null;
    }
  | { ok: false; reason: string };

/**
 * Checks a request signed by `signRequest` or any Web Bot Auth signer that
 * covers what it does: the components it names, inside its window, under
 * the key `key` returns. A receiver that wants who the agent is and whose
 * it is asks Pidgeon instead (`POST /v1/verify` with `request`), which looks
 * the key up and attaches the card.
 */
export async function verifyRequest(
  input: VerifyRequestInput,
  options: {
    key: (keyid: string, agent: string | null) => Promise<Uint8Array | null>;
    now?: number;
    tag?: string;
  },
): Promise<RequestCheck> {
  const headers = new Map<string, string>();
  if (input.headers instanceof Headers)
    input.headers.forEach((value, name) => headers.set(name, value));
  else
    for (const [name, value] of Object.entries(input.headers))
      headers.set(name.toLowerCase(), value);

  const signatureInput = headers.get('signature-input') ?? '';
  const tag = options.tag ?? TAG;
  // `label=(components);params`, one per comma outside quotes and parentheses.
  const members = splitTopLevel(signatureInput);
  const member = members.find((entry) => entry.includes(`tag=${quote(tag)}`));
  if (!member) return { ok: false, reason: 'unsigned' };

  const eq = member.indexOf('=');
  const label = member.slice(0, eq).trim();
  const params = member.slice(eq + 1).trim();
  const list = /^\(([^)]*)\)/.exec(params)?.[1];
  if (list === undefined) return { ok: false, reason: 'malformed' };
  const components = [...list.matchAll(/"([^"]+)"((?:;[a-z]+(?:="[^"]*")?)*)/g)].map((match) => ({
    name: match[1]!,
    params: match[2] ?? '',
  }));
  const number = (name: string) => Number(new RegExp(`;${name}=(\\d+)`).exec(params)?.[1] ?? NaN);
  const keyid = /;keyid="([^"]+)"/.exec(params)?.[1];
  const created = number('created');
  const expires = number('expires');
  if (!keyid || Number.isNaN(created) || Number.isNaN(expires))
    return { ok: false, reason: 'missing_parameters' };

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (expires <= now) return { ok: false, reason: 'expired' };
  if (created > now + 60 || expires - created > 86_400) return { ok: false, reason: 'window' };

  const signature = new RegExp(`(?:^|,)\\s*${label}=:([^:]+):`).exec(
    headers.get('signature') ?? '',
  )?.[1];
  if (!signature) return { ok: false, reason: 'malformed' };

  const url = new URL(input.url);
  const value = (name: string, componentParams: string): string | null => {
    switch (name) {
      case '@method':
        return input.method.toUpperCase();
      case '@authority':
        return authority(url);
      case '@path':
        return url.pathname || '/';
      case '@query':
        return url.search || '?';
      case '@target-uri':
        return url.href;
    }
    const raw = headers.get(name)?.trim();
    if (raw === undefined) return null;
    const key = /;key="([^"]+)"/.exec(componentParams)?.[1];
    if (!key) return raw;
    return new RegExp(`(?:^|,)\\s*${key}=("[^"]*")`).exec(raw)?.[1] ?? null;
  };

  const lines: string[] = [];
  for (const component of components) {
    const found = value(component.name, component.params);
    if (found === null) return { ok: false, reason: 'missing_component' };
    lines.push(`${quote(component.name)}${component.params}: ${found}`);
  }
  lines.push(`"@signature-params": ${params}`);

  const agentRaw = headers.get('signature-agent')?.trim() ?? null;
  const agent = agentRaw ? (/"([^"]+)"/.exec(agentRaw)?.[1] ?? null) : null;
  const publicKey = await options.key(keyid, agent);
  if (!publicKey) return { ok: false, reason: 'unknown_key' };
  if (
    !verifyBytes(
      publicKey,
      new TextEncoder().encode(lines.join('\n')),
      new Uint8Array(Buffer.from(signature, 'base64')),
    )
  ) {
    return { ok: false, reason: 'bad_signature' };
  }

  if (components.some((component) => component.name === 'content-digest') && input.body) {
    if (headers.get('content-digest') !== contentDigest(input.body))
      return { ok: false, reason: 'body_changed' };
  }

  const from = components.some((component) => component.name === 'from')
    ? (headers.get('from')?.trim().toLowerCase() ?? null)
    : null;
  const nonce = /;nonce="([^"]+)"/.exec(params)?.[1] ?? null;
  return {
    ok: true,
    keyid,
    agent,
    from,
    created,
    components: components.map((component) => component.name),
    nonce,
  };
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"' && value[i - 1] !== '\\') quoted = !quoted;
    else if (!quoted && c === '(') depth++;
    else if (!quoted && c === ')') depth--;
    else if (!quoted && depth === 0 && c === ',') {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (value.slice(start).trim()) out.push(value.slice(start).trim());
  return out;
}
