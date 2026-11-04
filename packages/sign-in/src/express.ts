import type { IncomingMessage, ServerResponse } from 'node:http';

import type { PidgeonSignIn, Session } from './index';

/**
 * Express, or any Node server with `(req, res, next)` middleware:
 *
 * ```js
 * import { pidgeonMiddleware, requireSession } from '@pidgeon-ai/sign-in/express';
 * app.use(pidgeonMiddleware(pidgeon));        // before any body parser on its routes
 * app.get('/account', requireSession(), (req, res) => res.json(req.pidgeon.claims));
 * ```
 *
 * The agent's request is checked against the bytes it signed, so the
 * middleware reads the body itself. Mount it before `express.urlencoded()`,
 * or keep the raw body as `req.rawBody`.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The Sign in with Pidgeon session, or null: set by `pidgeonMiddleware`. */
      pidgeon?: Session | null;
    }
  }
}

type Request = IncomingMessage & {
  pidgeon?: Session | null;
  rawBody?: Buffer | string;
  body?: unknown;
  originalUrl?: string;
};
type Next = (error?: unknown) => void;

async function bodyOf(req: Request): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.rawBody !== undefined) return Buffer.from(req.rawBody);
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return Buffer.from(req.body);
  if (req.readableEnded) {
    throw new Error(
      'The body was read before Sign in with Pidgeon saw it: mount pidgeonMiddleware before body parsers.',
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

function toRequest(
  pidgeon: PidgeonSignIn,
  req: Request,
  body: Buffer | undefined,
): Request & globalThis.Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const url = new URL(req.originalUrl ?? req.url ?? '/', pidgeon.options.url);
  return new globalThis.Request(url, {
    method: req.method,
    headers,
    body: body && body.length > 0 ? new Uint8Array(body) : undefined,
  }) as never;
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  const cookies = response.headers.getSetCookie?.() ?? [];
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Serves `basePath`, and sets `req.pidgeon` to the session (or null) for everything else. */
export function pidgeonMiddleware(pidgeon: PidgeonSignIn) {
  return async (req: Request, res: ServerResponse, next: Next) => {
    try {
      const path = new URL(req.originalUrl ?? req.url ?? '/', 'http://x').pathname;
      if (path.startsWith(`${pidgeon.basePath}/`)) {
        const response = await pidgeon.handle(toRequest(pidgeon, req, await bodyOf(req)));
        if (response) return await send(res, response);
      }
      req.pidgeon = await pidgeon.session(toRequest(pidgeon, req, undefined));
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** 401 unless signed in; `kind` narrows it to agents or people. */
export function requireSession(options: { kind?: 'agent' | 'person' } = {}) {
  return (req: Request, res: ServerResponse, next: Next) => {
    const claims = req.pidgeon?.claims;
    const isAgent = claims ? claims.kind !== 'person' : false;
    if (
      !claims ||
      (options.kind === 'agent' && !isAgent) ||
      (options.kind === 'person' && isAgent)
    ) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'unauthenticated',
          error_description: 'Sign in with Pidgeon first.',
        }),
      );
      return;
    }
    next();
  };
}
