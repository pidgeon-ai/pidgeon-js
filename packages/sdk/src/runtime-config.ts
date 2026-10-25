import type { CreateClientConfig } from './generated/client.gen';

/**
 * Who is calling, by package name, on every request the default client makes.
 *
 * Pidgeon labels the first client an account uses from this header
 * (`src/lib/analytics/client.ts`), which is how it can say an account came
 * through the SDK rather than a hand-written `fetch`. The name and nothing
 * else: no machine, no runtime, nothing that identifies the caller.
 *
 * **Not in a browser.** Browsers decide the User-Agent themselves, and the
 * ones that let a page set it would turn every call into a CORS preflight
 * asking about a header the API has no reason to allow.
 *
 * Wired in by `openapi-ts.config.ts` (`runtimeConfigPath`), so the generated
 * client calls it and the generated files stay untouched. A wrapper that
 * builds its own client — the CLI, the AI SDK tools — sends its own name.
 */
export const USER_AGENT = '@pidgeon-ai/sdk';

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  ...(typeof window === 'undefined'
    ? { headers: { 'User-Agent': USER_AGENT, ...plain(config?.headers) } }
    : {}),
});

function plain(headers: unknown): Record<string, string> {
  return headers && typeof headers === 'object' && !(headers instanceof Headers)
    ? (headers as Record<string, string>)
    : {};
}
