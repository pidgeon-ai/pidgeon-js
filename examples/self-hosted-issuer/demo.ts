/**
 * Acme runs its own issuer: Keycloak says who its agents are, the issuer
 * signs for acme.test with a key that never leaves this machine, and an
 * agent signs in to a website with no person present. Then an administrator
 * disables the agent in Keycloak, and its next sign-in fails. Last, a person,
 * Alice, signs in to the same site through Keycloak's own login page.
 *
 *   pnpm demo            # needs Docker
 *   docker compose down  # afterwards
 *
 * Nothing here reaches Pidgeon.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  generateIdentity,
  loadIdentity,
  saveIdentity,
  SignInError,
  signedFetch,
  signInWithPidgeon,
} from '@pidgeon-ai/id';

import { startSite } from './site';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DOMAIN = 'acme.test';
const AGENT = `support-agent@${DOMAIN}`;
const ISSUER = 'http://localhost:8080';
const KEYCLOAK = 'http://localhost:8081';
const SITE_PORT = 3490;

const step = (text: string) => console.log(`\n${text}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(what: string, attempt: () => Promise<T | null>, seconds = 120): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const value = await attempt().catch(() => null);
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`Gave up waiting for ${what}.`);
}

// 1. Two keys, made here: the issuer's (mounted into its container) and the agent's.
step('1. Keys: the issuer’s and the agent’s, made on this machine.');
for (const who of ['issuer', 'agent']) {
  if (!existsSync(`${HERE}.keys/${who}/${DOMAIN}.json`)) {
    await saveIdentity(generateIdentity(DOMAIN), `${HERE}.keys/${who}`);
  }
}
const agent = await loadIdentity(DOMAIN, { dir: `${HERE}.keys/agent` });
console.log(`  agent key ${agent.kid}`);

// 2. Keycloak and the issuer.
step('2. Keycloak and the issuer, in Docker (the first build takes a few minutes).');
execFileSync('docker', ['compose', 'up', '-d', '--build', '--wait', 'keycloak'], {
  cwd: HERE,
  stdio: 'inherit',
});
execFileSync('docker', ['compose', 'up', '-d', '--build', 'issuer'], {
  cwd: HERE,
  stdio: 'inherit',
});

// 3. The administrator gives the agent's client its public key, as they would in the
//    console (Credentials → Signed JWT, EdDSA): the one key Keycloak and Pidgeon both check.
step('3. Keycloak: the support-agent client authenticates with the agent’s Ed25519 key.');
async function admin(): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  const token = await until('Keycloak', async () => {
    const response = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: 'admin',
      }),
    });
    return response.ok ? ((await response.json()) as { access_token: string }).access_token : null;
  });
  return (path, init = {}) =>
    fetch(`${KEYCLOAK}/admin/realms/acme${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
}
/** As much of Keycloak's ClientRepresentation as the demo changes; the rest goes back as it came. */
interface KeycloakClient {
  id: string;
  enabled?: boolean;
  attributes?: Record<string, string>;
}
async function updateAgentClient(change: (client: KeycloakClient) => void) {
  const call = await admin();
  const [client] = (await (
    await call('/clients?clientId=support-agent')
  ).json()) as KeycloakClient[];
  change(client!);
  const response = await call(`/clients/${client!.id}`, {
    method: 'PUT',
    body: JSON.stringify(client),
  });
  if (!response.ok) throw new Error(`Keycloak answered ${response.status} updating the client.`);
}
const x = Buffer.from(agent.publicKey).toString('base64url');
await updateAgentClient((client) => {
  client.enabled = true;
  client.attributes = {
    ...client.attributes,
    'jwks.string': JSON.stringify({
      keys: [{ kty: 'OKP', crv: 'Ed25519', x, kid: agent.kid, use: 'sig', alg: 'EdDSA' }],
    }),
  };
});

// The agent signs in to Keycloak with that key (RFC 7523 client authentication), no secret.
const b64 = (value: string | Uint8Array) => Buffer.from(value).toString('base64url');
const head = b64(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: agent.kid }));
const now = Math.floor(Date.now() / 1000);
const claims = b64(
  JSON.stringify({
    iss: 'support-agent',
    sub: 'support-agent',
    aud: `${KEYCLOAK}/realms/acme`,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 50,
  }),
);
const assertion = `${head}.${claims}.${b64(agent.sign(new TextEncoder().encode(`${head}.${claims}`)))}`;
const keycloakToken = await fetch(`${KEYCLOAK}/realms/acme/protocol/openid-connect/token`, {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'support-agent',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  }),
});
console.log(
  `  Keycloak, to the agent's own key: ${keycloakToken.ok ? 'an access token' : `refused (${keycloakToken.status})`}`,
);
if (!keycloakToken.ok) process.exitCode = 1;

// 4. The issuer sees it: the agent has a card at acme.test's issuer.
step('4. The issuer reads Keycloak: support-agent@acme.test has a card.');
const card = await until('the card', async () => {
  const response = await fetch(
    `${ISSUER}/.well-known/post/card?address=${encodeURIComponent(AGENT)}`,
  );
  return response.ok
    ? ((await response.json()) as { jws: string; card: Record<string, unknown> })
    : null;
});
console.log(
  `  iss ${card.card.iss}, sub ${card.card.sub}, operator ${JSON.stringify(card.card.operator)}`,
);

// 5. Its grant, asked for in a request the agent signs.
step('5. The agent’s grant, from its group in Keycloak (refunds).');
const grants = (await (
  await signedFetch(agent, { agent: AGENT })(`${ISSUER}/api/post/grants`)
).json()) as { data: { jws: string }[] };
const grant = grants.data[0]?.jws;
console.log(`  ${grants.data.length} grant${grants.data.length === 1 ? '' : 's'}`);

// 6. Sign in to the site.
step('6. The agent signs in to the site, which lists Acme’s issuer.');
const site = await startSite(SITE_PORT);
const signIn = () =>
  signInWithPidgeon(agent, {
    agent: AGENT,
    site: `http://localhost:${SITE_PORT}/api/auth/pidgeon/token`,
    grant,
    // The card read a moment ago, so step 7 shows the token endpoint itself refusing.
    card: card.jws,
  });
const { site: session } = await signIn();
console.log('  the site says:', JSON.stringify(session.agent));

// 7. An administrator disables the agent in Keycloak.
step('7. An administrator disables the support-agent client in Keycloak.');
await updateAgentClient((client) => (client.enabled = false));
try {
  await signIn();
  console.log('  …and it signed in anyway. That is a bug.');
  process.exitCode = 1;
} catch (error) {
  if (!(error instanceof SignInError)) throw error;
  console.log(`  refused: ${error.message}`);
}
await updateAgentClient((client) => (client.enabled = true));

// 8. A person signs in, through Keycloak's login page, as a browser would.
step('8. Alice signs in to the site as herself, through Keycloak (alice / alice).');
/** A browser: one cookie jar per host, redirects followed by hand so each hop is seen. */
const jar = new Map<string, Map<string, string>>();
async function browse(url: string, init: RequestInit = {}): Promise<Response> {
  const host = new URL(url).host;
  const cookies = jar.get(host) ?? new Map<string, string>();
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(init.headers as Record<string, string>),
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    },
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const eq = pair!.indexOf('=');
    cookies.set(pair!.slice(0, eq), pair!.slice(eq + 1));
  }
  jar.set(host, cookies);
  const next = response.headers.get('location');
  return next ? browse(new URL(next, url).toString()) : response;
}
const loginPage = await browse(`http://localhost:${SITE_PORT}/api/auth/pidgeon/login`);
const form = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(await loginPage.text());
if (!form) throw new Error('Keycloak did not show its login page.');
const account = await browse(form[1]!.replaceAll('&amp;', '&'), {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ username: 'alice', password: 'alice' }).toString(),
});
// The site sent her home with a session cookie; her account page says who she is.
const person = (
  (await (await browse(`http://localhost:${SITE_PORT}/account`)).json()) as {
    signed_in_as?: Record<string, unknown>;
  }
).signed_in_as;
if (person?.kind === 'person') {
  console.log(
    `  the site says: ${person.email}, ${person.kind}, iss ${person.iss}, sub ${person.sub}`,
  );
} else {
  console.log(`  Alice was not signed in (${account.status}). That is a bug.`);
  process.exitCode = 1;
}

site.close();
step('Done. `docker compose down` stops Keycloak and the issuer.');
