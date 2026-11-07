/**
 * A read that waits out a rate limit. Auth0's free tenants allow a couple
 * of Management API calls a second across the whole tenant (a 429 met on
 * 7 November), and Okta limits per endpoint; both say when the window
 * resets (`x-ratelimit-reset`, `x-rate-limit-reset`, epoch seconds). A
 * 429 is retried after that, at most twice and at most two seconds each,
 * so a sign-in waits a little rather than fails, and never hangs.
 */
export async function withBackoff(
  attempt: () => Promise<Response>,
  now: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<Response> {
  for (let tries = 0; ; tries++) {
    const response = await attempt();
    if (response.status !== 429 || tries >= 2) return response;
    const reset = Number(
      response.headers.get('x-ratelimit-reset') ?? response.headers.get('x-rate-limit-reset'),
    );
    const retryAfter = Number(response.headers.get('retry-after'));
    const wait =
      Number.isFinite(reset) && reset > 0
        ? reset * 1000 - now()
        : Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000;
    await sleep(Math.min(2000, Math.max(250, wait)));
  }
}
