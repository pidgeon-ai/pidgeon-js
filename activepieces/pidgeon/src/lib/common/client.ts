import { createHash } from 'node:crypto';
import {
  AuthenticationType,
  HttpError,
  HttpMethod,
  httpClient,
} from '@activepieces/pieces-common';

export const PIDGEON_API = 'https://pidgeon.ai/api/v1';

type Json = Record<string, unknown>;

/**
 * One call to the Pidgeon API with the connection's key.
 *
 * Every response is `{ data, … }`; this returns the whole envelope so a list
 * keeps its `next_cursor`. A Pidgeon error (`{ error: { code, message } }`)
 * is rethrown with our message, which already says what to do.
 */
export async function pidgeonRequest<T = unknown>(params: {
  key: string;
  method: HttpMethod;
  path: string;
  body?: Json;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  /** Seconds. The default suits every call but a held-open wait. */
  timeout?: number;
  /** Answer `{ data: null }` for a 404 rather than throwing. */
  allowNotFound?: boolean;
}): Promise<{ data: T; has_more?: boolean; next_cursor?: string | null } & Json> {
  try {
    const response = await httpClient.sendRequest({
      method: params.method,
      url: `${PIDGEON_API}${params.path}`,
      body: params.body,
      queryParams: dropEmpty(params.query ?? {}),
      headers: { Accept: 'application/json', ...params.headers },
      authentication: { type: AuthenticationType.BEARER_TOKEN, token: params.key },
      timeout: (params.timeout ?? 60) * 1000,
    });
    return (response.body ?? { data: null }) as { data: T } & Json;
  } catch (error) {
    if (error instanceof HttpError) {
      if (params.allowNotFound && error.response.status === 404) {
        return { data: null as T };
      }
      throw new Error(describe(error.response.status, error.response.body));
    }
    throw error;
  }
}

function describe(status: number, body: unknown): string {
  const parsed = typeof body === 'string' ? safeParse(body) : body;
  const detail = (parsed as { error?: { code?: string; message?: string; field?: string } })
    ?.error;
  if (detail?.message) {
    const code = detail.code ? ` (${detail.code}${detail.field ? `, ${detail.field}` : ''})` : '';
    return `Pidgeon answered ${status}: ${detail.message}${code}`;
  }
  return `Pidgeon answered ${status}.`;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function dropEmpty(
  query: Record<string, string | number | boolean | undefined | null>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([name, value]) => [name, String(value)]),
  );
}

/**
 * The same request from the same step of the same run sends once.
 *
 * Activepieces retries a failed step inside its run, and a retry after a
 * timeout must not send the mail twice. The body is part of the key because
 * a step in a loop runs once per item under one step name, and each item is
 * a different message.
 */
export function idempotencyKey(input: { runId: string; stepName: string; body: unknown }): {
  'Idempotency-Key': string;
} {
  const digest = createHash('sha256')
    .update(`${input.runId}:${input.stepName}:${JSON.stringify(input.body)}`)
    .digest('hex');
  return { 'Idempotency-Key': `activepieces-${digest}` };
}

/** A comma-, semicolon- or newline-separated list of addresses, as a person types it. */
export function addressList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/[,;\n]/) : [];
  return entries.map((entry) => entry.trim()).filter(Boolean);
}
