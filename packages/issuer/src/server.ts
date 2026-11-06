import { createServer, type IncomingMessage, type Server } from 'node:http';

import type { Issuer } from './issuer';

/**
 * The issuer on `node:http`. It answers on whatever host reaches it and
 * signs for its configured `issuer` URL, so it runs behind the company's own
 * reverse proxy: publish the read-only paths, keep the token endpoint inside.
 */
export function serve(issuer: Issuer, port: number, host = '0.0.0.0'): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const response = (await issuer.handle(await toRequest(req, issuer.issuer))) ?? notFound();
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error' }));
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

const MAX_BODY = 64 * 1024;

async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const method = req.method ?? 'GET';
  return new Request(new URL(req.url ?? '/', base), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
