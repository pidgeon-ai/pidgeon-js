import {
  createClient,
  createConfig,
  identitiesCreate,
  identitiesGet,
  identitiesList,
  identitiesReceiveRulesGet,
  identitiesSendRulesGet,
  labelsCreate,
  labelsList,
  mailboxesChanges,
  mailboxesList,
  mailboxesListFolder,
  messagesAwait,
  messagesGet,
  messagesListInThread,
  messagesReply,
  messagesSearch,
  messagesSend,
  messagesUpdate,
  eventsList,
  metricsQuery,
  podsCreate,
  podsList,
  threadsGet,
  threadsLabelsCreate,
  threadsLabelsDelete,
  threadsList,
  threadsUpdate,
} from '@pidgeon-ai/sdk';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

/*
 * The MCP server's tool list, imported rather than copied.
 *
 * `packages/mcp/src/tools.ts` is where Pidgeon decides which operations an
 * agent gets and how each is described to a model, and those descriptions
 * are corrected one field report at a time. A second copy here would be a
 * second list that stops receiving the corrections. The import is relative
 * and `tsup` bundles it, so the published package carries the text and does
 * not depend on `@pidgeon-ai/mcp` or the protocol SDK it pulls in.
 */
import { TOOLS, type ToolDefinition } from '../../mcp/src/tools';

export const DEFAULT_BASE_URL = 'https://pidgeon.ai/api/v1';

type Client = ReturnType<typeof createClient>;

export interface Answer {
  data?: unknown;
  error?: unknown;
  response?: Response;
}

export type Operation = (options: never) => Promise<Answer>;

/**
 * The SDK operation each tool is.
 *
 * Keyed by the MCP tool's name, so the two surfaces call the same thing by
 * the same name. `tests/unit/ai-sdk-tools.test.ts` asserts every operation
 * requests the `METHOD /path` its MCP tool declares, and that this table and
 * the MCP list name the same tools.
 */
export type PidgeonToolName =
  | 'list_addresses'
  | 'create_address'
  | 'get_address'
  | 'list_threads'
  | 'get_thread'
  | 'list_messages'
  | 'search_messages'
  | 'send_message'
  | 'get_message'
  | 'await_message'
  | 'reply_to_message'
  | 'update_thread'
  | 'update_message'
  | 'list_send_rules'
  | 'list_receive_rules'
  | 'list_folders'
  | 'list_folder'
  | 'list_changes'
  | 'list_events'
  | 'list_labels'
  | 'create_label'
  | 'apply_label'
  | 'remove_label'
  | 'list_pods'
  | 'create_pod'
  | 'get_metrics';

export const OPERATIONS: Record<PidgeonToolName, Operation> = {
  list_addresses: identitiesList,
  create_address: identitiesCreate,
  get_address: identitiesGet,
  list_threads: threadsList,
  get_thread: threadsGet,
  list_messages: messagesListInThread,
  search_messages: messagesSearch,
  send_message: messagesSend,
  get_message: messagesGet,
  await_message: messagesAwait,
  reply_to_message: messagesReply,
  update_thread: threadsUpdate,
  update_message: messagesUpdate,
  list_send_rules: identitiesSendRulesGet,
  list_receive_rules: identitiesReceiveRulesGet,
  list_folders: mailboxesList,
  list_folder: mailboxesListFolder,
  list_changes: mailboxesChanges,
  list_events: eventsList,
  list_labels: labelsList,
  create_label: labelsCreate,
  apply_label: threadsLabelsCreate,
  remove_label: threadsLabelsDelete,
  list_pods: podsList,
  create_pod: podsCreate,
  get_metrics: metricsQuery,
};

export type PidgeonTools = Record<PidgeonToolName, Tool<Record<string, unknown>, unknown>>;

/** The tools that change something: sending, replying, creating, filing, handing over. */
export const WRITE_TOOLS: readonly PidgeonToolName[] = TOOLS.filter((t) => !t.readOnly).map(
  (t) => t.name as PidgeonToolName,
);

export interface PidgeonToolsOptions {
  /** A Pidgeon API key. Read from `PIDGEON_API_KEY` when absent. */
  apiKey?: string;
  /** Where the API is. `https://pidgeon.ai/api/v1` unless you run your own. */
  baseUrl?: string;
  /**
   * The address a tool uses when the model names none. Any tool that takes
   * an `identity_id` treats it as optional once this is set.
   */
  identityId?: string;
  /** A client from `createClient` in `@pidgeon-ai/sdk`, used instead of one built from the options above. */
  client?: Client;
}

/** A refusal from the API, with its own sentence, status and code. */
export class PidgeonToolError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PidgeonToolError';
    this.status = status;
    this.code = code;
  }
}

const PATH_PARAM = /\{([^}]+)\}/g;

/**
 * Pidgeon as AI SDK tools.
 *
 *   generateText({ model, tools: pidgeonTools(), prompt })
 *
 * One tool per operation an agent working a mailbox needs, with the names
 * and descriptions the MCP server uses. Every tool carries
 * `metadata.readOnly`; `WRITE_TOOLS` names the ones that change something,
 * for `toolApproval`.
 */
export function pidgeonTools(options: PidgeonToolsOptions = {}): PidgeonTools {
  const client = options.client ?? buildClient(options);
  const tools = {} as PidgeonTools;

  for (const definition of TOOLS) {
    const name = definition.name as PidgeonToolName;
    const operation = OPERATIONS[name] as Operation | undefined;

    /* The test keeps the two lists equal; this keeps a gap from shipping a broken tool. */
    if (!operation) continue;

    tools[name] = build(definition, operation, client, options.identityId);
  }

  return tools;
}

function buildClient(options: PidgeonToolsOptions): Client {
  const apiKey = options.apiKey ?? readEnv('PIDGEON_API_KEY');

  if (!apiKey) {
    throw new Error(
      'Pass `apiKey`, or set PIDGEON_API_KEY. Create a key at https://pidgeon.ai/app/developers/keys.',
    );
  }

  return createClient(
    createConfig({
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      auth: () => apiKey,
    }),
  );
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[name] || undefined;
}

function build(
  definition: ToolDefinition,
  operation: Operation,
  client: Client,
  identityId: string | undefined,
): Tool<Record<string, unknown>, unknown> {
  const shape: Record<string, z.core.$ZodType> = { ...definition.inputSchema };

  /*
   * With a default address the model may leave it out, so the schema says
   * so. Without one, `await_message` still requires it, as the API does.
   */
  if (identityId && 'identity_id' in shape) {
    shape.identity_id = z.string().optional();
  }

  const [method, template] = splitEndpoint(definition.endpoint);
  const sendsBody = method === 'POST' || method === 'PATCH';

  return tool({
    description: definition.description,
    inputSchema: z.object(shape) as unknown as z.ZodType<Record<string, unknown>>,
    metadata: { readOnly: definition.readOnly, endpoint: definition.endpoint },
    execute: async (input, { abortSignal }) => {
      const remaining: Record<string, unknown> = { ...input };

      if (identityId && 'identity_id' in shape && remaining.identity_id === undefined) {
        remaining.identity_id = identityId;
      }

      /* `{id}` goes in the path and nowhere else; every request schema is strict. */
      const path: Record<string, unknown> = {};
      for (const [, param] of template.matchAll(PATH_PARAM)) {
        path[param!] = remaining[param!];
        delete remaining[param!];
      }

      const answer = await (operation as (o: Record<string, unknown>) => Promise<Answer>)({
        client,
        ...(Object.keys(path).length > 0 ? { path } : {}),
        ...(sendsBody
          ? { body: remaining }
          : Object.keys(remaining).length > 0
            ? { query: remaining }
            : {}),
        ...(abortSignal ? { signal: abortSignal } : {}),
      });

      return unwrap(answer);
    },
  });
}

/**
 * The body, without the envelope where the envelope is all there is.
 *
 * A single resource arrives as `{ data }` and the model is given what is in
 * it. A list keeps `has_more` and `next_cursor`, which are how it reads the
 * next page.
 */
function unwrap(answer: Answer): unknown {
  if (answer.error !== undefined) {
    /*
     * The API's own sentence, passed through. It is written for somebody
     * debugging an integration, and a model relaying it to a person is
     * better served by the reason than by "the request failed".
     */
    const detail = (answer.error as { error?: { message?: string; code?: string } } | null)?.error;
    const status = answer.response?.status ?? 0;
    throw new PidgeonToolError(
      detail?.message ?? `The request failed with ${status}.`,
      status,
      detail?.code ?? 'internal',
    );
  }

  const body = answer.data;

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const keys = Object.keys(body);
    if (keys.length === 1 && keys[0] === 'data') return (body as { data: unknown }).data;
  }

  return body;
}

function splitEndpoint(endpoint: string): [string, string] {
  const space = endpoint.indexOf(' ');
  return [endpoint.slice(0, space), endpoint.slice(space + 1)];
}
