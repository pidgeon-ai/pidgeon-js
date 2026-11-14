/**
 * `@pidgeon-ai/sdk/node`: what the CLI and the MCP server share, for Node only.
 *
 * - **Signing in** with a browser, through Pidgeon's OAuth server (MCP
 *   authorization: RFC 9728 discovery from the resource `<issuer>/mcp`, a
 *   client registered with RFC 7591, the code flow with PKCE on a loopback
 *   redirect, RFC 8252). The tokens are kept in `credentials.json` and
 *   refreshed when they run out; `PIDGEON_API_KEY` wins over them.
 * - **Agent keys**, made on this machine and kept in `agents/<id>.json`, so
 *   the private half never leaves it: not to Pidgeon, and not to the model a
 *   coding agent talks to.
 *
 * Both live in `PIDGEON_CONFIG_DIR`, else `$XDG_CONFIG_HOME/pidgeon`, else
 * `~/.config/pidgeon`, readable by this user only.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { generateAgentKey, signAgentRequest } from './credential.ts';
import { DEFAULT_BASE_URL, Pidgeon, PidgeonError, type Agent } from './index.ts';

type Env = Record<string, string | undefined>;

export function configDir(env: Env = process.env): string {
  if (env.PIDGEON_CONFIG_DIR) return env.PIDGEON_CONFIG_DIR;
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'pidgeon');
}

export function baseUrlOf(env: Env = process.env): string {
  return (env.PIDGEON_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Written whole, readable by this user only, and never half-written. */
async function writePrivate(path: string, value: unknown): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

export type Session = {
  baseUrl: string;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  resource: string;
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  scope: string;
};

const credentialsPath = (env: Env) => join(configDir(env), 'credentials.json');

async function sessions(env: Env): Promise<Record<string, Session>> {
  return (await readJson<Record<string, Session>>(credentialsPath(env))) ?? {};
}

async function saveSession(session: Session, env: Env): Promise<void> {
  const all = await sessions(env);
  all[session.baseUrl] = session;
  await writePrivate(credentialsPath(env), all);
}

export async function readSession(baseUrl: string, env: Env = process.env) {
  return (await sessions(env))[baseUrl] ?? null;
}

type Metadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
};

async function getJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok)
    throw new PidgeonError(response.status, 'discovery', `${url} answered ${response.status}.`);
  return (await response.json()) as T;
}

/** RFC 9728 then RFC 8414: who guards `<base>/mcp`, and where its endpoints are. */
export async function discover(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const resource = await getJson<{ resource: string; authorization_servers: string[] }>(
    fetchImpl,
    `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
  );
  const server = resource.authorization_servers[0];
  if (!server) throw new PidgeonError(500, 'discovery', 'Pidgeon named no authorization server.');
  const metadata = await getJson<Metadata>(
    fetchImpl,
    `${server.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`,
  );
  return { resource: resource.resource, metadata };
}

async function postForm<T>(fetchImpl: typeof fetch, url: string, form: Record<string, string>) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const data = (await response.json().catch(() => null)) as
    (T & { error?: string; error_description?: string }) | null;
  if (!response.ok) {
    throw new PidgeonError(
      response.status,
      data?.error ?? 'oauth',
      data?.error_description ?? `${url} answered ${response.status}.`,
    );
  }
  return data as T;
}

type Tokens = { access_token: string; refresh_token?: string; expires_in: number; scope: string };

/** Open a URL in the person's browser; where none can be opened, they are shown the URL instead. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch {
    // The URL was shown as well.
  }
}

const page = (title: string, line: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;margin:4rem auto;max-width:28rem"><h1>${title}</h1><p>${line}</p>`;

/**
 * Sign in with a browser: the person signs in to Pidgeon there and chooses
 * what this machine may do (`scope` is the most it asks for). Resolves once
 * they answer, with the session saved.
 *
 * `onUrl` is told the address to open, which is also opened in the browser
 * unless `openBrowser` is false (a headless machine shows it instead).
 */
export async function signIn(
  options: {
    baseUrl?: string;
    scope?: 'read' | 'draft' | 'send' | 'admin';
    clientName?: string;
    onUrl?: (url: string) => void;
    openBrowser?: boolean;
    timeoutMs?: number;
    fetch?: typeof fetch;
    env?: Env;
  } = {},
): Promise<Session> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? baseUrlOf(env)).replace(/\/+$/, '');
  const { resource, metadata } = await discover(baseUrl, fetchImpl);

  const previous = await readSession(baseUrl, env);
  let clientId = previous?.issuer === metadata.issuer ? previous.clientId : null;
  if (!clientId) {
    if (!metadata.registration_endpoint)
      throw new PidgeonError(500, 'discovery', 'Pidgeon offers no client registration.');
    const response = await fetchImpl(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: options.clientName ?? 'Pidgeon CLI',
        // Any port on the loopback matches this (RFC 8252 §7.3).
        redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    const registered = (await response.json().catch(() => null)) as { client_id?: string } | null;
    if (!response.ok || !registered?.client_id)
      throw new PidgeonError(
        response.status,
        'registration',
        'Pidgeon did not register this client.',
      );
    clientId = registered.client_id;
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  let finish!: (result: { code: string } | { error: string }) => void;
  const answered = new Promise<{ code: string } | { error: string }>((r) => (finish = r));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const fromIssuer = url.searchParams.get('iss');
    if (url.searchParams.get('state') !== state || (fromIssuer && fromIssuer !== metadata.issuer)) {
      res.writeHead(400, { 'content-type': 'text/html' });
      res.end(page('That was not this sign-in', 'Start again from your terminal.'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (error || !code) {
      res.end(page('Not signed in', 'You can close this tab.'));
      finish({ error: url.searchParams.get('error_description') ?? error ?? 'no code' });
    } else {
      res.end(page('Signed in', 'You can close this tab and go back.'));
      finish({ code });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authorize = new URL(metadata.authorization_endpoint);
  for (const [name, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: options.scope ?? 'admin',
    resource,
  })) {
    authorize.searchParams.set(name, value);
  }
  options.onUrl?.(authorize.toString());
  if (options.openBrowser !== false) openInBrowser(authorize.toString());

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ error: string }>((resolve) => {
    timer = setTimeout(
      () => resolve({ error: 'Nobody answered in the browser in time.' }),
      options.timeoutMs ?? 5 * 60_000,
    );
  });
  const result = await Promise.race([answered, timeout]).finally(() => {
    clearTimeout(timer);
    server.close();
  });
  if ('error' in result) throw new PidgeonError(401, 'not_signed_in', result.error);

  const tokens = await postForm<Tokens>(fetchImpl, metadata.token_endpoint, {
    grant_type: 'authorization_code',
    code: result.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource,
  });
  const session: Session = {
    baseUrl,
    issuer: metadata.issuer,
    tokenEndpoint: metadata.token_endpoint,
    revocationEndpoint: metadata.revocation_endpoint ?? null,
    resource,
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  };
  await saveSession(session, env);
  return session;
}

/** A live access token for the saved session, refreshed (and saved) when it is about to run out. */
export async function sessionToken(
  baseUrl: string,
  options: { fetch?: typeof fetch; env?: Env } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const session = await readSession(baseUrl, env);
  if (!session) throw notSignedIn();
  if (session.expiresAt - 60_000 > Date.now()) return session.accessToken;
  if (!session.refreshToken) throw notSignedIn();
  const tokens = await postForm<Tokens>(options.fetch ?? fetch, session.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: session.clientId,
    resource: session.resource,
  }).catch((error: unknown) => {
    if (error instanceof PidgeonError && error.code === 'invalid_grant') throw notSignedIn();
    throw error;
  });
  await saveSession(
    {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scope: tokens.scope,
    },
    env,
  );
  return tokens.access_token;
}

/** End the session: Pidgeon is told (which ends the connection there), and the tokens are forgotten. */
export async function signOut(
  baseUrl: string,
  options: { fetch?: typeof fetch; env?: Env } = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const all = await sessions(env);
  const session = all[baseUrl];
  if (!session) return false;
  if (session.revocationEndpoint) {
    await postForm(options.fetch ?? fetch, session.revocationEndpoint, {
      token: session.refreshToken ?? session.accessToken,
      client_id: session.clientId,
    }).catch(() => {});
  }
  delete all[baseUrl];
  await writePrivate(credentialsPath(env), all);
  return true;
}

const notSignedIn = () =>
  new PidgeonError(
    401,
    'not_signed_in',
    'Not signed in to Pidgeon: run `pidgeon login`, or set PIDGEON_API_KEY.',
  );

/**
 * The API client for this machine: `PIDGEON_API_KEY` if it is set, else the
 * signed-in session (refreshed as needed). Nothing is checked until the first call.
 */
export function clientFromEnvironment(
  options: { env?: Env; baseUrl?: string; fetch?: typeof fetch } = {},
): Pidgeon {
  const env = options.env ?? process.env;
  const baseUrl = options.baseUrl ?? baseUrlOf(env);
  if (env.PIDGEON_API_KEY)
    return new Pidgeon({ apiKey: env.PIDGEON_API_KEY, baseUrl, fetch: options.fetch });
  return new Pidgeon({
    baseUrl,
    fetch: options.fetch,
    getToken: () => sessionToken(baseUrl, { fetch: options.fetch, env }),
  });
}

// ---------------------------------------------------------------------------
// Agent keys, kept here
// ---------------------------------------------------------------------------

export type StoredAgentKey = {
  agent_id: string;
  name: string;
  kid: string;
  directory: string;
  public_jwk: JsonWebKey;
  private_jwk: JsonWebKey;
  created_at: string;
};

const agentsDir = (env: Env) => join(configDir(env), 'agents');

/** Where an agent's key is kept on this machine. */
export const agentKeyPath = (agentId: string, env: Env = process.env) =>
  join(agentsDir(env), `${agentId.replace(/[^A-Za-z0-9-]/g, '')}.json`);

export async function saveAgentKey(entry: StoredAgentKey, env: Env = process.env): Promise<string> {
  const path = agentKeyPath(entry.agent_id, env);
  await writePrivate(path, entry);
  return path;
}

export async function readAgentKey(
  agentId: string,
  env: Env = process.env,
): Promise<StoredAgentKey | null> {
  return readJson<StoredAgentKey>(agentKeyPath(agentId, env));
}

/** Every agent key kept here, without their private halves. */
export async function listAgentKeys(
  env: Env = process.env,
): Promise<(Omit<StoredAgentKey, 'private_jwk'> & { path: string })[]> {
  const names = await readdir(agentsDir(env)).catch(() => [] as string[]);
  const out: (Omit<StoredAgentKey, 'private_jwk'> & { path: string })[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const path = join(agentsDir(env), name);
    const entry = await readJson<StoredAgentKey>(path);
    if (!entry) continue;
    const { private_jwk: _secret, ...shown } = entry;
    out.push({ ...shown, path });
  }
  return out;
}

export async function forgetAgentKey(agentId: string, env: Env = process.env): Promise<void> {
  await rm(agentKeyPath(agentId, env), { force: true });
}

/** Your agent, from a key file this machine keeps: `fetch` signs every request as it. */
export async function agentFromKeyFile(path: string): Promise<{
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}> {
  const entry = await readJson<StoredAgentKey>(path);
  if (!entry?.private_jwk || !entry.directory)
    throw new Error(`${path} is not an agent key Pidgeon made.`);
  return {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const signature = await signAgentRequest(request, {
        privateJwk: entry.private_jwk,
        directory: entry.directory,
      });
      const headers = new Headers(request.headers);
      for (const [name, value] of Object.entries(signature)) headers.set(name, value);
      return fetch(new Request(request, { headers }));
    },
  };
}

/**
 * Register an agent, make its key on this machine, publish the public half
 * signed with it (the possession proof the dashboard sends too), and keep
 * the key here. Answers where the key is, never the key.
 */
export async function setUpAgent(
  pidgeon: Pidgeon,
  input: { name: string; purpose?: string; podId?: string },
  env: Env = process.env,
): Promise<{ agent: Agent & { directory: string }; kid: string; keyFile: string }> {
  const { agent, key, kid } = await pidgeon.agents.setUp(input);
  const keyFile = await saveAgentKey(
    {
      agent_id: agent.id,
      name: agent.name,
      kid,
      directory: agent.directory,
      public_jwk: key.publicJwk,
      private_jwk: key.privateJwk,
      created_at: new Date().toISOString(),
    },
    env,
  );
  return { agent, kid, keyFile };
}

/**
 * A new key for an agent already registered, made and kept here. It replaces
 * the key this machine kept for that agent; the old one stays published
 * until it is revoked in the dashboard.
 */
export async function addAgentKey(
  pidgeon: Pidgeon,
  agentId: string,
  env: Env = process.env,
): Promise<{ kid: string; keyFile: string }> {
  const agent = await pidgeon.agents.get(agentId);
  const key = await generateAgentKey();
  const { kid } = await pidgeon.publishKey({ agentId: agent.id, key, directory: agent.directory });
  const keyFile = await saveAgentKey(
    {
      agent_id: agent.id,
      name: agent.name,
      kid,
      directory: agent.directory,
      public_jwk: key.publicJwk,
      private_jwk: key.privateJwk,
      created_at: new Date().toISOString(),
    },
    env,
  );
  return { kid, keyFile };
}

/**
 * For a server that cannot make keys (the hosted MCP server): make the
 * agent's key here, keep it, and answer what publishing it needs, never the
 * key: the public half, and the signature headers of a `POST` to
 * `publishUrl` made with the key, which is the possession proof. The proof
 * holds for `lifetimeSeconds` (ten minutes), long enough to hand it over.
 */
export async function makeKeyProof(
  input: {
    agentId: string;
    directory: string;
    publishUrl: string;
    name?: string;
    lifetimeSeconds?: number;
  },
  env: Env = process.env,
): Promise<{
  agent_id: string;
  kid: string;
  key_file: string;
  public_jwk: JsonWebKey;
  signature: Record<string, string>;
}> {
  const url = new URL(input.publishUrl);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    throw new Error('The publish address must be https.');
  if (!/\/v1\/agents\/[^/]+\/keys$/.test(url.pathname))
    throw new Error('The publish address must be an agent’s /v1/agents/<id>/keys.');
  const key = await generateAgentKey();
  const signature = await signAgentRequest(new Request(url, { method: 'POST' }), {
    privateJwk: key.privateJwk,
    directory: input.directory,
    lifetimeSeconds: input.lifetimeSeconds ?? 600,
  });
  const keyFile = await saveAgentKey(
    {
      agent_id: input.agentId,
      name: input.name ?? input.agentId,
      kid: key.kid,
      directory: input.directory,
      public_jwk: key.publicJwk,
      private_jwk: key.privateJwk,
      created_at: new Date().toISOString(),
    },
    env,
  );
  return {
    agent_id: input.agentId,
    kid: key.kid,
    key_file: keyFile,
    public_jwk: key.publicJwk,
    signature,
  };
}
