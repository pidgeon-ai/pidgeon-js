/**
 * Pidgeon as Vercel AI SDK tools: the hosted MCP server's tools, the same
 * names, descriptions and input schemas, called in your process with your
 * key.
 *
 * Nothing here describes a tool. `registerApiTools` in `@pidgeon-ai/mcp/tools`
 * is the one list, shared by the local MCP server and the hosted one at
 * https://pidgeon.ai/mcp; this file hands it a recorder in place of an MCP
 * server and wraps what it records with `tool()`. A tool added there is here
 * on the next install, and the two cannot describe one tool differently.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import { DEFAULT_BASE_URL, Pidgeon } from '@pidgeon-ai/sdk';
import { registerApiTools } from '@pidgeon-ai/mcp/tools';

export const VERSION = '1.0.1';

export type PidgeonToolsOptions = {
  /** A Pidgeon API key. `PIDGEON_API_KEY` when left out. */
  apiKey?: string;
  /** Where the API is: `https://pidgeon.ai` when left out. */
  baseUrl?: string;
  /** A client you already have; `apiKey` and `baseUrl` are then ignored. */
  client?: Pidgeon;
  /** Only these tools, by name. Every tool when left out. */
  only?: readonly string[];
};

/** What the MCP server says about a tool's effect, kept on each tool's `metadata`. */
export type PidgeonToolMetadata = {
  source: 'pidgeon';
  title: string;
  readOnly: boolean;
  destructive: boolean;
};

type Shape = Record<string, z.ZodType>;
type Recorded = {
  name: string;
  title: string;
  description: string;
  inputSchema?: Shape;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  handler: (...args: unknown[]) => Promise<{ isError?: boolean; content: { text?: string }[] }>;
};

/** The MCP server's API tools, as `registerApiTools` registers them. */
function record(client: Pidgeon): Recorded[] {
  const recorded: Recorded[] = [];
  const recorder = {
    registerTool(
      name: string,
      config: Omit<Recorded, 'name' | 'handler'>,
      handler: Recorded['handler'],
    ) {
      recorded.push({ name, ...config, handler });
    },
  };
  registerApiTools(
    recorder as unknown as Parameters<typeof registerApiTools>[0],
    client,
    'Pidgeon refused the API key: check it, or make another in the dashboard.',
  );
  return recorded;
}

/** The text of an MCP tool result: JSON on success, words the model can act on on failure. */
function outcome(result: Awaited<ReturnType<Recorded['handler']>>): unknown {
  const text = result.content.map((part) => part.text ?? '').join('\n');
  // A thrown error is a tool error the AI SDK hands back to the model as such.
  if (result.isError) throw new Error(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Pidgeon's tools for `generateText`, `streamText` or an `Agent`: an agent's
 * inboxes and mail, its identity and reputation, checking other agents, and
 * Sign in with Pidgeon's sites and mandates. A key reaches what its access
 * and pod allow, and no more.
 */
export function pidgeonTools(options: PidgeonToolsOptions = {}): ToolSet {
  const client = options.client ?? clientOf(options);
  const tools: ToolSet = {};
  for (const recorded of record(client)) {
    if (options.only && !options.only.includes(recorded.name)) continue;
    const metadata: PidgeonToolMetadata = {
      source: 'pidgeon',
      title: recorded.title,
      readOnly: recorded.annotations?.readOnlyHint === true,
      destructive: recorded.annotations?.destructiveHint === true,
    };
    tools[recorded.name] = tool({
      description: recorded.description,
      inputSchema: z.object(recorded.inputSchema ?? {}),
      metadata,
      execute: async (input: Record<string, unknown>) =>
        // The MCP SDK calls a tool with no input schema with only its context.
        outcome(await (recorded.inputSchema ? recorded.handler(input, {}) : recorded.handler({}))),
    });
  }
  return tools;
}

/**
 * A `toolApproval` for `generateText`, `streamText` or an `Agent` that asks a
 * person before any tool the MCP server marks destructive (removing an inbox,
 * revoking an agent or a mandate, deleting a draft): `'user-approval'` for each.
 */
export function pidgeonToolApproval(tools: ToolSet): Record<string, 'user-approval'> {
  const approval: Record<string, 'user-approval'> = {};
  for (const [name, entry] of Object.entries(tools)) {
    const metadata = entry.metadata as PidgeonToolMetadata | undefined;
    if (metadata?.source === 'pidgeon' && metadata.destructive) approval[name] = 'user-approval';
  }
  return approval;
}

function clientOf(options: PidgeonToolsOptions): Pidgeon {
  const apiKey = options.apiKey ?? globalThis.process?.env?.PIDGEON_API_KEY;
  if (!apiKey)
    throw new Error('pidgeonTools needs an API key: pass apiKey, or set PIDGEON_API_KEY.');
  return new Pidgeon({ apiKey, baseUrl: options.baseUrl ?? DEFAULT_BASE_URL });
}
