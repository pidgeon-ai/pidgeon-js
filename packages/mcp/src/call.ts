import { takeIdempotencyKey } from './idempotency.js';
import type { ToolDefinition } from './tools.js';

/**
 * Calling the endpoint a tool declares.
 *
 * **The tool's `endpoint` is its implementation**, not a label beside one.
 * That is deliberate and it is what makes "this package is an adapter" a
 * structural fact rather than a promise: there is no place to put behaviour
 * the API does not have, because nothing here dispatches on the tool's name.
 *
 * Path parameters come out of the input by name, and what is left becomes the
 * query string on a `GET` or `DELETE` and the body on a `POST` or `PATCH`.
 * The API's own schemas then validate it — this does not re-declare their
 * rules, because two copies of a validation rule is one copy that is wrong.
 *
 * It does not use `@pidgeon-ai/sdk` at runtime, only its types. The SDK is a
 * thin wrapper over the same requests, and going through it would add a layer
 * whose only job is to be a second place a path can be spelled wrong.
 */

export interface CallContext {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

export class PidgeonHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PidgeonHttpError';
    this.status = status;
    this.code = code;
  }
}

const PATH_PARAM = /\{([^}]+)\}/g;

export async function callEndpoint(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  context: CallContext,
): Promise<unknown> {
  return (await dispatch(tool, input, context)).data;
}

export interface Dispatched {
  data: unknown;
  /** The API answered from a stored send (`Idempotent-Replay: true`) and sent nothing. */
  replayed: boolean;
}

/**
 * `callEndpoint`, with whether the answer was a replay.
 *
 * A tool that sends carries an `Idempotency-Key` — the model's, or one
 * derived from the call (`idempotency.ts`) — as a header, never in the body.
 */
export async function dispatch(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  context: CallContext,
): Promise<Dispatched> {
  const [method, template] = splitEndpoint(tool.endpoint);

  const remaining = { ...input };
  const idempotencyKey = await takeIdempotencyKey(tool, remaining, context.apiKey);

  /*
   * `{id}` is filled from the input and removed from it, so it cannot also
   * arrive as a query parameter — where the API would reject it as an unknown
   * field, since every request schema here is `.strict()`.
   */
  const path = template.replace(PATH_PARAM, (_match, name: string) => {
    const value = remaining[name];

    if (value === undefined || value === null || value === '') {
      throw new PidgeonHttpError(`\`${name}\` is required.`, 400, 'validation');
    }

    delete remaining[name];
    return encodeURIComponent(String(value));
  });

  const url = new URL(`${context.baseUrl}${path}`);
  const sendsBody = method === 'POST' || method === 'PATCH';

  if (!sendsBody) {
    for (const [key, value] of Object.entries(remaining)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }

  const doFetch = context.fetch ?? globalThis.fetch;

  const response = await doFetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${context.apiKey}`,
      ...(sendsBody ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: sendsBody ? JSON.stringify(remaining) : undefined,
  });

  const payload = (await response.json().catch(() => null)) as {
    data?: unknown;
    error?: { code: string; message: string };
  } | null;

  if (!response.ok || payload?.error) {
    /*
     * The API's own sentence, passed through rather than rewritten. It is
     * written for somebody debugging an integration — "that address is on
     * this address's block list" — and a model relaying it to a person is
     * better served by the real reason than by "the request failed".
     */
    throw new PidgeonHttpError(
      payload?.error?.message ?? `Request failed with ${response.status}.`,
      response.status,
      payload?.error?.code ?? 'internal',
    );
  }

  return {
    data: payload?.data ?? payload,
    replayed: response.headers?.get('Idempotent-Replay') === 'true',
  };
}

export function splitEndpoint(endpoint: string): [string, string] {
  const space = endpoint.indexOf(' ');
  return [endpoint.slice(0, space), endpoint.slice(space + 1)];
}
