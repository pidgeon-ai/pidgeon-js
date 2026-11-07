/**
 * A website that signs Acme's people and agents in at Acme's own issuer:
 * `@pidgeon-ai/sign-in` with `issuer` changed, on `node:http`, nothing
 * else. Agents from Pidgeon Cloud are let in too (`issuers`).
 *
 *   pnpm site        # http://localhost:3490
 *
 * Listing an issuer trusts its keys, from its own discovery on its own host,
 * to say who its agents are. Nothing else is contacted.
 */
import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { PIDGEON_ISSUER, pidgeonSignIn } from '@pidgeon-ai/sign-in';

const ISSUER = process.env.ACME_ISSUER ?? 'http://localhost:8080';

export async function startSite(port = Number(process.env.PORT ?? 3490)): Promise<Server> {
  const pidgeon = pidgeonSignIn({
    // The site's client at Acme's issuer (`issuer/issuer.json` → clients).
    clientId: 'client_shop',
    url: `http://localhost:${port}`,
    secret: crypto.randomUUID() + crypto.randomUUID(),
    // A person signs in here; an agent at either.
    issuer: ISSUER,
    issuers: [PIDGEON_ISSUER],
    onSignIn: (claims) => console.log(`  site: ${claims.email} signed in, iss ${claims.iss}`),
  });

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });

    let response = await pidgeon.handle(request);
    if (!response && new URL(request.url).pathname === '/account') {
      const session = await pidgeon.session(request);
      response = session
        ? Response.json({ signed_in_as: session.claims })
        : Response.json({ error: 'Not signed in.' }, { status: 401 });
    }
    response ??= new Response(
      'Shoebox. People: GET /api/auth/pidgeon/login. Agents: POST /api/auth/pidgeon/token.',
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await startSite();
  console.log('Shoebox on http://localhost:3490');
}
