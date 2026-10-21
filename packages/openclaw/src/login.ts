/**
 * `openclaw channels login --channel pidgeon`: a browser sign-in that leaves
 * the Gateway a credential it can refresh by itself.
 *
 * The OAuth a native app does (RFC 8252): register with Pidgeon, open the
 * consent screen, catch the redirect on a loopback port, trade the code for
 * tokens with PKCE. The person picks the access and the addresses on that
 * screen; what they pick becomes a key under Connected apps, ended there by
 * Disconnect.
 *
 * **The listener stays up for ten minutes**, not thirty seconds: signing in
 * may mean creating an account first, and a listener that has gone when the
 * browser returns is the failure people meet most with CLI sign-ins.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exchange, storedFrom, type StoredSignIn } from './credentials.js';

export const LOGIN_TIMEOUT_MS = 10 * 60_000;
const CALLBACK_PATH = '/pidgeon/callback';

const base64url = (bytes: Buffer) => bytes.toString('base64url');

export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

async function register(baseUrl: string, redirectUri: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${baseUrl}/api/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'OpenClaw email channel',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    client_id?: string;
    error_description?: string;
  };
  if (!response.ok || !body.client_id) {
    throw new Error(body.error_description ?? `Pidgeon refused to register (${response.status}).`);
  }
  return body.client_id;
}

const PAGE = (title: string, line: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem">` +
  `<h1 style="font-size:1.4rem">${title}</h1><p>${line}</p></body>`;

/**
 * Waits for one redirect carrying `state`, and answers the browser. Anything
 * else on the port gets a 404 and does not end the wait.
 */
function awaitCallback(
  server: Server,
  state: string,
  signal: AbortSignal,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error('The sign-in timed out. Run the command again.'));
    signal.addEventListener('abort', onAbort, { once: true });

    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH || url.searchParams.get('state') !== state) {
        response.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (error || !code) {
        response.end(PAGE('Not connected', 'Pidgeon was not connected. You can close this tab.'));
        signal.removeEventListener('abort', onAbort);
        reject(
          new Error(url.searchParams.get('error_description') ?? error ?? 'No code came back.'),
        );
        return;
      }
      response.end(
        PAGE(
          'Connected',
          'OpenClaw can read and answer your Pidgeon mail now. You can close this tab.',
        ),
      );
      signal.removeEventListener('abort', onAbort);
      resolve({ code });
    });
  });
}

export async function signIn(params: {
  baseUrl: string;
  /** Shows the link; opening a browser is the caller's, when it can. */
  announce: (url: string) => void | Promise<void>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<StoredSignIn> {
  const fetchImpl = params.fetch ?? fetch;
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const timeout = AbortSignal.timeout(params.timeoutMs ?? LOGIN_TIMEOUT_MS);

  try {
    const { port } = server.address() as AddressInfo;
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const clientId = await register(params.baseUrl, redirectUri, fetchImpl);
    const { verifier, challenge } = pkce();
    const state = base64url(randomBytes(16));

    const authorize = new URL(`${params.baseUrl}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      // Read and reply is all the channel does; it never creates or deletes an address.
      scope: 'read send',
    }).toString();

    const callback = awaitCallback(server, state, timeout);
    await params.announce(authorize.toString());
    const { code } = await callback;

    const tokens = await exchange(
      params.baseUrl,
      {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
      },
      fetchImpl,
    );
    return storedFrom(params.baseUrl, clientId, tokens);
  } finally {
    server.close();
  }
}
