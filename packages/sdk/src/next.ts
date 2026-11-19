/**
 * Pidgeon Bouncer for a Next.js proxy (`proxy.ts`, `middleware.ts` before
 * Next 16), or anything else that hands you a Fetch API `Request` and a
 * `waitUntil`: Vercel Functions, Cloudflare Workers, Hono.
 *
 * ```ts
 * // proxy.ts
 * import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
 * import { bouncer } from '@pidgeon-ai/sdk/next';
 *
 * const observe = bouncer({ apiKey: process.env.PIDGEON_API_KEY });
 *
 * export function proxy(request: NextRequest, event: NextFetchEvent) {
 *   observe(request, event);
 *   return NextResponse.next();
 * }
 * ```
 *
 * `observe` mode (the only one today) asks Pidgeon about every request that
 * carries an agent's signature, after the response is on its way
 * (`waitUntil`): the visit is never slowed or blocked, and the check shows up
 * in your dashboard. It never throws into your request.
 */
import { Pidgeon, DEFAULT_BASE_URL, type VerifyAnswer } from './index.ts';

export { VERDICT_HEADER } from './index.ts';

/** The work a request may leave running after its response: `NextFetchEvent`, a Worker's `ExecutionContext`. */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export type BouncerOptions = {
  /** An API key with `read` access. Without one the helper does nothing, so local development and previews are untouched. */
  apiKey?: string | null;
  baseUrl?: string;
  /**
   * `observe`: record every agent's request with Pidgeon, never act on it.
   * An `enforce` mode, which answers a request from the verdict, is coming.
   */
  mode?: 'observe';
  /** The URL the agent called, when your proxy sees another (a different host behind a load balancer). Defaults to `request.url`. */
  url?: (request: Request) => string;
  /** Called with Pidgeon's answer, after the response. */
  onAnswer?: (answer: VerifyAnswer, request: Request) => void | Promise<void>;
  /** Called when the check failed (Pidgeon unreachable, slow, or your key refused). Defaults to `console.warn`. */
  onError?: (error: unknown, request: Request) => void;
  /** How long a check may take before it is given up, in milliseconds. 5,000 by default. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Headers only an agent sends: a Web Bot Auth signature, or the claim to be one. */
const AGENT_HEADERS = ['signature-agent', 'signature', 'signature-input'] as const;

/** A visitor's credentials, never sent to Pidgeon unless the agent signed them. */
const PRIVATE_HEADERS = ['cookie', 'authorization', 'proxy-authorization'];

/**
 * Whether a request is one Bouncer has something to say about: it carries a
 * signature, or claims to be an agent with `Signature-Agent` alone (which
 * Pidgeon records as `unsigned`). A CORS preflight never is.
 */
export function carriesAgentHeaders(request: Request): boolean {
  if (request.method === 'OPTIONS') return false;
  return AGENT_HEADERS.some((name) => request.headers.has(name));
}

/**
 * The headers Pidgeon needs, one string each (`Headers` already joins a
 * repeated header with `, `). The visitor's cookies and credentials are left
 * out unless the signature covers them.
 */
export function headersForVerify(request: Request): Record<string, string> {
  const covered = request.headers.get('signature-input')?.toLowerCase() ?? '';
  const out: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (PRIVATE_HEADERS.includes(name) && !covered.includes(`"${name}"`)) return;
    out[name] = value;
  });
  return out;
}

/**
 * Make the proxy step: call it with each request and the proxy's event. It
 * returns at once; the check runs after the response.
 */
export function bouncer(options: BouncerOptions): (request: Request, event?: WaitUntil) => void {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return () => undefined;

  const timeoutMs = options.timeoutMs ?? 5_000;
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const pidgeon = new Pidgeon({
    apiKey,
    baseUrl: options.baseUrl,
    fetch: (input, init) => baseFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
  const verifyEndpoint = `${pidgeon.baseUrl || DEFAULT_BASE_URL}/v1/verify`;
  const onError =
    options.onError ??
    ((error: unknown) =>
      console.warn(
        'Pidgeon Bouncer: the check failed',
        error instanceof Error ? error.message : error,
      ));

  const check = async (request: Request, url: string) => {
    try {
      const answer = await pidgeon.verify({
        method: request.method,
        url,
        headers: headersForVerify(request),
      });
      await options.onAnswer?.(answer, request);
    } catch (error) {
      try {
        onError(error, request);
      } catch {
        // A failing handler must not fail the request either.
      }
    }
  };

  return (request, event) => {
    try {
      if (!carriesAgentHeaders(request)) return;
      const url = new URL(options.url ? options.url(request) : request.url);
      // Pidgeon's own endpoint, should a proxy in front of it carry this step: never check the check.
      if (`${url.origin}${url.pathname}` === verifyEndpoint) return;
      const work = check(request, url.toString());
      if (event) event.waitUntil(work);
    } catch (error) {
      try {
        onError(error, request);
      } catch {
        // As above.
      }
    }
  };
}

/**
 * For a sign-up behind a hook that cannot see the agent's request (Supabase,
 * Auth0, WorkOS): verify the agent now, before the response, and answer the
 * verdict to hand on, or null when the request is not an agent's, the
 * signature did not hold, or Pidgeon could not be asked. Awaited, so call it
 * only on the sign-up's own request, not on every page.
 *
 * ```ts
 * // proxy.ts, on POST /signup
 * const headers = new Headers(request.headers);
 * headers.delete(VERDICT_HEADER); // never pass on one the visitor sent
 * const verdict = await verdictFor(request, { apiKey: process.env.PIDGEON_API_KEY });
 * if (verdict) headers.set(VERDICT_HEADER, verdict);
 * return NextResponse.next({ request: { headers } });
 * ```
 */
export async function verdictFor(
  request: Request,
  options: Omit<BouncerOptions, 'mode' | 'onAnswer'> & {
    /** The agent's address as your platform reports it (on Vercel, `ipAddress(request)` from `@vercel/functions`). */
    ip?: string | null;
  },
): Promise<string | null> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey || !carriesAgentHeaders(request)) return null;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const baseFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const pidgeon = new Pidgeon({
    apiKey,
    baseUrl: options.baseUrl,
    fetch: (input, init) => baseFetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  });
  try {
    const url = options.url ? options.url(request) : request.url;
    const answer = await pidgeon.verify(
      { method: request.method, url, headers: headersForVerify(request) },
      options.ip ? { ip: options.ip } : {},
    );
    return 'verdict' in answer && answer.verdict ? answer.verdict : null;
  } catch (error) {
    try {
      (options.onError ?? ((e: unknown) => console.warn('Pidgeon Bouncer: no verdict', e)))(
        error,
        request,
      );
    } catch {
      // A failing handler must not fail the sign-up.
    }
    return null;
  }
}
