import type { PidgeonSignIn, Session } from './index';

/**
 * Next.js (App Router). One catch-all route and one call to read the session:
 *
 * ```ts
 * // app/api/auth/pidgeon/[action]/route.ts
 * import { routeHandlers } from '@pidgeon-ai/sign-in/next';
 * import { pidgeon } from '@/lib/pidgeon';
 * export const { GET, POST } = routeHandlers(pidgeon);
 *
 * // a page or a route
 * const session = await sessionFrom(pidgeon, await headers());
 * ```
 *
 * The button is a link to `pidgeon.loginUrl`; `buttonProps` gives its
 * attributes, so it renders as whatever component the site already uses.
 */
export function routeHandlers(pidgeon: PidgeonSignIn) {
  const answer = async (request: Request) =>
    (await pidgeon.handle(request)) ?? new Response('Not found.', { status: 404 });
  return { GET: answer, POST: answer };
}

/** The session, from a route's `Request` or from `headers()` in a Server Component. */
export async function sessionFrom(
  pidgeon: PidgeonSignIn,
  source: Request | Headers | { get(name: string): string | null },
): Promise<Session | null> {
  if (source instanceof Request) return pidgeon.session(source);
  const headers = new Headers();
  for (const name of ['authorization', 'cookie']) {
    const value = source.get(name);
    if (value) headers.set(name, value);
  }
  return pidgeon.session(new Request(pidgeon.options.url, { headers }));
}

/** The "Sign in with Pidgeon" link's attributes, for `<a {...buttonProps(pidgeon)}>`. */
export function buttonProps(pidgeon: PidgeonSignIn, returnTo?: string) {
  return {
    href: returnTo
      ? `${pidgeon.loginUrl}?return_to=${encodeURIComponent(returnTo)}`
      : pidgeon.loginUrl,
    children: 'Sign in with Pidgeon',
    'data-pidgeon-sign-in': '',
  };
}
