import {
  NodeApiError,
  type IDataObject,
  type IExecuteFunctions,
  type IHookFunctions,
  type IHttpRequestMethods,
  type IHttpRequestOptions,
  type ILoadOptionsFunctions,
  type IWebhookFunctions,
  type JsonObject,
} from 'n8n-workflow';

export type PidgeonContext =
  IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

export const CREDENTIAL = 'pidgeonApi';

const DEFAULT_BASE_URL = 'https://pidgeon.ai';

export interface RequestOptions {
  body?: IDataObject;
  qs?: IDataObject;
  /** Seconds. The default suits every call but a wait for mail. */
  timeout?: number;
}

/**
 * One call to Pidgeon's API (`/v1`), with the node's credential. A refusal
 * (`{ error: { code, message } }`) becomes an n8n error carrying Pidgeon's
 * message, which already says what to do.
 */
export async function pidgeonRequest(
  this: PidgeonContext,
  method: IHttpRequestMethods,
  path: string,
  options: RequestOptions = {},
): Promise<IDataObject> {
  const credentials = await this.getCredentials(CREDENTIAL);
  const request: IHttpRequestOptions = {
    method,
    baseURL: (credentials.baseUrl as string | undefined) || DEFAULT_BASE_URL,
    url: path,
    json: true,
    headers: { Accept: 'application/json' },
    timeout: (options.timeout ?? 60) * 1000,
  };
  if (options.body !== undefined) request.body = options.body;
  if (options.qs !== undefined) request.qs = withoutEmpty(options.qs);

  try {
    const answer = (await this.helpers.httpRequestWithAuthentication.call(
      this,
      CREDENTIAL,
      request,
    )) as IDataObject | undefined;
    // A removal answers 204 with no body.
    return answer ?? {};
  } catch (error) {
    const body = responseBody(error);
    const detail = (body?.error ?? {}) as IDataObject;
    throw new NodeApiError(this.getNode(), (body ?? { message: String(error) }) as JsonObject, {
      httpCode: statusOf(error),
      message: typeof detail.message === 'string' ? detail.message : undefined,
      description:
        typeof detail.code === 'string' ? `Pidgeon error code: ${detail.code}` : undefined,
    });
  }
}

/** Every page of a `/v1` list (`{ data, has_more, next_cursor }`), up to `limit` items. */
export async function pidgeonRequestAll(
  this: PidgeonContext,
  path: string,
  qs: IDataObject = {},
  limit = Infinity,
): Promise<IDataObject[]> {
  const items: IDataObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await pidgeonRequest.call(this, 'GET', path, {
      qs: { ...qs, limit: Math.min(100, limit), cursor },
    });
    items.push(...((page.data as IDataObject[] | undefined) ?? []));
    cursor = page.has_more && page.next_cursor ? String(page.next_cursor) : undefined;
  } while (cursor && items.length < limit);
  return items.slice(0, limit);
}

function withoutEmpty(qs: IDataObject): IDataObject {
  return Object.fromEntries(
    Object.entries(qs).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function statusOf(error: unknown): string | undefined {
  const candidate = error as {
    httpCode?: string;
    statusCode?: number;
    status?: number;
    response?: { status?: number };
    cause?: { status?: number; response?: { status?: number } };
  };
  const status =
    candidate.response?.status ??
    candidate.statusCode ??
    candidate.status ??
    candidate.cause?.response?.status ??
    candidate.cause?.status ??
    (candidate.httpCode ? Number(candidate.httpCode) : undefined);
  return typeof status === 'number' && Number.isFinite(status) ? String(status) : undefined;
}

function responseBody(error: unknown): IDataObject | undefined {
  const candidate = error as {
    response?: { data?: unknown; body?: unknown };
    cause?: { response?: { data?: unknown } };
    error?: unknown;
  };
  const body =
    candidate.response?.data ??
    candidate.response?.body ??
    candidate.cause?.response?.data ??
    candidate.error;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as IDataObject;
    } catch {
      return { message: body };
    }
  }
  return body && typeof body === 'object' ? (body as IDataObject) : undefined;
}
