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

const DEFAULT_BASE_URL = 'https://pidgeon.ai/api/v1';

export interface RequestOptions {
  body?: IDataObject;
  qs?: IDataObject;
  headers?: Record<string, string>;
  /** Let the caller see a 404 rather than throwing on it. */
  allowNotFound?: boolean;
  /** Seconds. The default suits every call but a held-open wait. */
  timeout?: number;
}

/**
 * One call to the Pidgeon API, with the node's own credential.
 *
 * Every response is `{ data, … }`; this returns the whole envelope so a list
 * keeps its `next_cursor`. A Pidgeon error (`{ error: { code, message } }`)
 * becomes an n8n error whose message is ours, which already says what to do.
 */
export async function pidgeonRequest(
  this: PidgeonContext,
  method: IHttpRequestMethods,
  path: string,
  options: RequestOptions = {},
): Promise<IDataObject> {
  const credentials = await this.getCredentials(CREDENTIAL);
  const baseURL = (credentials.baseUrl as string | undefined) || DEFAULT_BASE_URL;

  const request: IHttpRequestOptions = {
    method,
    baseURL,
    url: path,
    json: true,
    headers: { Accept: 'application/json', ...options.headers },
    timeout: (options.timeout ?? 60) * 1000,
  };
  if (options.body !== undefined) request.body = options.body;
  if (options.qs !== undefined) request.qs = dropEmpty(options.qs);

  try {
    return (await this.helpers.httpRequestWithAuthentication.call(
      this,
      CREDENTIAL,
      request,
    )) as IDataObject;
  } catch (error) {
    const status = statusOf(error);
    if (options.allowNotFound && status === 404) return { data: null, not_found: true };

    const body = responseBody(error);
    const detail = (body?.error ?? {}) as IDataObject;
    throw new NodeApiError(this.getNode(), (body ?? { message: String(error) }) as JsonObject, {
      httpCode: status ? String(status) : undefined,
      message: typeof detail.message === 'string' ? detail.message : undefined,
      description:
        typeof detail.code === 'string'
          ? `Pidgeon error code: ${detail.code}${detail.field ? `, field: ${String(detail.field)}` : ''}`
          : undefined,
    });
  }
}

/** Every page of a list, up to `limit` items. */
export async function pidgeonRequestAll(
  this: PidgeonContext,
  path: string,
  qs: IDataObject = {},
  limit = Infinity,
): Promise<IDataObject[]> {
  const items: IDataObject[] = [];
  let cursor: string | null = null;

  do {
    const page: IDataObject = await pidgeonRequest.call(this, 'GET', path, {
      qs: { ...qs, ...(cursor ? { cursor } : {}) },
    });
    items.push(...((page.data as IDataObject[] | undefined) ?? []));
    cursor = page.has_more ? ((page.next_cursor as string | null) ?? null) : null;
  } while (cursor && items.length < limit);

  return items.slice(0, limit);
}

function dropEmpty(qs: IDataObject): IDataObject {
  return Object.fromEntries(
    Object.entries(qs).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function statusOf(error: unknown): number | undefined {
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
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
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
